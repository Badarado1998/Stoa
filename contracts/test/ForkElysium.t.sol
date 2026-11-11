// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {MakerRegistry} from "../src/MakerRegistry.sol";
import {FeeDistributor} from "../src/FeeDistributor.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {UniswapV2Adapter, IUniswapV2Factory} from "../src/adapters/UniswapV2Adapter.sol";
import {UniswapV3Adapter, IUniswapV3Factory} from "../src/adapters/UniswapV3Adapter.sol";
import {IMakerRegistry, IFeeDistributor} from "../src/interfaces/IStoa.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Runs the router and both Uniswap adapters against live Elysium mainnet pools.
/// Skipped unless ELYSIUM_RPC_URL is set:  ELYSIUM_RPC_URL=... forge test --match-contract ForkElysium -vv
contract ForkElysiumTest is Test {
    address constant WHYPE = 0xbA876237B0F021A6c6D852d6c26E107997cC5E81;
    address constant USDC = 0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65;
    address constant V2F = 0xBbBcC62853a5fA27b93d6Bab3E6F7ce841E25Df2;
    address constant V3F = 0x1707327F626496A7b5b3872e7E4d2879Df7d7a9f;

    StoaRouter router;
    FeeDistributor fees;
    UniswapV2Adapter v2;
    UniswapV3Adapter v3;
    address alice = makeAddr("alice");
    bool on;

    function setUp() public {
        string memory rpc = vm.envOr("ELYSIUM_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        on = true;
        MakerRegistry reg = new MakerRegistry(address(this), address(this), 1 days);
        fees = new FeeDistributor(address(this), IMakerRegistry(address(reg)));
        router = new StoaRouter(address(this), IFeeDistributor(address(fees)), WHYPE);
        v2 = new UniswapV2Adapter(IUniswapV2Factory(V2F), WHYPE, address(router));
        v3 = new UniswapV3Adapter(IUniswapV3Factory(V3F), WHYPE, address(router));
        router.addAdapter(address(v2));
        router.addAdapter(address(v3));
        fees.setNotifier(address(router), true);
        vm.deal(alice, 100 ether);
    }

    function test_fork_quotesFromBothVenues() public {
        if (!on) return vm.skip(true);
        uint256 q2 = v2.quote(WHYPE, USDC, 0.0001 ether);
        uint256 q3 = v3.quote(WHYPE, USDC, 0.0001 ether);
        console2.log("0.0001 WHYPE -> USDC  v2:", q2, " v3:", q3);
        assertTrue(q2 > 0 || q3 > 0, "no Uniswap liquidity for WHYPE/USDC");
        StoaRouter.Best memory b = router.quoteBest(WHYPE, USDC, 0.0001 ether);
        uint256 best = q2 > q3 ? q2 : q3;
        assertEq(b.amountOut, best - best * 2 / 10_000, "router takes the better venue minus 2 bps");
    }

    function test_fork_swapHypeForUsdcAndBack() public {
        if (!on) return vm.skip(true);
        StoaRouter.Best memory b = router.quoteBest(WHYPE, USDC, 0.0001 ether);
        vm.prank(alice);
        uint256 out = router.swapExactHYPEIn{value: 0.0001 ether}(
            USDC, b.amountOut * 995 / 1000, alice, block.timestamp, address(0)
        );
        console2.log("swapped 0.0001 HYPE ->", out, "USDC raw via", b.venue);
        assertEq(IERC20(USDC).balanceOf(alice), out);
        assertEq(out, b.amountOut, "fill equals quote in the same block");
        assertGt(IERC20(USDC).balanceOf(address(fees)), 0, "fee collected");

        vm.startPrank(alice);
        IERC20(USDC).approve(address(router), out);
        uint256 hypeBefore = alice.balance;
        uint256 back = router.swapExactInForHYPE(USDC, out, 0, payable(alice), block.timestamp, address(0));
        vm.stopPrank();
        console2.log("swapped back ->", back, "wei HYPE");
        assertEq(alice.balance - hypeBefore, back);
        assertEq(IERC20(USDC).balanceOf(address(router)), 0);
        assertEq(IERC20(WHYPE).balanceOf(address(v3)), 0, "adapter keeps nothing");
        assertEq(IERC20(WHYPE).balanceOf(address(v2)), 0, "adapter keeps nothing");
    }

    function test_fork_adaptersRejectStrangers() public {
        if (!on) return vm.skip(true);
        vm.expectRevert(UniswapV3Adapter.OnlyRouter.selector);
        v3.swap(WHYPE, USDC, 1 ether, 0, alice);
        vm.expectRevert(UniswapV2Adapter.OnlyRouter.selector);
        v2.swap(WHYPE, USDC, 1 ether, 0, alice);
    }

    function test_fork_v3CallbackRejectsFakePool() public {
        if (!on) return vm.skip(true);
        vm.expectRevert();
        v3.uniswapV3SwapCallback(1, -1, abi.encode(false, address(v3)));
    }
}
