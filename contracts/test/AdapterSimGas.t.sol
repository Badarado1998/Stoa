// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UniswapV3Adapter, IUniswapV3Factory} from "../src/adapters/UniswapV3Adapter.sol";
import {UniswapV3AdapterV2} from "../src/adapters/UniswapV3AdapterV2.sol";
import {CLTickSpacingAdapter, ICLTickSpacingFactory} from "../src/adapters/CLTickSpacingAdapter.sol";
import {CLTickSpacingAdapterV2} from "../src/adapters/CLTickSpacingAdapterV2.sol";
import {MockToken} from "./mocks/Mocks.sol";
import {ArbSysMock} from "./ForkRobinhood.t.sol";
import {VenuesRobinhood} from "../script/VenuesRobinhood.sol";

interface IV3FactoryFull {
    function createPool(address a, address b, uint24 fee) external returns (address);
    function getPool(address a, address b, uint24 fee) external view returns (address);
}

interface ICLFactoryFull {
    function createPool(address a, address b, int24 tickSpacing, uint160 sqrtPriceX96) external returns (address);
    function getPool(address a, address b, int24 tickSpacing) external view returns (address);
}

interface IPoolMint {
    function initialize(uint160 sqrtPriceX96) external;
    function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data)
        external
        returns (uint256, uint256);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/// @dev Adds liquidity to a V3-style pool the way any LP can, paying from its own balance.
contract Lp {
    function mint(address pool, int24 lo, int24 hi, uint128 liq) external {
        IPoolMint(pool).mint(address(this), lo, hi, liq, abi.encode(pool));
    }

    function uniswapV3MintCallback(uint256 a0, uint256 a1, bytes calldata) external {
        if (a0 > 0) IERC20(IPoolMint(msg.sender).token0()).transfer(msg.sender, a0);
        if (a1 > 0) IERC20(IPoolMint(msg.sender).token1()).transfer(msg.sender, a1);
    }
}

