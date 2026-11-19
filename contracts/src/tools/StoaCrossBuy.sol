// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StoaRouter} from "../StoaRouter.sol";

/// @title StoaCrossBuy
/// @notice The destination step of "buy from any chain": a cross-chain route delivers ETH to this contract together
///         with a call to `buy`, and `buy` swaps all of it through the Stoa router into the token the buyer picked,
///         sent straight to the buyer. If the swap fails for any reason (price moved past `minOut`, deadline, a paused
///         router, a token that cannot be bought), the ETH goes to the buyer instead, on this chain.
/// @dev    No owner, no settings, no storage: it never holds funds between calls and anyone may call it with their own
///         ETH. The route is computed off-chain (StoaRouter.quote) and checked by the router itself (`_check`), and
///         `minOut` bounds what the buyer accepts. A buyer that cannot receive ETH (a contract without receive) makes
///         a failed swap revert, which leaves the funds to the cross-chain provider's own fallback.
contract StoaCrossBuy {
    StoaRouter public immutable router;

    event Bought(address indexed to, address indexed tokenOut, uint256 ethIn, uint256 amountOut, address referrer);
    event Refunded(address indexed to, address indexed tokenOut, uint256 ethIn);

    error ZeroAddress();
    error NoValue();
    error RefundFailed();

    constructor(StoaRouter router_) {
        if (address(router_) == address(0)) revert ZeroAddress();
        router = router_;
    }

    /// @notice Swap all the ETH sent into `tokenOut` for `to`, along the route given; on any swap failure, send the ETH
    ///         to `to`. Returns the amount of `tokenOut` delivered (0 when refunded).
    function buy(
        address tokenOut,
        address mid,
        StoaRouter.Leg calldata leg1,
        StoaRouter.Leg calldata leg2,
        uint256 minOut,
        address to,
        uint256 deadline,
        address referrer
    ) external payable returns (uint256 amountOut) {
        if (to == address(0)) revert ZeroAddress();
        if (msg.value == 0) revert NoValue();
        StoaRouter.SwapParams memory p = StoaRouter.SwapParams({
            tokenIn: address(0),
            tokenOut: tokenOut,
            mid: mid,
            leg1: leg1,
            leg2: leg2,
            amountIn: msg.value,
            minOut: minOut,
            to: to,
            deadline: deadline,
            referrer: referrer
        });
        try router.swap{value: msg.value}(p) returns (uint256 out) {
            emit Bought(to, tokenOut, msg.value, out, referrer);
            return out;
        } catch {
            // the router reverted, so the ETH is still here: it goes to the buyer
            (bool ok,) = to.call{value: msg.value}("");
            if (!ok) revert RefundFailed();
            emit Refunded(to, tokenOut, msg.value);
            return 0;
        }
    }
}
