// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IVenueAdapter} from "../interfaces/IStoa.sol";

/// @notice Metric's pool factory (github.com/Metricxyz/pool-contracts): tells its own pools apart.
interface IMetricFactory {
    function isPool(address pool) external view returns (bool);
}

/// @notice A Metric OMM pool. `swap` prices from the pool's live oracle, sends the output to `recipient` first, then
///         asks `msg.sender` for the input through `metricOmmSwapCallback`. An exact-input swap may be partially filled.
interface IMetricPool {
    function swap(
        address recipient,
        bool zeroForOne,
        int128 amountSpecified,
        uint128 priceLimitX64,
        bytes calldata callbackData,
        bytes calldata extensionData
    ) external returns (int128 amount0Delta, int128 amount1Delta);
}

/// @notice Metric's quoter (github.com/Metricxyz/periphery-contracts, lens/MetricOmmSwapQuoter.sol): simulates a swap
///         at the pool's live oracle prices and refuses a paused pool, so a quote is a swap that can execute.
interface IMetricQuoter {
    function quoteLiveExactInSingle(
        address pool,
        address sender,
        bool zeroForOne,
        uint128 amountIn,
        uint128 priceLimitX64
    ) external returns (uint256 quotedAmountIn, uint256 quotedAmountOut);
}

