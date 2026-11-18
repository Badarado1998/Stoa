// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {UniswapV3Adapter, IUniswapV3Factory} from "../src/adapters/UniswapV3Adapter.sol";
import {UniswapV3AdapterV2} from "../src/adapters/UniswapV3AdapterV2.sol";
import {ICLTickSpacingFactory} from "../src/adapters/CLTickSpacingAdapter.sol";
import {CLTickSpacingAdapterV2} from "../src/adapters/CLTickSpacingAdapterV2.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {IVenueAdapter} from "../src/interfaces/IStoa.sol";
import {MockToken} from "./mocks/Mocks.sol";
import {IV3FactoryFull, IPoolMint, Lp} from "./AdapterSimGas.t.sol";
import {VenuesElysium} from "../script/VenuesElysium.sol";
import {RolloutSimGasElysium, ElysiumLive} from "../script/RolloutSimGasElysium.s.sol";

/// @notice The gas-capped adapters for the Elysium router (script/DeploySimGasElysium.s.sol) on an Elysium fork: a
///         griefed pair stays cheap to quote, live quotes match the adapters they replace, and the timelock operations
///         built by RolloutSimGasElysium swap them in through the real Safe. Skipped unless ELYSIUM_RPC_URL is set.
contract ElysiumSimGasTest is Test, VenuesElysium, ElysiumLive {
    uint160 constant P1 = 79228162514264337593543950336;
    int24 constant MAXT = 887272;
    StoaRouter router = StoaRouter(payable(ELY_ROUTER));
    bool on;

    function setUp() public {
        string memory rpc = vm.envOr("ELYSIUM_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        on = true;
    }

    function _new() internal returns (address[] memory ads) {
        ads = new address[](3);
        ads[0] = address(new UniswapV3AdapterV2(IUniswapV3Factory(UNI_V3_FACTORY), WHYPE, ELY_ROUTER));
        ads[1] = address(new CLTickSpacingAdapterV2(ICLTickSpacingFactory(AERO_CL_FACTORY), ELY_ROUTER, aeroSpacings()));
        ads[2] =
            address(new CLTickSpacingAdapterV2(ICLTickSpacingFactory(RAMSES_CL_FACTORY), ELY_ROUTER, ramsesSpacings()));
    }

    function test_fork_elysium_v3_griefedPairStaysUsable() public {
        if (!on) return vm.skip(true);
        MockToken x = new MockToken("X", 18);
        MockToken y = new MockToken("Y", 18);
        Lp lp = new Lp();
        x.mint(address(lp), 1e30);
        y.mint(address(lp), 1e30);
        uint24[4] memory fees = [uint24(3000), 100, 500, 10000];
        int24[4] memory sps = [int24(60), 1, 10, 200];
        for (uint256 i; i < 4; ++i) {
            address p = IV3FactoryFull(UNI_V3_FACTORY).createPool(address(x), address(y), fees[i]);
            IPoolMint(p).initialize(P1);
            if (i == 0) lp.mint(p, -(MAXT / 60) * 60, (MAXT / 60) * 60, 1e24); // the real market
            else lp.mint(p, -sps[i], sps[i], 1e6); // dust griefing pools
        }
        UniswapV3Adapter old = new UniswapV3Adapter(IUniswapV3Factory(UNI_V3_FACTORY), WHYPE, address(this));
        UniswapV3AdapterV2 v2 = new UniswapV3AdapterV2(IUniswapV3Factory(UNI_V3_FACTORY), WHYPE, address(this));

        uint256 g = gasleft();
        uint256 qOld = old.quote(address(x), address(y), 1e18);
        uint256 gOld = g - gasleft();
        g = gasleft();
        uint256 qNew = v2.quote(address(x), address(y), 1e18);
        uint256 gNew = g - gasleft();
        console2.log("Elysium V3 quote gas old / new:", gOld, gNew);
        assertEq(qNew, qOld, "same best quote");
        assertGt(gOld, 20_000_000, "the original adapter walks the tick bitmaps");
        assertLt(gNew, 4_000_000, "capped");
    }

    /// Live WHYPE/USDC on each venue. The old adapters are called with 50M gas (a common eth_call cap): where they
    /// finish, the new adapter must give the same quote; where they do not, the new one must still answer cheaply.
    function test_fork_elysium_liveQuotes() public {
        if (!on) return vm.skip(true);
        address[] memory ads = _new();
        address[3] memory old = [ELY_OLD_V3, ELY_OLD_AERO, ELY_OLD_RAMSES];
        uint256[3] memory sizes = [uint256(0.1 ether), 10 ether, 500 ether];
        for (uint256 v; v < 3; ++v) {
            for (uint256 i; i < sizes.length; ++i) {
                for (uint256 dir; dir < 2; ++dir) {
                    (address tin, address tout, uint256 amt) =
                        dir == 0 ? (WHYPE, USDC, sizes[i]) : (USDC, WHYPE, sizes[i] * 66 / 1e12);
                    uint256 g = gasleft();
                    uint256 b = IVenueAdapter(ads[v]).quote{gas: 20_000_000}(tin, tout, amt);
                    uint256 gB = g - gasleft();
                    g = gasleft();
                    (bool ok, bytes memory r) =
                        old[v].call{gas: 50_000_000}(abi.encodeCall(IVenueAdapter.quote, (tin, tout, amt)));
                    uint256 gA = g - gasleft();
                    console2.log("venue / dir / amount", v, dir, amt);
                    console2.log("  gas old / new", gA, gB);
                    assertLt(gB, 15_000_000, "new adapter stays cheap");
                    if (ok) {
                        uint256 a = abi.decode(r, (uint256));
                        console2.log("  out old / new", a, b);
                        assertEq(b, a, "same quote where the old adapter finishes");
                    } else {
                        console2.log("  old adapter ran out of 50M gas; new out", b);
                    }
                }
            }
        }
    }

    /// The exact operations the hourly workflow schedules, run through the real Safe and timelock.
    function test_fork_elysium_rolloutThroughTimelock() public {
        if (!on) return vm.skip(true);
        uint256 before = router.quote(address(0), USDC, 1 ether).amountOut;
        address[] memory ads = _new();
        RolloutSimGasElysium r = new RolloutSimGasElysium();
        (RolloutSimGasElysium.Op memory a, RolloutSimGasElysium.Op memory b) = r.opsFor(ads);
        TimelockController tl = TimelockController(payable(ELY_TIMELOCK));
        uint256 d = tl.getMinDelay();
        uint256 margin = 1 hours;

        vm.startPrank(ELY_SAFE);
        tl.scheduleBatch(a.targets, a.values, a.payloads, a.predecessor, a.salt, d);
        tl.scheduleBatch(b.targets, b.values, b.payloads, b.predecessor, b.salt, d + router.delay() + margin);
        vm.warp(block.timestamp + d);
        tl.executeBatch(a.targets, a.values, a.payloads, a.predecessor, a.salt);
        vm.expectRevert(); // B is not ready until the router's 1-day wait (plus margin) has passed
        tl.executeBatch(b.targets, b.values, b.payloads, b.predecessor, b.salt);
        vm.warp(block.timestamp + router.delay() + margin);
        tl.executeBatch(b.targets, b.values, b.payloads, b.predecessor, b.salt);
        vm.stopPrank();

        for (uint256 i; i < 3; ++i) {
            assertTrue(router.isAdapter(ads[i]), "new adapter in");
        }
        assertFalse(router.isAdapter(ELY_OLD_V3), "old V3 out");
        assertFalse(router.isAdapter(ELY_OLD_AERO), "old Aero out");
        assertFalse(router.isAdapter(ELY_OLD_RAMSES), "old Ramses out");

        StoaRouter.Quote memory q = router.quote(address(0), USDC, 1 ether);
        console2.log("router HYPE->USDC before / after:", before, q.amountOut);
        assertEq(q.amountOut, before, "same quote as today");

        address alice = makeAddr("alice");
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        uint256 out = router.swap{value: 1 ether}(
            StoaRouter.SwapParams({
                tokenIn: address(0),
                tokenOut: USDC,
                mid: q.mid,
                leg1: q.leg1,
                leg2: q.leg2,
                amountIn: 1 ether,
                minOut: q.amountOut * 995 / 1000,
                to: alice,
                deadline: block.timestamp + 60,
                referrer: address(0)
            })
        );
        console2.log("swap out via", q.leg1.venue, out);
        assertGe(out, q.amountOut * 995 / 1000);
        assertEq(IERC20(USDC).balanceOf(alice), out);
    }
}
