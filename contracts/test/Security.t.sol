// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MakerRegistry} from "../src/MakerRegistry.sol";
import {FeeDistributor} from "../src/FeeDistributor.sol";
import {StoaPool} from "../src/StoaPool.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {IMakerRegistry, IFeeDistributor} from "../src/interfaces/IStoa.sol";
import {MockToken, MockWHYPE, MockAdapter, LyingPool, SkimmingPool, TaxToken} from "./mocks/Mocks.sol";

/// @notice Attacks and admin-safety checks on the router.
contract SecurityTest is Test {
    MakerRegistry reg;
    FeeDistributor fees;
    StoaRouter router;
    MockWHYPE whype;
    MockToken usdc;
    address gov = makeAddr("gov");
    address guard = makeAddr("guard");
    address alice = makeAddr("alice");

    function setUp() public {
        whype = new MockWHYPE();
        usdc = new MockToken("USDC", 6);
        reg = new MakerRegistry(gov, gov, 1 days);
        fees = new FeeDistributor(gov, IMakerRegistry(address(reg)));
        router = new StoaRouter(gov, IFeeDistributor(address(fees)), address(whype), 1 days);
        vm.prank(gov);
        fees.setNotifier(address(router), true);
        usdc.mint(alice, 10_000e6);
        whype.mint(alice, 100 ether);
        vm.deal(address(whype), 1_000 ether);
        vm.startPrank(alice);
        usdc.approve(address(router), type(uint256).max);
        whype.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function _swap(uint256 minOut) internal returns (uint256) {
        vm.prank(alice);
        return router.swapExactIn(address(usdc), address(whype), 100e6, minOut, alice, block.timestamp, address(0));
    }

    // ------------------------------------------------ the router never trusts a venue

    function test_lyingPoolCannotTakeFunds() public {
        LyingPool evil = new LyingPool(address(whype), address(usdc));
        vm.prank(gov);
        router.addPool(address(evil));
        uint256 bal = usdc.balanceOf(alice);
        vm.expectRevert(StoaRouter.Slippage.selector);
        _swap(1);
        assertEq(usdc.balanceOf(alice), bal, "user keeps the input");
    }

    function test_lyingPoolPayingDustStillReverts() public {
        LyingPool evil = new LyingPool(address(whype), address(usdc));
        whype.mint(address(evil), 1 ether);
        evil.setPayHalf(true); // pays 1 wei, claims a fortune
        vm.prank(gov);
        router.addPool(address(evil));
        vm.expectRevert(StoaRouter.Slippage.selector);
        _swap(0.5 ether);
    }

    function test_venueMustSpendExactInput() public {
        SkimmingPool evil = new SkimmingPool(address(whype), address(usdc));
        whype.mint(address(evil), 10 ether);
        vm.prank(gov);
        router.addPool(address(evil));
        vm.expectRevert(StoaRouter.InputNotSpent.selector);
        _swap(0);
    }

    function test_feeOnTransferInputRejected() public {
        TaxToken tax = new TaxToken();
        tax.mint(alice, 1_000 ether);
        vm.startPrank(alice);
        tax.approve(address(router), type(uint256).max);
        vm.expectRevert(StoaRouter.BadToken.selector);
        router.swapExactIn(address(tax), address(usdc), 100 ether, 0, alice, block.timestamp, address(0));
        vm.stopPrank();
    }

    function test_badRecipientAndSameToken() public {
        MockAdapter ad = new MockAdapter(1, 1);
        whype.mint(address(ad), 100 ether);
        usdc.mint(address(ad), 100_000e6);
        vm.prank(gov);
        router.addAdapter(address(ad));
        vm.startPrank(alice);
        vm.expectRevert(StoaRouter.BadRecipient.selector);
        router.swapExactIn(address(usdc), address(whype), 1e6, 0, address(0), block.timestamp, address(0));
        vm.expectRevert(StoaRouter.BadRecipient.selector);
        router.swapExactIn(address(usdc), address(whype), 1e6, 0, address(router), block.timestamp, address(0));
        vm.expectRevert(StoaRouter.BadToken.selector);
        router.swapExactIn(address(usdc), address(usdc), 1e6, 0, alice, block.timestamp, address(0));
        vm.stopPrank();
    }

    // ------------------------------------------------ timelock on new venues

    function test_afterSetupNewVenuesWaitForDelay() public {
        MockAdapter ad = new MockAdapter(1, 1);
        vm.startPrank(gov);
        router.lockSetup();
        vm.expectRevert(StoaRouter.SetupIsLocked.selector);
        router.addAdapter(address(ad));
        router.propose(false, address(ad));
        vm.expectRevert(StoaRouter.TooEarly.selector);
        router.execute(false, address(ad));
        skip(1 days);
        router.execute(false, address(ad));
        vm.stopPrank();
        assertEq(router.adapters(0), address(ad));
    }

    function test_proposalCanBeCancelled() public {
        MockAdapter ad = new MockAdapter(1, 1);
        vm.startPrank(gov);
        router.lockSetup();
        router.propose(false, address(ad));
        router.cancel(false, address(ad));
        skip(2 days);
        vm.expectRevert(StoaRouter.NotProposed.selector);
        router.execute(false, address(ad));
        vm.stopPrank();
    }

    function test_onlyOwnerManagesVenues() public {
        MockAdapter ad = new MockAdapter(1, 1);
        vm.startPrank(alice);
        vm.expectRevert();
        router.addAdapter(address(ad));
        vm.expectRevert();
        router.propose(false, address(ad));
        vm.expectRevert();
        router.lockSetup();
        vm.stopPrank();
    }

    function test_delayBounds() public {
        vm.expectRevert(StoaRouter.BadDelay.selector);
        new StoaRouter(gov, IFeeDistributor(address(fees)), address(whype), 10 minutes);
        vm.expectRevert(StoaRouter.BadDelay.selector);
        new StoaRouter(gov, IFeeDistributor(address(fees)), address(whype), 30 days);
    }

    // ------------------------------------------------ emergency pause

    function test_guardianPausesOwnerUnpauses() public {
        MockAdapter ad = new MockAdapter(1e12, 1); // 1 USDC raw -> 1e12 wei
        whype.mint(address(ad), 1_000 ether);
        vm.startPrank(gov);
        router.addAdapter(address(ad));
        router.setGuardian(guard);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(StoaRouter.NotGuardian.selector);
        router.pause();

        vm.prank(guard);
        router.pause();
        vm.expectRevert(StoaRouter.IsPaused.selector);
        _swap(0);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(StoaRouter.IsPaused.selector);
        router.swapExactHYPEIn{value: 1 ether}(address(usdc), 0, alice, block.timestamp, address(0));

        vm.prank(guard);
        vm.expectRevert();
        router.unpause();
        vm.prank(gov);
        router.unpause();
        assertGt(_swap(1), 0);
    }

    // ------------------------------------------------ fuzz: output always measured

    function testFuzz_userAlwaysGetsAtLeastMinOut(uint256 num, uint256 amt) public {
        num = bound(num, 1, 1e13);
        amt = bound(amt, 1, 1_000e6);
        MockAdapter ad = new MockAdapter(num, 1);
        whype.mint(address(ad), type(uint128).max);
        vm.prank(gov);
        router.addAdapter(address(ad));
        StoaRouter.Best memory q = router.quoteBest(address(usdc), address(whype), amt);
        uint256 before = whype.balanceOf(alice);
        vm.prank(alice);
        try router.swapExactIn(
            address(usdc), address(whype), amt, q.amountOut, alice, block.timestamp, address(0)
        ) returns (
            uint256 out
        ) {
            assertEq(whype.balanceOf(alice) - before, out);
            assertGe(out, q.amountOut);
        } catch {
            assertEq(q.amountOut, 0);
        }
        assertEq(usdc.balanceOf(address(router)), 0);
        assertEq(whype.balanceOf(address(router)), 0);
    }
}
