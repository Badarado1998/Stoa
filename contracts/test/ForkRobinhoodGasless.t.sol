// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {ArbSysMock} from "./ForkRobinhood.t.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {StoaGasless} from "../src/tools/StoaGasless.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

/// @notice StoaGasless against the live Robinhood Chain router: a trader with tokens and no gas signs an order and a
///         permit, a relayer submits them, the output lands at the trader, nothing stays in the contract.
/// Skipped unless ROBINHOOD_RPC_URL is set:  ROBINHOOD_RPC_URL=... forge test --match-contract ForkRobinhoodGasless -vv
contract ForkRobinhoodGasless is Test {
    address constant LIVE_ROUTER = 0x2F2804fad735a38015650f32f95Ad5E08D6B3eE5;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant INTC = 0xc72b96e0E48ecd4DC75E1e45396e26300BC39681;
    bytes32 constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    StoaRouter router = StoaRouter(payable(LIVE_ROUTER));
    StoaGasless g;
    uint256 pk = uint256(keccak256("stoa gasless trader"));
    address trader;
    address relayer = makeAddr("relayer");
    bool on;

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        on = true;
        vm.etch(address(0x64), address(new ArbSysMock()).code);
        g = new StoaGasless(router);
        trader = vm.addr(pk);
        vm.deal(relayer, 1 ether);
        // the trader gets USDG with ETH, then holds no ETH at all
        _fund(trader);
    }

    /// `who` gets USDG with ETH, then holds no ETH at all
    function _fund(address who) internal {
        vm.deal(who, 0.05 ether);
        StoaRouter.Quote memory q = router.quote(address(0), USDG, 0.05 ether);
        vm.prank(who);
        router.swap{value: 0.05 ether}(_params(address(0), USDG, q, 0.05 ether, 1, who));
        vm.deal(who, 0);
    }

    function _params(address tin, address tout, StoaRouter.Quote memory q, uint256 amt, uint256 minOut, address to)
        internal
        view
        returns (StoaRouter.SwapParams memory)
    {
        return StoaRouter.SwapParams({
            tokenIn: tin, tokenOut: tout, mid: q.mid, leg1: q.leg1, leg2: q.leg2, amountIn: amt, minOut: minOut,
            to: to, deadline: block.timestamp + 600, referrer: address(0)
        });
    }

    function _order(address tout, uint256 amt) internal returns (StoaGasless.Order memory o) {
        StoaRouter.Quote memory q = router.quote(USDG, tout, amt);
        assertGt(q.amountOut, 0, "no route");
        o = StoaGasless.Order({
            owner: trader, tokenIn: USDG, tokenOut: tout, amountIn: amt, minOut: (q.amountOut * 99) / 100,
            mid: q.mid, venue1: q.leg1.venue, isPool1: q.leg1.isPool, venue2: q.leg2.venue, isPool2: q.leg2.isPool,
            nonce: g.nonces(trader), deadline: block.timestamp + 600
        });
    }

    function _sign(StoaGasless.Order memory o) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, g.hashOrder(o));
        return abi.encodePacked(r, s, v);
    }

    function _permit(uint256 value) internal view returns (StoaGasless.Permit memory p) {
        uint256 dl = block.timestamp + 600;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                IERC20Permit(USDG).DOMAIN_SEPARATOR(),
                keccak256(abi.encode(PERMIT_TYPEHASH, trader, address(g), value, IERC20Permit(USDG).nonces(trader), dl))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        p = StoaGasless.Permit({value: value, deadline: dl, v: v, r: r, s: s});
    }

    function _noPermit() internal pure returns (StoaGasless.Permit memory p) {}

    function test_traderWithoutGasSwapsUsdgToStock() public {
        if (!on) return;
        uint256 amt = IERC20(USDG).balanceOf(trader) / 2;
        StoaGasless.Order memory o = _order(INTC, amt);
        uint256 b0 = IERC20(INTC).balanceOf(trader);
        bytes memory sig = _sign(o);
        StoaGasless.Permit memory p = _permit(amt);
        vm.prank(relayer);
        uint256 out = g.execute(o, sig, p);
        assertEq(IERC20(INTC).balanceOf(trader) - b0, out, "output at the trader");
        assertGe(out, o.minOut);
        assertEq(trader.balance, 0, "the trader spent no gas");
        assertEq(IERC20(USDG).balanceOf(address(g)), 0, "no input left");
        assertEq(IERC20(INTC).balanceOf(address(g)), 0, "no output left");
        assertEq(IERC20(USDG).allowance(address(g), LIVE_ROUTER), 0, "no allowance left");
        assertEq(g.nonces(trader), 1);
        console2.log("USDG in (6 dp)", amt, "INTC out (wei)", out);
    }

    function test_usdgToNativeEth() public {
        if (!on) return;
        uint256 amt = IERC20(USDG).balanceOf(trader) / 4;
        StoaGasless.Order memory o = _order(address(0), amt);
        bytes memory sig = _sign(o);
        StoaGasless.Permit memory p = _permit(amt);
        vm.prank(relayer);
        uint256 out = g.execute(o, sig, p);
        assertEq(trader.balance, out, "ETH at the trader");
        assertEq(address(g).balance, 0);
    }

    function test_replayFails() public {
        if (!on) return;
        uint256 amt = IERC20(USDG).balanceOf(trader) / 4;
        StoaGasless.Order memory o = _order(INTC, amt);
        bytes memory sig = _sign(o);
        StoaGasless.Permit memory p = _permit(amt * 2);
        vm.prank(relayer);
        g.execute(o, sig, p);
        StoaGasless.Permit memory none = _noPermit();
        vm.prank(relayer);
        vm.expectRevert(StoaGasless.BadNonce.selector);
        g.execute(o, sig, none);
    }

    function test_changedRouteOrMinimumIsRefused() public {
        if (!on) return;
        uint256 amt = IERC20(USDG).balanceOf(trader) / 4;
        StoaGasless.Order memory o = _order(INTC, amt);
        bytes memory sig = _sign(o);
        StoaGasless.Permit memory p = _permit(amt);
        o.minOut = 1; // the submitter lowers the minimum
        vm.prank(relayer);
        vm.expectRevert(StoaGasless.BadSignature.selector);
        g.execute(o, sig, p);
        o.minOut = 0;
        o.venue1 = address(0xBEEF); // or picks another route
        vm.prank(relayer);
        vm.expectRevert(StoaGasless.BadSignature.selector);
        g.execute(o, sig, p);
    }

    function test_otherSignerIsRefused() public {
        if (!on) return;
        uint256 amt = IERC20(USDG).balanceOf(trader) / 4;
        StoaGasless.Order memory o = _order(INTC, amt);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, g.hashOrder(o));
        StoaGasless.Permit memory p = _permit(amt);
        vm.prank(relayer);
        vm.expectRevert(StoaGasless.BadSignature.selector);
        g.execute(o, abi.encodePacked(r, s, v), p);
    }

    function test_expiredIsRefused() public {
        if (!on) return;
        uint256 amt = IERC20(USDG).balanceOf(trader) / 4;
        StoaGasless.Order memory o = _order(INTC, amt);
        bytes memory sig = _sign(o);
        StoaGasless.Permit memory p = _permit(amt);
        vm.warp(o.deadline + 1);
        vm.prank(relayer);
        vm.expectRevert(StoaGasless.Expired.selector);
        g.execute(o, sig, p);
    }

    function test_frontRunPermitDoesNotBlockTheOrder() public {
        if (!on) return;
        uint256 amt = IERC20(USDG).balanceOf(trader) / 4;
        StoaGasless.Order memory o = _order(INTC, amt);
        StoaGasless.Permit memory p = _permit(amt);
        // someone submits the permit alone first
        IERC20Permit(USDG).permit(trader, address(g), p.value, p.deadline, p.v, p.r, p.s);
        bytes memory sig = _sign(o);
        vm.prank(relayer);
        uint256 out = g.execute(o, sig, p);
        assertGe(out, o.minOut);
    }

    function test_cancelBurnsTheNonce() public {
        if (!on) return;
        uint256 amt = IERC20(USDG).balanceOf(trader) / 4;
        StoaGasless.Order memory o = _order(INTC, amt);
        bytes memory sig = _sign(o);
        StoaGasless.Permit memory p = _permit(amt);
        vm.prank(trader);
        g.cancel();
        vm.prank(relayer);
        vm.expectRevert(StoaGasless.BadNonce.selector);
        g.execute(o, sig, p);
    }

    /// a wallet with EIP-7702 code still signs with its own key: the well-known test key 0xA11CE has 7702 code on
    /// Robinhood Chain (delegated by someone else), so its orders must pass on ECDSA alone
    function test_walletWith7702CodeSignsWithItsKey() public {
        if (!on) return;
        pk = 0xA11CE;
        trader = vm.addr(pk);
        assertGt(trader.code.length, 0, "this test key has 7702 code on Robinhood Chain");
        _fund(trader);
        uint256 amt = IERC20(USDG).balanceOf(trader) / 4;
        StoaGasless.Order memory o = _order(INTC, amt);
        bytes memory sig = _sign(o);
        StoaGasless.Permit memory p = _permit(amt);
        vm.prank(relayer);
        assertGe(g.execute(o, sig, p), o.minOut);
    }

    function test_nativeInputIsRefused() public {
        if (!on) return;
        StoaGasless.Order memory o = _order(INTC, 1e6);
        o.tokenIn = address(0);
        bytes memory sig = _sign(o);
        vm.prank(relayer);
        vm.expectRevert(StoaGasless.NativeIn.selector);
        g.execute(o, sig, _noPermit());
    }
}
