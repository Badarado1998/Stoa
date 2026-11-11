// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStoaPool, IVenueAdapter, IFeeDistributor} from "./interfaces/IStoa.sol";

interface IWHYPE {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @title StoaRouter
/// @notice Finds the best fill for a swap across Stoa pools and fallback venues (Uniswap, Nest, ... via adapters)
///         and executes it in one transaction. Stoa pools charge the protocol fee themselves; on the fallback
///         path the router takes the same fee from the output.
contract StoaRouter is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_FEE_BPS = 30;
    uint256 public constant MAX_VENUES = 16;

    IFeeDistributor public immutable feeDistributor;
    address public immutable whype;
    uint16 public fallbackFeeBps = 2;

    mapping(bytes32 pair => address[]) private _pools;
    address[] public adapters;

    struct Best {
        address venue;
        bool isPool;
        uint256 amountOut; // net of protocol fee
    }

    event PoolAdded(address indexed pool, bytes32 indexed pair);
    event PoolRemoved(address indexed pool, bytes32 indexed pair);
    event AdapterAdded(address indexed adapter);
    event AdapterRemoved(address indexed adapter);
    event Routed(
        address indexed sender,
        address indexed to,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address venue,
        bool isPool,
        address referrer
    );
    event FallbackFeeSet(uint16 bps);

    error Expired();
    error NoRoute();
    error Slippage();
    error ZeroAmount();
    error TooMany();
    error NotFound();
    error TooHigh();
    error NativeTransferFailed();
    error NotWhype();

    constructor(address owner_, IFeeDistributor feeDistributor_, address whype_) Ownable(owner_) {
        feeDistributor = feeDistributor_;
        whype = whype_;
    }

    /// @dev Only WHYPE unwrapping sends native HYPE here.
    receive() external payable {
        if (msg.sender != whype) revert NotWhype();
    }

    // ---------------------------------------------------------------- config

    function pairKey(address a, address b) public pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    function poolsFor(address a, address b) external view returns (address[] memory) {
        return _pools[pairKey(a, b)];
    }

    function adapterCount() external view returns (uint256) {
        return adapters.length;
    }

    function addPool(address pool) external onlyOwner {
        bytes32 k = pairKey(IStoaPool(pool).base(), IStoaPool(pool).quote());
        address[] storage list = _pools[k];
        if (list.length >= MAX_VENUES) revert TooMany();
        for (uint256 i; i < list.length; ++i) {
            if (list[i] == pool) return;
        }
        list.push(pool);
        emit PoolAdded(pool, k);
    }

    function removePool(address pool) external onlyOwner {
        bytes32 k = pairKey(IStoaPool(pool).base(), IStoaPool(pool).quote());
        _remove(_pools[k], pool);
        emit PoolRemoved(pool, k);
    }

    function addAdapter(address adapter) external onlyOwner {
        if (adapters.length >= MAX_VENUES) revert TooMany();
        for (uint256 i; i < adapters.length; ++i) {
            if (adapters[i] == adapter) return;
        }
        adapters.push(adapter);
        emit AdapterAdded(adapter);
    }

    function removeAdapter(address adapter) external onlyOwner {
        _remove(adapters, adapter);
        emit AdapterRemoved(adapter);
    }

    function setFallbackFeeBps(uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert TooHigh();
        fallbackFeeBps = bps;
        emit FallbackFeeSet(bps);
    }

    // ---------------------------------------------------------------- quoting

    /// @notice Best net output for a swap. Not a view because fallback quoters may simulate swaps;
    ///         call it with eth_call.
    function quoteBest(address tokenIn, address tokenOut, uint256 amountIn) public returns (Best memory best) {
        address[] storage list = _pools[pairKey(tokenIn, tokenOut)];
        for (uint256 i; i < list.length; ++i) {
            try IStoaPool(list[i]).quoteOut(tokenIn, amountIn) returns (uint256 out) {
                if (out > best.amountOut) best = Best(list[i], true, out);
            } catch {}
        }
        for (uint256 i; i < adapters.length; ++i) {
            try IVenueAdapter(adapters[i]).quote(tokenIn, tokenOut, amountIn) returns (uint256 gross) {
                uint256 out = gross - gross * fallbackFeeBps / 10_000;
                if (out > best.amountOut) best = Best(adapters[i], false, out);
            } catch {}
        }
    }

