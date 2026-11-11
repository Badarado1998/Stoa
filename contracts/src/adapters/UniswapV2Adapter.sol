// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVenueAdapter} from "../interfaces/IStoa.sol";

interface IUniswapV2Router02 {
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory);
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory);
}

/// @title UniswapV2Adapter
/// @notice Lets StoaRouter fill swaps on a Uniswap V2 deployment. Tries the direct pair and a two-hop path
///         through the hub token (WHYPE on Elysium, since launchpad tokens trade against HYPE) and uses the better one.
/// @dev Only the router may call `swap`; the router transfers `amountIn` to this contract first.
contract UniswapV2Adapter is IVenueAdapter {
    using SafeERC20 for IERC20;

    IUniswapV2Router02 public immutable v2;
    address public immutable hub;
    address public immutable stoaRouter;

    error OnlyRouter();
    error NoPath();

    constructor(IUniswapV2Router02 v2_, address hub_, address stoaRouter_) {
        v2 = v2_;
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
        (uint256 expected, address[] memory path) = _best(tokenIn, tokenOut, amountIn);
        if (expected == 0) revert NoPath();
        IERC20(tokenIn).forceApprove(address(v2), amountIn);
        uint256[] memory amounts = v2.swapExactTokensForTokens(amountIn, minOut, path, to, block.timestamp);
        IERC20(tokenIn).forceApprove(address(v2), 0);
        amountOut = amounts[amounts.length - 1];
    }

    function _best(address tokenIn, address tokenOut, uint256 amountIn)
        private
        view
        returns (uint256 best, address[] memory path)
    {
        address[] memory direct = new address[](2);
        direct[0] = tokenIn;
        direct[1] = tokenOut;
        best = _out(amountIn, direct);
        path = direct;
        if (tokenIn != hub && tokenOut != hub) {
            address[] memory viaHub = new address[](3);
            viaHub[0] = tokenIn;
            viaHub[1] = hub;
            viaHub[2] = tokenOut;
            uint256 h = _out(amountIn, viaHub);
            if (h > best) (best, path) = (h, viaHub);
        }
    }

    function _out(uint256 amountIn, address[] memory p) private view returns (uint256) {
        try v2.getAmountsOut(amountIn, p) returns (uint256[] memory a) {
            return a[a.length - 1];
        } catch {
            return 0;
        }
    }
}