/// @title MetricAdapter
/// @notice Fills swaps for StoaRouter on Metric OMM pools (PropAMM pools priced by an oracle, on Robinhood Chain:
///         WETH/USDG and tokenized stocks against USDG). For each pair it keeps up to MAX_POOLS pools, set by the
///         keeper (or the owner) from Metric's factory, and fills each swap on the one that quotes the most.
///         Two-step routes are handled by the router, not here.
/// @dev The pool list can only point swaps at real Metric pools for that exact pair; a bad list costs price, never
///      funds, because the router checks the user's minimum and this adapter checks every fill. Only the router may
///      call `swap`. The callback only pays the pool this adapter is swapping on, at most the amount it was given, and
///      a fill that takes less than the whole input reverts (no input is ever left behind here).
contract MetricAdapter is IVenueAdapter, Ownable2Step {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_POOLS = 4;

    IMetricFactory public immutable factory;
    IMetricQuoter public immutable quoter;
    address public immutable stoaRouter;
    address public keeper;

    /// @dev Metric pools keep their own token order (token0 is not always the lower address), so each is stored with it.
    struct Venue {
        address pool;
        address token0;
    }

    mapping(bytes32 pair => Venue[]) internal _venues;
    // the pool being swapped on and the input it may ask for; set only for the length of one `swap`
    address private _active;
    uint256 private _activeIn;

    event PoolsSet(address indexed token0, address indexed token1, address[] pools);
    event KeeperSet(address keeper);

    error OnlyRouter();
    error NotKeeper();
    error BadConfig();
    error BadPair();
    error TooMany();
    error NotMetricPool(address pool);
    error WrongPair(address pool);
    error Duplicate(address pool);
    error NoPath();
    error Partial();
    error Slippage();
    error BadCallback();

    constructor(IMetricFactory factory_, IMetricQuoter quoter_, address stoaRouter_, address owner_, address keeper_)
        Ownable(owner_)
    {
        if (address(factory_) == address(0) || address(quoter_) == address(0) || stoaRouter_ == address(0)) {
            revert BadConfig();
        }
        factory = factory_;
        quoter = quoter_;
        stoaRouter = stoaRouter_;
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    // ================================================================ pools

    /// @notice The keeper role: may set the pool list of a pair. Zero turns it off (the owner can still set lists).
    function setKeeper(address k) external onlyOwner {
        keeper = k;
        emit KeeperSet(k);
    }

    /// @notice Replace the pools used for a pair (either token order). Each must be a Metric pool of exactly that pair.
    ///         An empty list stops this adapter quoting the pair.
    function setPools(address a, address b, address[] calldata pools) external {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        if (pools.length > MAX_POOLS) revert TooMany();
        (address t0, address t1) = a < b ? (a, b) : (b, a);
        if (t0 == t1 || t0 == address(0)) revert BadPair();
        Venue[] storage list = _venues[_pair(t0, t1)];
        delete _venues[_pair(t0, t1)];
        for (uint256 i; i < pools.length; ++i) {
            address p = pools[i];
            if (!factory.isPool(p)) revert NotMetricPool(p);
            (address x0, address x1) = _tokens(p);
            if (!((x0 == t0 && x1 == t1) || (x0 == t1 && x1 == t0))) revert WrongPair(p);
            for (uint256 j; j < i; ++j) {
                if (pools[j] == p) revert Duplicate(p);
            }
            list.push(Venue(p, x0));
        }
        emit PoolsSet(t0, t1, pools);
    }

    /// @notice The pools used for a pair (either token order).
    function poolsFor(address a, address b) external view returns (address[] memory pools) {
        Venue[] storage list = _venues[_pair(a, b)];
        pools = new address[](list.length);
        for (uint256 i; i < list.length; ++i) {
            pools[i] = list[i].pool;
        }
    }

    // ================================================================ adapter

    /// @dev Not view: quotes simulate swaps. Call it with eth_call.
    function quote(address tokenIn, address tokenOut, uint256 amountIn) external returns (uint256 amountOut) {
        (,, amountOut) = _best(tokenIn, tokenOut, amountIn);
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
        external
        returns (uint256 amountOut)
    {
        if (msg.sender != stoaRouter) revert OnlyRouter();
        (address pool, bool zeroForOne, uint256 out) = _best(tokenIn, tokenOut, amountIn);
        if (out == 0) revert NoPath();
        (int128 paid, int128 got) = _fill(pool, tokenIn, zeroForOne, amountIn, to);
        if (paid <= 0 || uint256(int256(paid)) != amountIn) revert Partial();
        if (got >= 0) revert NoPath();
        amountOut = uint256(-int256(got));
        if (amountOut < minOut) revert Slippage();
    }

    /// @dev The pool has already sent the output to the recipient; pay it the input it asks for.
    function metricOmmSwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata callbackData) external {
        if (msg.sender != _active || msg.sender == address(0)) revert BadCallback();
        if (amount0Delta > 0 && amount1Delta > 0) revert BadCallback();
        int256 owed = amount0Delta > 0 ? amount0Delta : amount1Delta;
        if (owed <= 0 || uint256(owed) > _activeIn) revert BadCallback();
        IERC20(abi.decode(callbackData, (address))).safeTransfer(msg.sender, uint256(owed));
    }

    // ================================================================ internal

    /// @dev Swap on `pool` with the callback armed for it; returns (input the pool took, output it sent), signed.
    function _fill(address pool, address tokenIn, bool zeroForOne, uint256 amountIn, address to)
        private
        returns (int128 paid, int128 got)
    {
        _active = pool;
        _activeIn = amountIn;
        (int128 d0, int128 d1) = IMetricPool(pool)
            .swap(to, zeroForOne, int128(int256(amountIn)), zeroForOne ? 0 : type(uint128).max, abi.encode(tokenIn), "");
        _active = address(0);
        _activeIn = 0;
        (paid, got) = zeroForOne ? (d0, d1) : (d1, d0);
    }

    function _best(address a, address b, uint256 amountIn)
        private
        returns (address pool, bool zeroForOne, uint256 out)
    {
        if (a == b || amountIn == 0 || amountIn > uint256(uint128(type(int128).max))) return (address(0), false, 0);
        Venue[] storage list = _venues[_pair(a, b)];
        for (uint256 i; i < list.length; ++i) {
            Venue memory v = list[i];
            bool z = a == v.token0;
            try quoter.quoteLiveExactInSingle(
                v.pool, address(this), z, uint128(amountIn), z ? 0 : type(uint128).max
            ) returns (
                uint256 qIn, uint256 qOut
            ) {
                // a partial fill would leave input here: only full fills count
                if (qIn == amountIn && qOut > out) (pool, zeroForOne, out) = (v.pool, z, qOut);
            } catch {}
        }
    }

    /// @dev `getImmutables()` returns a static struct that starts (factory, token0, token1, ...).
    function _tokens(address pool) private view returns (address t0, address t1) {
        (bool ok, bytes memory r) = pool.staticcall(abi.encodeWithSignature("getImmutables()"));
        if (!ok || r.length < 96) revert NotMetricPool(pool);
        (, t0, t1) = abi.decode(r, (address, address, address));
    }

    function _pair(address a, address b) private pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }
}