/// @notice The gas-griefing report of 19 Nov 2026: anyone can add a dust-liquidity tick-spacing-1 pool whose quote
///         simulation walks the whole tick bitmap. The original V3 and CL adapters run that simulation uncapped; the
///         V2 adapters cap each one at SIM_GAS and skip it. Robinhood Chain fork, mock tokens, the real factories.
///         Skipped unless ROBINHOOD_RPC_URL is set.
contract AdapterSimGasTest is Test, VenuesRobinhood {
    uint160 constant P1 = 79228162514264337593543950336; // sqrtPriceX96 for price 1
    int24 constant MAXT = 887272;
    MockToken x;
    MockToken y;
    Lp lp;
    bool on;

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        on = true;
        vm.etch(address(0x64), address(new ArbSysMock()).code);
        x = new MockToken("X", 18);
        y = new MockToken("Y", 18);
        lp = new Lp();
        x.mint(address(lp), 1e30);
        y.mint(address(lp), 1e30);
    }

    function _full(int24 sp) internal pure returns (int24 lo, int24 hi) {
        hi = (MAXT / sp) * sp;
        lo = -hi;
    }

    // ------------------------------------------------------------------ Uniswap V3

    function _v3Pool(uint24 fee, int24 sp, uint128 liq, bool thin) internal returns (address p) {
        p = IV3FactoryFull(UNI_V3_FACTORY).createPool(address(x), address(y), fee);
        IPoolMint(p).initialize(P1);
        if (thin) {
            lp.mint(p, -sp, sp, liq); // dust in one tick around the price
        } else {
            (int24 lo, int24 hi) = _full(sp);
            lp.mint(p, lo, hi, liq);
        }
    }

    function test_fork_v3_griefedPairStaysUsable() public {
        if (!on) return vm.skip(true);
        _v3Pool(3000, 60, 1e24, false); // the real market
        _v3Pool(100, 1, 1e6, true); // griefing pools on every other fee tier
        _v3Pool(500, 10, 1e6, true);
        _v3Pool(10000, 200, 1e6, true);

        UniswapV3Adapter old = new UniswapV3Adapter(IUniswapV3Factory(UNI_V3_FACTORY), WETH, address(this));
        UniswapV3AdapterV2 v2 = new UniswapV3AdapterV2(IUniswapV3Factory(UNI_V3_FACTORY), WETH, address(this));
        uint256 amt = 1e18;

        uint256 g = gasleft();
        uint256 qOld = old.quote(address(x), address(y), amt);
        uint256 gOld = g - gasleft();
        g = gasleft();
        uint256 qNew = v2.quote(address(x), address(y), amt);
        uint256 gNew = g - gasleft();
        console2.log("V3 quote out old / new:", qOld, qNew);
        console2.log("V3 quote gas old / new:", gOld, gNew);
        assertEq(qNew, qOld, "same best quote: the deep pool wins either way");
        assertGt(gOld, 20_000_000, "the original adapter walks the tick bitmaps (two such legs pass the 32M limit)");
        assertLt(gNew, 4_000_000, "capped: three skipped simulations plus the real one");

        // the swap itself, as the router calls it
        x.mint(address(v2), amt);
        g = gasleft();
        uint256 out = v2.swap(address(x), address(y), amt, qNew, address(this));
        console2.log("V3 swap gas new:", g - gasleft());
        assertEq(out, qNew);
        assertEq(y.balanceOf(address(this)), out);
    }

    function test_fork_v3_ordinaryQuotesUnchanged() public {
        if (!on) return vm.skip(true);
        UniswapV3Adapter old = new UniswapV3Adapter(IUniswapV3Factory(UNI_V3_FACTORY), WETH, address(this));
        UniswapV3AdapterV2 v2 = new UniswapV3AdapterV2(IUniswapV3Factory(UNI_V3_FACTORY), WETH, address(this));
        uint256[4] memory sizes = [uint256(0.01 ether), 1 ether, 10 ether, 50 ether];
        for (uint256 i; i < sizes.length; ++i) {
            uint256 a = old.quote(WETH, USDG, sizes[i]);
            uint256 b = v2.quote(WETH, USDG, sizes[i]);
            console2.log("live WETH->USDG", sizes[i], a, b);
            assertEq(b, a, "same quote on live pools");
        }
        assertEq(v2.quote(USDG, WETH, 5000e6), old.quote(USDG, WETH, 5000e6));
    }

    function test_fork_v3_lowGasReverts() public {
        if (!on) return vm.skip(true);
        _v3Pool(3000, 60, 1e24, false);
        UniswapV3AdapterV2 v2 = new UniswapV3AdapterV2(IUniswapV3Factory(UNI_V3_FACTORY), WETH, address(this));
        // too little gas for a full simulation: reverts instead of quietly skipping a pool that would have won
        vm.expectRevert(UniswapV3AdapterV2.LowGas.selector);
        v2.quote{gas: 600_000}(address(x), address(y), 1e18);
    }

    // ------------------------------------------------------------------ CL (Aero Slipstream)

    function _clPool(int24 sp, uint128 liq, bool thin) internal returns (address p) {
        p = ICLFactoryFull(AERO_CL_FACTORY).createPool(address(x), address(y), sp, P1);
        if (thin) {
            lp.mint(p, -sp, sp, liq);
        } else {
            (int24 lo, int24 hi) = _full(sp);
            lp.mint(p, lo, hi, liq);
        }
    }

    function test_fork_cl_griefedPairStaysUsable() public {
        if (!on) return vm.skip(true);
        _clPool(100, 1e24, false); // the real market
        _clPool(1, 1e6, true); // griefing pools
        _clPool(10, 1e6, true);
        _clPool(50, 1e6, true);

        CLTickSpacingAdapter old =
            new CLTickSpacingAdapter(ICLTickSpacingFactory(AERO_CL_FACTORY), address(this), aeroSpacings());
        CLTickSpacingAdapterV2 v2 =
            new CLTickSpacingAdapterV2(ICLTickSpacingFactory(AERO_CL_FACTORY), address(this), aeroSpacings());
        uint256 amt = 1e18;

        uint256 g = gasleft();
        uint256 qOld = old.quote(address(x), address(y), amt);
        uint256 gOld = g - gasleft();
        g = gasleft();
        uint256 qNew = v2.quote(address(x), address(y), amt);
        uint256 gNew = g - gasleft();
        console2.log("CL quote out old / new:", qOld, qNew);
        console2.log("CL quote gas old / new:", gOld, gNew);
        assertEq(qNew, qOld, "same best quote");
        assertGt(gOld, 20_000_000, "the original adapter walks the tick bitmaps (two such legs pass the 32M limit)");
        assertLt(gNew, 4_500_000, "capped");

        x.mint(address(v2), amt);
        g = gasleft();
        uint256 out = v2.swap(address(x), address(y), amt, qNew, address(this));
        console2.log("CL swap gas new:", g - gasleft());
        assertEq(out, qNew);
    }

    function test_fork_cl_ordinaryQuotesUnchanged() public {
        if (!on) return vm.skip(true);
        CLTickSpacingAdapter old =
            new CLTickSpacingAdapter(ICLTickSpacingFactory(AERO_CL_FACTORY), address(this), aeroSpacings());
        CLTickSpacingAdapterV2 v2 =
            new CLTickSpacingAdapterV2(ICLTickSpacingFactory(AERO_CL_FACTORY), address(this), aeroSpacings());
        uint256[3] memory sizes = [uint256(0.1 ether), 5 ether, 50 ether];
        for (uint256 i; i < sizes.length; ++i) {
            uint256 a = old.quote(WETH, USDG, sizes[i]);
            uint256 b = v2.quote(WETH, USDG, sizes[i]);
            console2.log("live aero WETH->USDG", sizes[i], a, b);
            assertEq(b, a, "same quote on live pools");
        }
    }
}

