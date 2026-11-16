// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Test.sol";
import {RouterHelper} from "./utils/RouterHelper.sol";
import {ArbSysMock} from "./ForkRobinhood.t.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {MetricAdapter, IMetricFactory, IMetricQuoter} from "../src/adapters/MetricAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VenuesRobinhood} from "../script/VenuesRobinhood.sol";
import {VenuePackageRobinhood} from "../script/VenuePackageRobinhood.sol";

/// @notice MetricAdapter against the LIVE Metric OMM pools on Robinhood Chain (WETH/USDG and tokenized stocks), with
///         the pool lists the keeper script ranks (script/data/metric-pools-4663.json), then through the live router
///         once the timelock has added the adapter.
/// Skipped unless ROBINHOOD_RPC_URL is set:  ROBINHOOD_RPC_URL=... forge test --match-contract ForkRobinhoodMetric -vv
contract ForkRobinhoodMetricTest is RouterHelper, VenuesRobinhood, VenuePackageRobinhood {
    address constant METRIC_FACTORY = 0x2a53833cc95548cf52c7b159110e22D3a9018f32;
    address constant METRIC_QUOTER = 0x3B9ea79f482094323d06064E637a7F4528560fcb;
    address constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;

    StoaRouter router = StoaRouter(payable(LIVE_ROUTER));
    MetricAdapter metric;
    address keeper = makeAddr("keeper");
    address alice = makeAddr("alice");
    bool on;

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        on = true;
        vm.etch(address(0x64), address(new ArbSysMock()).code);
        metric = new MetricAdapter(
            IMetricFactory(METRIC_FACTORY), IMetricQuoter(METRIC_QUOTER), LIVE_ROUTER, LIVE_TIMELOCK, keeper
        );
        string memory json = vm.readFile("script/data/metric-pools-4663.json");
        uint256 n;
        while (vm.keyExistsJson(json, string.concat("$[", vm.toString(n), "]"))) ++n;
        for (uint256 i; i < n; ++i) {
            string memory k = string.concat("$[", vm.toString(i), "]");
            address t0 = vm.parseJsonAddress(json, string.concat(k, ".token0"));
            address t1 = vm.parseJsonAddress(json, string.concat(k, ".token1"));
            address[] memory ps = vm.parseJsonAddressArray(json, string.concat(k, ".pools"));
            vm.prank(keeper);
            metric.setPools(t0, t1, ps);
        }
        vm.deal(alice, 100 ether);
    }

    function _quoterBest(address a, address b, uint256 amt) internal returns (uint256 best) {
        address[] memory ps = metric.poolsFor(a, b);
        bool z = a < b;
        for (uint256 i; i < ps.length; ++i) {
            try IMetricQuoter(METRIC_QUOTER)
                .quoteLiveExactInSingle(ps[i], address(metric), z, uint128(amt), z ? 0 : type(uint128).max) returns (
                uint256 qi, uint256 qo
            ) {
                if (qi == amt && qo > best) best = qo;
            } catch {}
        }
    }

    function test_fork_quotesMatchMetricsQuoter() public {
        if (!on) return vm.skip(true);
        uint256[3] memory sizes = [uint256(0.1 ether), 1 ether, 5 ether];
        for (uint256 i; i < 3; ++i) {
            uint256 q = metric.quote(WETH, USDG, sizes[i]);
            assertEq(q, _quoterBest(WETH, USDG, sizes[i]), "adapter = best pool");
            uint256 today = router.quote(address(0), USDG, sizes[i]).amountOut;
            console2.log("WETH in (wei):", sizes[i]);
            console2.log("  metric USDG (before the router fee):", q, " live router today:", today);
            assertGt(q, 0, "metric quotes WETH/USDG");
        }
        assertGt(metric.quote(USDG, WETH, 1000e6), 0, "metric quotes USDG -> WETH");
        // tokenized stocks quote while their oracle is live (US market hours); otherwise the pools refuse
        console2.log("500 USDG -> TSLA on metric (0 outside market hours):", metric.quote(USDG, TSLA, 500e6));
        assertEq(metric.quote(USDG, makeAddr("nothing"), 1e6), 0, "no pools, no quote");
    }

    function test_fork_swapPaysTheQuoteAndKeepsNothing() public {
        if (!on) return vm.skip(true);
        uint256 amt = 1 ether;
        uint256 q = metric.quote(WETH, USDG, amt);
        deal(WETH, address(metric), amt); // the router sends the input before calling swap
        vm.prank(LIVE_ROUTER);
        uint256 got = metric.swap(WETH, USDG, amt, q, alice);
        assertEq(got, q, "fills at the quote");
        assertEq(IERC20(USDG).balanceOf(alice), q, "output to the recipient");
        assertEq(IERC20(WETH).balanceOf(address(metric)), 0, "no input left behind");
        assertEq(IERC20(USDG).balanceOf(address(metric)), 0, "no output left behind");

        uint256 usd = 500e6;
        uint256 qt = metric.quote(USDG, TSLA, usd);
        if (qt == 0) return; // stock oracle closed (outside US market hours): nothing to fill
        deal(USDG, address(metric), usd);
        vm.prank(LIVE_ROUTER);
        metric.swap(USDG, TSLA, usd, qt, alice);
        assertEq(IERC20(TSLA).balanceOf(alice), qt, "tokenized stock bought at the quote");
        assertEq(IERC20(USDG).balanceOf(address(metric)), 0, "no USDG left behind");
    }

    function test_fork_onlyRouterAndOnlyActivePoolCallback() public {
        if (!on) return vm.skip(true);
        vm.expectRevert(MetricAdapter.OnlyRouter.selector);
        metric.swap(WETH, USDG, 1 ether, 0, alice);
        address pool = metric.poolsFor(WETH, USDG)[0];
        vm.prank(pool); // a real pool, but not mid-swap
        vm.expectRevert(MetricAdapter.BadCallback.selector);
        metric.metricOmmSwapCallback(1, -1, abi.encode(WETH));
    }

    function test_fork_rejectsOtherPairsAndForeignPools() public {
        if (!on) return vm.skip(true);
        address[] memory ps = metric.poolsFor(WETH, USDG);
        address[] memory one = new address[](1);
        one[0] = ps[0];
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(MetricAdapter.WrongPair.selector, ps[0]));
        metric.setPools(USDG, TSLA, one);
        one[0] = LIVE_ROUTER; // not a Metric pool
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(MetricAdapter.NotMetricPool.selector, LIVE_ROUTER));
        metric.setPools(WETH, USDG, one);
        vm.prank(alice);
        vm.expectRevert(MetricAdapter.NotKeeper.selector);
        metric.setPools(WETH, USDG, ps);
    }

    /// The timelock adds the adapter to the live router (propose, wait, execute); then a real ETH swap uses Metric
    /// whenever it quotes more than every other venue.
    function test_fork_liveRouterSwapsThroughMetric() public {
        if (!on) return vm.skip(true);
        vm.prank(LIVE_TIMELOCK);
        router.propose(false, address(metric));
        vm.warp(block.timestamp + router.delay() + 1);
        vm.prank(LIVE_TIMELOCK);
        router.execute(false, address(metric));
        assertTrue(router.isAdapter(address(metric)), "metric is a router venue");

        uint256 amt = 1 ether;
        StoaRouter.Quote memory q = router.quote(address(0), USDG, amt);
        console2.log("router quote 1 ETH -> USDG:", q.amountOut);
        console2.log("leg1 venue:", q.leg1.venue);
        uint256 before = IERC20(USDG).balanceOf(alice);
        uint256 g = gasleft();
        uint256 out = _swapAs(router, alice, address(0), USDG, amt, q.amountOut, alice, address(0));
        console2.log("swap gas:", g - gasleft());
        assertEq(IERC20(USDG).balanceOf(alice) - before, out, "paid");
        assertGe(out, q.amountOut, "at least the quote");
        assertEq(IERC20(WETH).balanceOf(address(metric)), 0, "adapter keeps nothing");

        // USDG -> TSLA: the router takes Metric or another venue, whichever pays more after its fee
        deal(USDG, alice, 500e6);
        vm.prank(alice);
        IERC20(USDG).approve(LIVE_ROUTER, 500e6);
        StoaRouter.Quote memory qs = router.quote(USDG, TSLA, 500e6);
        uint256 viaMetric = metric.quote(USDG, TSLA, 500e6);
        console2.log("500 USDG -> TSLA, router:", qs.amountOut, " metric alone:", viaMetric);
        console2.log("  venue:", qs.leg1.venue);
        assertGe(qs.amountOut, viaMetric - viaMetric * router.fallbackFeeBps() / 10_000, "never below metric");
        uint256 tsla = _swapAs(router, alice, USDG, TSLA, 500e6, qs.amountOut, alice, address(0));
        assertGe(tsla, qs.amountOut);
    }
}
