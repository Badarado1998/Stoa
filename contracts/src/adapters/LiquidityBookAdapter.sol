// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVenueAdapter} from "../interfaces/IStoa.sol";

interface ILBPair {
    function getTokenX() external view returns (address);
    function getTokenY() external view returns (address);
    function getSwapOut(uint128 amountIn, bool swapForY)
        external
        view
        returns (uint128 amountInLeft, uint128 amountOut, uint128 fee);
    function swap(bool swapForY, address to) external returns (bytes32 amountsOut);
}

interface ILBFactory {
    struct LBPairInformation {
        uint16 binStep;
        ILBPair LBPair;
        bool createdByOwner;
        bool ignoredForRouting;
    }

    function getAllLBPairs(address tokenX, address tokenY) external view returns (LBPairInformation[] memory);
}

/// @title LiquidityBookAdapter
/// @notice Fills swaps for StoaRouter on Liquidity Book (DLMM) pairs: every bin step the factory lists for the pair,
///         skipping pairs the factory marks as ignored for routing.
/// @dev The pair pulls its input from its own balance, so the adapter transfers first and then calls `swap`.
///      Only the router may call `swap`.
contract LiquidityBookAdapter is IVenueAdapter {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_PAIRS = 8;

    ILBFactory public immutable factory;
    address public immutable stoaRouter;

    error OnlyRouter();
    error NoPath();
    error Slippage();
    error BadConfig();

    constructor(ILBFactory factory_, address stoaRouter_) {
        if (address(factory_) == address(0) || stoaRouter_ == address(0)) revert BadConfig();
        factory = factory_;
        stoaRouter = stoaRouter_;
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256 amountOut) {
        (, amountOut,) = _best(tokenIn, tokenOut, amountIn);
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
        external
        returns (uint256 amountOut)
    {
        if (msg.sender != stoaRouter) revert OnlyRouter();
        (ILBPair pair, uint256 out, bool swapForY) = _best(tokenIn, tokenOut, amountIn);
        if (out == 0) revert NoPath();
        uint256 b0 = IERC20(tokenOut).balanceOf(to);
        IERC20(tokenIn).safeTransfer(address(pair), amountIn);
        pair.swap(swapForY, to);
        amountOut = IERC20(tokenOut).balanceOf(to) - b0;
        if (amountOut < minOut) revert Slippage();
    }

    function _best(address a, address b, uint256 amountIn)
        private
        view
        returns (ILBPair pair, uint256 out, bool swapForY)
    {
        if (a == b || amountIn == 0 || amountIn > type(uint128).max) return (pair, 0, false);
        ILBFactory.LBPairInformation[] memory list;
        try factory.getAllLBPairs(a, b) returns (ILBFactory.LBPairInformation[] memory l) {
            list = l;
        } catch {
            return (pair, 0, false);
        }
        uint256 n = list.length < MAX_PAIRS ? list.length : MAX_PAIRS;
        for (uint256 i; i < n; ++i) {
            if (list[i].ignoredForRouting) continue;
            ILBPair p = list[i].LBPair;
            bool forY;
            try p.getTokenX() returns (address x) {
                forY = x == a;
            } catch {
                continue;
            }
            try p.getSwapOut(uint128(amountIn), forY) returns (uint128 left, uint128 o, uint128) {
                if (left == 0 && o > out) (pair, out, swapForY) = (p, o, forY);
            } catch {}
        }
    }
}