import {StoaRouter} from "../src/StoaRouter.sol";
import {VenuePackageRobinhood} from "../script/VenuePackageRobinhood.sol";
import {UpVenueRobinhood} from "../script/UpVenueRobinhood.sol";

/// @notice The rollout's end state on a Robinhood Chain fork: the four gas-capped adapters in the live router and the
///         three old ones out (as the timelock would do it), then real router quotes and a real ETH -> USDG swap.
contract AdapterSimGasRolloutTest is Test, VenuesRobinhood, UpVenueRobinhood, VenuePackageRobinhood {
    StoaRouter router = StoaRouter(payable(LIVE_ROUTER));
    bool on;

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        on = true;
        vm.etch(address(0x64), address(new ArbSysMock()).code);
    }

    function test_fork_swapInGasCappedAdapters() public {
        if (!on) return vm.skip(true);
        uint256 before = router.quote(address(0), USDG, 1 ether).amountOut;
        address[4] memory ads = [
            address(new UniswapV3AdapterV2(IUniswapV3Factory(UNI_V3_FACTORY), WETH, LIVE_ROUTER)),
            address(new CLTickSpacingAdapterV2(ICLTickSpacingFactory(AERO_CL_FACTORY), LIVE_ROUTER, aeroSpacings())),
            address(
                new CLTickSpacingAdapterV2(ICLTickSpacingFactory(RAMSES_CL_FACTORY), LIVE_ROUTER, ramsesSpacings())
            ),
            address(new CLTickSpacingAdapterV2(ICLTickSpacingFactory(UP_CL_FACTORY), LIVE_ROUTER, upSpacings()))
        ];
        vm.startPrank(LIVE_TIMELOCK);
        for (uint256 i; i < 4; ++i) {
            router.propose(false, ads[i]);
        }
        vm.warp(block.timestamp + router.delay() + 1);
        for (uint256 i; i < 4; ++i) {
            router.execute(false, ads[i]);
        }
        router.removeAdapter(0x28802Ad6F9859d14dfC6226eA9A8b60686D3A2E6);
        router.removeAdapter(0xF0904B95D66f565De215cC7dc58B6054F72A9352);
        router.removeAdapter(0x87b3B896beAbdC421F9d9B0A3FD3dBbAE1ddd568);
        vm.stopPrank();
        for (uint256 i; i < 4; ++i) {
            assertTrue(router.isAdapter(ads[i]), "new adapter in");
        }
        assertFalse(router.isAdapter(0x28802Ad6F9859d14dfC6226eA9A8b60686D3A2E6), "old V3 out");

        StoaRouter.Quote memory q = router.quote(address(0), USDG, 1 ether);
        console2.log("router ETH->USDG before / after:", before, q.amountOut);
        assertGe(q.amountOut, before, "no worse than today (up. is an extra venue)");

        address alice = makeAddr("alice");
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        uint256 out = router.swap{value: 1 ether}(
            StoaRouter.SwapParams({
                tokenIn: address(0),
                tokenOut: USDG,
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
        assertEq(IERC20(USDG).balanceOf(alice), out);
    }
}
