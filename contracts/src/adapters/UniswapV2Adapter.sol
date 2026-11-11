// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVenueAdapter} from "../interfaces/IStoa.sol";

interface IUniswapV2Factory {
    function getPair(address a, address b) external view returns (address);
}

interface IUniswapV2Pair {
    function getReserves() external view returns (uint112 r0, uint112 r1, uint32 ts);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

/// @title UniswapV2Adapter
/// @notice Fills swaps for StoaRouter directly on Uniswap V2 pairs (no V2 router needed). Tries the direct pair and
///         a two-hop path through the hub token (WHYPE) and uses the better one.
/// @dev Only the router may call `swap`; the router transfers `amountIn` here first. Assumes the standard 0.3% V2 fee.
///      Fee-on-transfer tokens are not supported.
contract UniswapV2Adapter is IVenueAdapter {
    using SafeERC20 for IERC20;

    IUniswapV2Factory public immutable factory;
    address public immutable hub;
    address public immutable stoaRouter;

    error OnlyRouter();
    error NoPath();
    error Slippage();

    constructor(IUniswapV2Factory factory_, address hub_, address stoaRouter_) {
        factory = factory_;
        hub = hub_;
        stoaRouter = stoaRouter_;
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256 amountOut) {
        (amountOut,) = _best(tokenIn, tokenOut, amountIn);
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
        external
        returns (uint256 amountOut)
    {
        if (msg.sender != stoaRouter) revert OnlyRouter();
        (uint256 out, bool viaHub) = _best(tokenIn, tokenOut, amountIn);
        if (out == 0) revert NoPath();
        if (!viaHub) {
            address pair = factory.getPair(tokenIn, tokenOut);
            IERC20(tokenIn).safeTransfer(pair, amountIn);
            _pairSwap(pair, tokenIn, tokenOut, out, to);
        } else {
            address p1 = factory.getPair(tokenIn, hub);
            address p2 = factory.getPair(hub, tokenOut);
            (uint256 mid,) = _pairOut(tokenIn, hub, amountIn);
            IERC20(tokenIn).safeTransfer(p1, amountIn);
            _pairSwap(p1, tokenIn, hub, mid, p2); // first hop pays straight into the second pair
            _pairSwap(p2, hub, tokenOut, out, to);
        }
        if (out < minOut) revert Slippage();
        amountOut = out;
    }

    // ---------------------------------------------------------------- internal

    function _best(address tokenIn, address tokenOut, uint256 amountIn)
        private
        view
        returns (uint256 out, bool viaHub)
    {
        (out,) = _pairOut(tokenIn, tokenOut, amountIn);
        if (tokenIn != hub && tokenOut != hub) {
            (uint256 mid,) = _pairOut(tokenIn, hub, amountIn);
            if (mid > 0) {
                (uint256 h,) = _pairOut(hub, tokenOut, mid);
                if (h > out) (out, viaHub) = (h, true);
            }
        }
    }

    function _pairOut(address a, address b, uint256 amountIn) private view returns (uint256 out, address pair) {
        pair = factory.getPair(a, b);
        if (pair == address(0) || amountIn == 0) return (0, pair);
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(pair).getReserves();
        (uint256 rin, uint256 rout) = a < b ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        if (rin == 0 || rout == 0) return (0, pair);
        uint256 inFee = amountIn * 997;
        out = inFee * rout / (rin * 1000 + inFee);
    }

    function _pairSwap(address pair, address a, address b, uint256 out, address to) private {
        (uint256 o0, uint256 o1) = a < b ? (uint256(0), out) : (out, uint256(0));
        IUniswapV2Pair(pair).swap(o0, o1, to, "");
    }
}