    // ---------------------------------------------------------------- swapping

    /// @notice Swap an exact amount of an ERC-20 for the best available output.
    function swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        address to,
        uint256 deadline,
        address referrer
    ) external nonReentrant returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert Expired();
        if (amountIn == 0) revert ZeroAmount();
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        amountOut = _route(tokenIn, tokenOut, amountIn, minOut, to, referrer);
    }

    /// @notice Swap native HYPE (sent as value) for `tokenOut`. The HYPE is wrapped to WHYPE first.
    function swapExactHYPEIn(address tokenOut, uint256 minOut, address to, uint256 deadline, address referrer)
        external
        payable
        nonReentrant
        returns (uint256 amountOut)
    {
        if (block.timestamp > deadline) revert Expired();
        if (msg.value == 0) revert ZeroAmount();
        IWHYPE(whype).deposit{value: msg.value}();
        amountOut = _route(whype, tokenOut, msg.value, minOut, to, referrer);
    }

    /// @notice Swap an exact amount of an ERC-20 for native HYPE.
    function swapExactInForHYPE(
        address tokenIn,
        uint256 amountIn,
        uint256 minOut,
        address payable to,
        uint256 deadline,
        address referrer
    ) external nonReentrant returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert Expired();
        if (amountIn == 0) revert ZeroAmount();
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        amountOut = _route(tokenIn, whype, amountIn, minOut, address(this), referrer);
        IWHYPE(whype).withdraw(amountOut);
        (bool ok,) = to.call{value: amountOut}("");
        if (!ok) revert NativeTransferFailed();
    }

    // ---------------------------------------------------------------- internal

    /// @dev `amountIn` of `tokenIn` is already held by the router.
    function _route(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to, address referrer)
        private
        returns (uint256 amountOut)
    {
        Best memory best = quoteBest(tokenIn, tokenOut, amountIn);
        if (best.venue == address(0)) revert NoRoute();

        if (best.isPool) {
            IERC20(tokenIn).forceApprove(best.venue, amountIn);
            amountOut = IStoaPool(best.venue).swap(tokenIn, amountIn, minOut, to, referrer);
            IERC20(tokenIn).forceApprove(best.venue, 0);
        } else {
            uint256 before = IERC20(tokenOut).balanceOf(address(this));
            IERC20(tokenIn).safeTransfer(best.venue, amountIn);
            IVenueAdapter(best.venue).swap(tokenIn, tokenOut, amountIn, 0, address(this));
            uint256 gross = IERC20(tokenOut).balanceOf(address(this)) - before;
            uint256 fee = gross * fallbackFeeBps / 10_000;
            amountOut = gross - fee;
            if (amountOut < minOut) revert Slippage();
            if (to != address(this)) IERC20(tokenOut).safeTransfer(to, amountOut);
            if (fee > 0) {
                IERC20(tokenOut).safeTransfer(address(feeDistributor), fee);
                feeDistributor.notifyFee(tokenOut, fee, referrer);
            }
        }
        if (amountOut < minOut) revert Slippage();
        emit Routed(msg.sender, to, tokenIn, tokenOut, amountIn, amountOut, best.venue, best.isPool, referrer);
    }

    function _remove(address[] storage list, address item) private {
        uint256 n = list.length;
        for (uint256 i; i < n; ++i) {
            if (list[i] == item) {
                list[i] = list[n - 1];
                list.pop();
                return;
            }
        }
        revert NotFound();
    }
}
