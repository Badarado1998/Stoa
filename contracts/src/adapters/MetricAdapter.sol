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
///         WETH/USDG and tokenized stocks against USDG). For each direction of a pair it keeps an ordered list of up to
///         MAX_POOLS pools, set by the keeper (or the owner) from Metric's factory, and fills each swap on the first
///         pool of the list that takes the whole input. The keeper ranks each list off-chain (pools that pay the most on
///         small orders first, deeper pools after), so a swap needs no on-chain comparison: it costs one pool swap, not
///         one quote per pool. `quote` follows the same rule, so it shows what `swap` will do.
///         Two-step routes are handled by the router, not here.
/// @dev The pool lists can only point swaps at real Metric pools for that exact pair; a bad list costs price, never
///      funds, because the router checks the user's minimum and this adapter checks every fill. Only the router may
///      call `swap`. The callback only pays the pool this adapter is swapping on, exactly the input it was given, once:
///      a pool that would fill only part of the input has its swap reverted, and the next pool is tried.
contract MetricAdapter is IVenueAdapter, Ownable2Step {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_POOLS = 4;

    IMetricFactory public immutable factory;
    IMetricQuoter public immutable quoter;
    address public immutable stoaRouter;
    address public keeper;

    /// @dev One storage slot per pool. Metric pools keep their own token order (token0 is not always the lower
    ///      address), so each entry stores the direction it is swapped in for its list.
    struct Venue {
        address pool;
        bool zeroForOne;
    }

    mapping(bytes32 route => Venue[]) internal _routes;
    // the pool being swapped on, the input it may ask for and its token; set only for the length of one pool swap
    address private transient _active;
    uint256 private transient _activeIn;
    address private transient _activeToken;

    event PoolsSet(address indexed tokenIn, address indexed tokenOut, address[] pools);
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

    /// @notice The keeper role: may set pool lists. Zero turns it off (the owner can still set lists).
    function setKeeper(address k) external onlyOwner {
        keeper = k;
        emit KeeperSet(k);
    }

    /// @notice Replace the ordered pool list for swaps from `tokenIn` to `tokenOut` (one direction). Each must be a
    ///         Metric pool of exactly that pair; swaps try them in this order. An empty list stops this direction.
    function setPools(address tokenIn, address tokenOut, address[] calldata pools) external {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        if (pools.length > MAX_POOLS) revert TooMany();
        if (tokenIn == tokenOut || tokenIn == address(0) || tokenOut == address(0)) revert BadPair();
        bytes32 k = _route(tokenIn, tokenOut);
        delete _routes[k];
        Venue[] storage list = _routes[k];
        for (uint256 i; i < pools.length; ++i) {
            address p = pools[i];
            if (!factory.isPool(p)) revert NotMetricPool(p);
            (address x0, address x1) = _tokens(p);
            bool z = x0 == tokenIn;
            if (z ? x1 != tokenOut : (x0 != tokenOut || x1 != tokenIn)) revert WrongPair(p);
            for (uint256 j; j < i; ++j) {
                if (pools[j] == p) revert Duplicate(p);
            }
            list.push(Venue(p, z));
        }
        emit PoolsSet(tokenIn, tokenOut, pools);
    }

    /// @notice The pools tried, in order, for swaps from `tokenIn` to `tokenOut`.
    function poolsFor(address tokenIn, address tokenOut) external view returns (address[] memory pools) {
        Venue[] storage list = _routes[_route(tokenIn, tokenOut)];
        pools = new address[](list.length);
        for (uint256 i; i < list.length; ++i) {
            pools[i] = list[i].pool;
        }
    }

    // ================================================================ adapter

    /// @notice What `swap` would pay now: the output of the first listed pool that quotes the whole input.
    /// @dev Not view: quotes simulate swaps. Call it with eth_call.
    function quote(address tokenIn, address tokenOut, uint256 amountIn) external returns (uint256 amountOut) {
        if (amountIn == 0 || amountIn > MAX_IN) return 0;
        Venue[] storage list = _routes[_route(tokenIn, tokenOut)];
        for (uint256 i; i < list.length; ++i) {
            Venue memory v = list[i];
            try quoter.quoteLiveExactInSingle(
                v.pool, address(this), v.zeroForOne, uint128(amountIn), _limit(v.zeroForOne)
            ) returns (
                uint256 qIn, uint256 qOut
            ) {
                if (qIn == amountIn && qOut > 0) return qOut;
            } catch {}
        }
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
        external
        returns (uint256 amountOut)
    {
        if (msg.sender != stoaRouter) revert OnlyRouter();
        if (amountIn == 0 || amountIn > MAX_IN) revert NoPath();
        Venue[] storage list = _routes[_route(tokenIn, tokenOut)];
        uint256 n = list.length;
        _activeIn = amountIn;
        _activeToken = tokenIn;
        for (uint256 i; i < n; ++i) {
            Venue memory v = list[i];
            _active = v.pool;
            try IMetricPool(v.pool)
                .swap(to, v.zeroForOne, int128(int256(amountIn)), _limit(v.zeroForOne), "", "") returns (
                int128 d0, int128 d1
            ) {
                (int128 paid, int128 got) = v.zeroForOne ? (d0, d1) : (d1, d0);
                if (paid <= 0 || uint256(int256(paid)) != amountIn || got >= 0) revert Partial();
                amountOut = uint256(-int256(got));
                break;
            } catch {} // paused, or would fill only part of the input: try the next pool
        }
        _active = address(0);
        _activeIn = 0;
        _activeToken = address(0);
        if (amountOut == 0) revert NoPath();
        if (amountOut < minOut) revert Slippage();
    }

    /// @dev The pool has already sent the output to the recipient; pay it the input, if it asks for exactly all of it.
    function metricOmmSwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        if (msg.sender != _active || msg.sender == address(0)) revert BadCallback();
        if (amount0Delta > 0 && amount1Delta > 0) revert BadCallback();
        int256 owed = amount0Delta > 0 ? amount0Delta : amount1Delta;
        // a partial fill reverts the pool's swap; `swap` then tries the next pool
        if (owed <= 0 || uint256(owed) != _activeIn) revert Partial();
        _active = address(0); // one payment per pool swap
        IERC20(_activeToken).safeTransfer(msg.sender, uint256(owed));
    }

    // ================================================================ internal

    uint256 private constant MAX_IN = uint256(uint128(type(int128).max));

    function _limit(bool zeroForOne) private pure returns (uint128) {
        return zeroForOne ? 0 : type(uint128).max;
    }

    /// @dev `getImmutables()` returns a static struct that starts (factory, token0, token1, ...).
    function _tokens(address pool) private view returns (address t0, address t1) {
        (bool ok, bytes memory r) = pool.staticcall(abi.encodeWithSignature("getImmutables()"));
        if (!ok || r.length < 96) revert NotMetricPool(pool);
        (, t0, t1) = abi.decode(r, (address, address, address));
    }

    function _route(address tokenIn, address tokenOut) private pure returns (bytes32) {
        return keccak256(abi.encode(tokenIn, tokenOut));
    }
}
