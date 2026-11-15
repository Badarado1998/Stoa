// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVenueAdapter} from "../interfaces/IStoa.sol";

interface IWETHLite {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @notice The parts of a Pons bonding curve this adapter uses (Robinhood Chain launchpad, one curve per token).
interface IPonsCurve {
    function token() external view returns (address);
    function isNativeQuote() external view returns (bool);
    function graduated() external view returns (bool);
    function readyToGraduate() external view returns (bool);
    /// real ETH in the curve plus its fixed virtual ("phantom") ETH: the x of the x*y=k curve
    function quoteReserve() external view returns (uint256);
    function realQuoteReserve() external view returns (uint256);
    /// tokens in the curve: the y of the x*y=k curve
    function tokenReserve() external view returns (uint256);
    /// tokens left to sell before graduation (tokenReserve minus the tokens kept for the graduation pool)
    function sellableTokens() external view returns (uint256);
    function graduationThreshold() external view returns (uint256);
    function feeBps() external view returns (uint256);
    function creatorTaxBps() external view returns (uint256);
    function launchedAt() external view returns (uint256);
    function snipeTaxSeconds() external view returns (uint256);
    /// msg.value must equal amountIn; tokens go to `to`
    function buy(uint256 amountIn, uint256 minOut, address to) external payable;
    /// pulls amountIn tokens from msg.sender; ETH goes to `to`
    function sell(uint256 amountIn, uint256 minOut, address to) external;
}

/// @title PonsCurveAdapter
/// @notice Fills swaps for StoaRouter on Pons bonding curves, so tokens still on their launch curve route on Stoa
///         (alone, or as one leg through WETH: USDG -> WETH on Uniswap -> token on its curve).
/// @dev Only curves the Pons factory registered for the token, quoted in native ETH, past their launch snipe-tax
///      window, and not graduated or about to graduate. The quote is the curve's own math, matched to the wei in
///      test/ForkRobinhoodPons.t.sol:
///        buy:  dx = a - a*feeBps/1e4 - a*creatorTaxBps/1e4;  out = tokenReserve*dx / (quoteReserve + dx)
///        sell: g = quoteReserve*a / (tokenReserve + a);       out = g - g*feeBps/1e4 - g*creatorTaxBps/1e4
///      A buy that would take the last sellable tokens graduates the curve and refunds part of the ETH; this adapter
///      quotes 0 for it (the router then uses another venue, or the token's Uniswap V4 pool once it exists) and
///      reverts if any ETH comes back. Each swap passes the quoted amount as the curve's own minimum, so a curve
///      that prices differently than quoted reverts instead of filling short. No owner, no admin, holds nothing
///      between transactions. Only the router may call `swap`; the router transfers `amountIn` here first.
contract PonsCurveAdapter is IVenueAdapter {
    using SafeERC20 for IERC20;

    /// PonsFactory.getLaunchedToken(address): a struct whose first two words are (token, curve)
    bytes4 private constant GET_LAUNCHED = 0x3cf28b5a;
    uint256 private constant BPS = 10_000;

    address public immutable factory;
    address public immutable weth;
    address public immutable stoaRouter;

    error OnlyRouter();
    error NoPath();
    error Slippage();
    error Refunded();

    constructor(address factory_, address weth_, address stoaRouter_) {
        if (factory_ == address(0) || weth_ == address(0) || stoaRouter_ == address(0)) revert NoPath();
        factory = factory_;
        weth = weth_;
        stoaRouter = stoaRouter_;
    }

    /// @dev WETH unwraps and curve sells pay ETH here; it leaves in the same transaction.
    receive() external payable {}

    function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256 amountOut) {
        if (amountIn == 0) return 0;
        if (tokenIn == weth) {
            IPonsCurve c = curveOf(tokenOut);
            if (address(c) != address(0)) amountOut = _buyOut(c, amountIn);
        } else if (tokenOut == weth) {
            IPonsCurve c = curveOf(tokenIn);
            if (address(c) != address(0)) amountOut = _sellOut(c, amountIn);
        }
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
        external
        returns (uint256 amountOut)
    {
        if (msg.sender != stoaRouter) revert OnlyRouter();
        uint256 e0 = address(this).balance;
        if (tokenIn == weth) {
            IPonsCurve c = curveOf(tokenOut);
            uint256 out = address(c) == address(0) ? 0 : _buyOut(c, amountIn);
            if (out == 0) revert NoPath();
            IWETHLite(weth).withdraw(amountIn);
            uint256 t0 = IERC20(tokenOut).balanceOf(to);
            c.buy{value: amountIn}(amountIn, out, to);
            if (address(this).balance != e0) revert Refunded();
            amountOut = IERC20(tokenOut).balanceOf(to) - t0;
            if (amountOut < out) revert Slippage();
        } else if (tokenOut == weth) {
            IPonsCurve c = curveOf(tokenIn);
            uint256 out = address(c) == address(0) ? 0 : _sellOut(c, amountIn);
            if (out == 0) revert NoPath();
            IERC20(tokenIn).forceApprove(address(c), amountIn);
            c.sell(amountIn, out, address(this));
            amountOut = address(this).balance - e0;
            if (amountOut < out) revert Slippage();
            IWETHLite(weth).deposit{value: amountOut}();
            IERC20(weth).safeTransfer(to, amountOut);
        } else {
            revert NoPath();
        }
        if (amountOut < minOut) revert Slippage();
    }

    /// @notice The token's Pons curve if this adapter can trade on it now, else address(0).
    function curveOf(address token) public view returns (IPonsCurve c) {
        if (token == address(0) || token == weth) return c;
        (bool ok, bytes memory r) = factory.staticcall(abi.encodeWithSelector(GET_LAUNCHED, token));
        if (!ok || r.length < 64) return c;
        (address t, address curve) = abi.decode(r, (address, address));
        if (t != token || curve.code.length == 0) return c;
        IPonsCurve k = IPonsCurve(curve);
        if (k.token() != token || !k.isNativeQuote() || k.graduated() || k.readyToGraduate()) return c;
        if (block.timestamp < k.launchedAt() + k.snipeTaxSeconds()) return c;
        c = k;
    }

    // ---------------------------------------------------------------- internal

    function _buyOut(IPonsCurve c, uint256 a) private view returns (uint256 out) {
        uint256 dx = a - a * c.feeBps() / BPS - a * c.creatorTaxBps() / BPS;
        out = c.tokenReserve() * dx / (c.quoteReserve() + dx);
        // the last sellable tokens graduate the curve and refund ETH: leave that buy to Pons
        if (out >= c.sellableTokens() || c.realQuoteReserve() + dx >= c.graduationThreshold()) return 0;
    }

    function _sellOut(IPonsCurve c, uint256 a) private view returns (uint256 out) {
        uint256 g = c.quoteReserve() * a / (c.tokenReserve() + a);
        if (g >= c.realQuoteReserve()) return 0;
        out = g - g * c.feeBps() / BPS - g * c.creatorTaxBps() / BPS;
    }
}
