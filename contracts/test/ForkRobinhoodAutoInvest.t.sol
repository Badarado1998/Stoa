// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {ArbSysMock} from "./ForkRobinhood.t.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {StoaAutoInvest} from "../src/tools/StoaAutoInvest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice StoaAutoInvest against the live Robinhood Chain router: a weekly USDG -> stock token plan, run by a keeper.
/// Skipped unless ROBINHOOD_RPC_URL is set:  ROBINHOOD_RPC_URL=... forge test --match-contract ForkRobinhoodAutoInvest -vv
contract ForkRobinhoodAutoInvest is Test {
    address constant LIVE_ROUTER = 0x2F2804fad735a38015650f32f95Ad5E08D6B3eE5;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant INTC = 0xc72b96e0E48ecd4DC75E1e45396e26300BC39681;
    StoaRouter router = StoaRouter(payable(LIVE_ROUTER));
    StoaAutoInvest ai;
    address owner = makeAddr("owner");
    address keeper = makeAddr("keeper");
    address stranger = makeAddr("stranger");
    bool on;

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        on = true;
        vm.etch(address(0x64), address(new ArbSysMock()).code);
        ai = new StoaAutoInvest(router);
        vm.deal(owner, 0.05 ether);
        StoaRouter.Quote memory q = router.quote(address(0), USDG, 0.04 ether);
        vm.prank(owner);
        router.swap{value: 0.04 ether}(StoaRouter.SwapParams({
            tokenIn: address(0), tokenOut: USDG, mid: q.mid, leg1: q.leg1, leg2: q.leg2, amountIn: 0.04 ether,
            minOut: 1, to: owner, deadline: block.timestamp + 600, referrer: address(0)
        }));
        vm.prank(owner);
        IERC20(USDG).approve(address(ai), type(uint256).max);
    }

    function _plan() internal returns (uint256 id) {
        vm.prank(owner);
        id = ai.create(USDG, INTC, 10e6, 7 days, 3, 100, 0, keeper); // $10 a week, 3 times, 1% slippage
    }

    function _min(uint256 amt) internal returns (uint256) {
        return (router.quote(USDG, INTC, amt).amountOut * 995) / 1000; // the keeper's own quote, 0.5% below
    }

    function test_weeklyPlanBuysForTheOwner() public {
        if (!on) return;
        uint256 id = _plan();
        uint256 b0 = IERC20(INTC).balanceOf(owner);
        uint256 m = _min(10e6);
        vm.prank(keeper);
        uint256 out = ai.execute(id, m);
        assertEq(IERC20(INTC).balanceOf(owner) - b0, out, "the owner got the stock token");
        assertEq(IERC20(USDG).balanceOf(address(ai)), 0, "nothing held");
        assertEq(IERC20(INTC).balanceOf(address(ai)), 0, "nothing held");
        StoaAutoInvest.Plan memory p = ai.plan(id);
        assertEq(p.left, 2);
        assertEq(p.nextAt, block.timestamp + 7 days);
        console2.log("10 USDG ->", out, "INTC wei");
    }

    function test_notDueUntilTheInterval() public {
        if (!on) return;
        uint256 id = _plan();
        uint256 m = _min(10e6);
        vm.prank(keeper);
        ai.execute(id, m);
        vm.warp(block.timestamp + 6 days);
        vm.prank(keeper);
        vm.expectRevert(StoaAutoInvest.NotDue.selector);
        ai.execute(id, 1);
    }

    function test_strangerCannotRunIt() public {
        if (!on) return;
        uint256 id = _plan();
        vm.prank(stranger);
        vm.expectRevert(StoaAutoInvest.NotRunner.selector);
        ai.execute(id, 1);
    }

    function test_runnerCannotAcceptLessThanThePlanAllows() public {
        if (!on) return;
        uint256 id = _plan();
        vm.prank(keeper);
        vm.expectRevert(StoaAutoInvest.LowMinimum.selector);
        ai.execute(id, 1);
    }

    function test_cancelStopsIt() public {
        if (!on) return;
        uint256 id = _plan();
        vm.prank(stranger);
        vm.expectRevert(StoaAutoInvest.NotOwner.selector);
        ai.cancel(id);
        vm.prank(owner);
        ai.cancel(id);
        vm.prank(keeper);
        vm.expectRevert(StoaAutoInvest.Done.selector);
        ai.execute(id, 1);
    }

    function test_allBuysThenDone() public {
        if (!on) return;
        uint256 id = _plan();
        for (uint256 i; i < 3; ++i) {
            uint256 m = _min(10e6);
            vm.prank(keeper);
            ai.execute(id, m);
            vm.warp(block.timestamp + 7 days);
        }
        vm.prank(keeper);
        vm.expectRevert(StoaAutoInvest.Done.selector);
        ai.execute(id, 1);
        assertEq(ai.due(0, 10).length, 0);
    }

    function test_noAllowanceRevertsAndStaysDue() public {
        if (!on) return;
        uint256 id = _plan();
        vm.prank(owner);
        IERC20(USDG).approve(address(ai), 0);
        uint256 m = _min(10e6);
        vm.prank(keeper);
        vm.expectRevert();
        ai.execute(id, m);
        assertEq(ai.plan(id).left, 3, "still due");
        assertEq(ai.due(0, 10).length, 1);
    }

    function test_badPlansAreRefused() public {
        if (!on) return;
        vm.startPrank(owner);
        vm.expectRevert(StoaAutoInvest.BadPlan.selector);
        ai.create(USDG, INTC, 10e6, 30 minutes, 3, 100, 0, keeper); // too often
        vm.expectRevert(StoaAutoInvest.BadPlan.selector);
        ai.create(USDG, INTC, 10e6, 1 days, 3, 900, 0, keeper); // too much slippage
        vm.expectRevert(StoaAutoInvest.BadPlan.selector);
        ai.create(address(0), INTC, 10e6, 1 days, 3, 100, 0, keeper); // ETH cannot be pulled
        vm.expectRevert(StoaAutoInvest.BadPlan.selector);
        ai.create(USDG, INTC, 10e6, 1 days, 3, 100, 0, address(0)); // no runner
        vm.stopPrank();
    }
}
