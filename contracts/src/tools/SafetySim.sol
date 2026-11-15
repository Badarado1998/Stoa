// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StoaRouter} from "../StoaRouter.sol";

/// @title SafetySim
/// @notice Never deployed. The app runs it with eth_call and a state override (this code at a throwaway address with
///         some gas token) to test a token before anyone buys it: buy a small amount through the live StoaRouter, then
///         sell all of it back, and report what the quotes promised against what actually arrived. A token that cannot
///         be sold, or that takes more than its quote shows, is caught before a real wallet signs anything.
contract SafetySim {
    address private constant NATIVE = address(0);

    struct Result {
        uint256 buyQuoted; // what the router's quote said the buy pays
        uint256 buyGot; // what this contract actually received
        uint256 sellQuoted; // what the router's quote said selling all of it pays
        uint256 sellGot; // gas token actually received for the sell
        bool buyOk;
        bool sellOk;
        bytes buyError; // revert data, when a step failed
        bytes sellError;
    }

    receive() external payable {}

    function check(StoaRouter router, address token, uint256 amountIn) external returns (Result memory r) {
        StoaRouter.Quote memory q = router.quote(NATIVE, token, amountIn);
        r.buyQuoted = q.amountOut;
        uint256 b0 = IERC20(token).balanceOf(address(this));
        try router.swap{value: amountIn}(_params(NATIVE, token, q, amountIn)) {
            r.buyOk = true;
        } catch (bytes memory e) {
            r.buyError = e;
            return r;
        }
        r.buyGot = IERC20(token).balanceOf(address(this)) - b0;
        if (r.buyGot == 0) return r;

        // the approval itself can be what a honeypot blocks
        try IERC20(token).approve(address(router), r.buyGot) {} catch (bytes memory e) { r.sellError = e; return r; }
        try router.quote(token, NATIVE, r.buyGot) returns (StoaRouter.Quote memory s) {
            r.sellQuoted = s.amountOut;
            uint256 e0 = address(this).balance;
            try router.swap(_params(token, NATIVE, s, r.buyGot)) {
                r.sellOk = true;
                r.sellGot = address(this).balance - e0;
            } catch (bytes memory e) {
                r.sellError = e;
            }
        } catch (bytes memory e) {
            r.sellError = e;
        }
    }

    function _params(address tokenIn, address tokenOut, StoaRouter.Quote memory q, uint256 amountIn)
        private
        view
        returns (StoaRouter.SwapParams memory)
    {
        return StoaRouter.SwapParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            mid: q.mid,
            leg1: q.leg1,
            leg2: q.leg2,
            amountIn: amountIn,
            minOut: 1,
            to: address(this),
            deadline: block.timestamp,
            referrer: address(0)
        });
    }
}
