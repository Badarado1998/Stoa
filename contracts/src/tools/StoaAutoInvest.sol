// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {StoaRouter} from "../StoaRouter.sol";

/// @title StoaAutoInvest
/// @notice Recurring buys ("$10 of a stock token every week"). An owner creates a plan: what to sell, what to buy, how
///         much each time, how often and how many times. The funds stay in the owner's wallet: each buy pulls one
///         amount (the owner approves this contract) and swaps it through the Stoa router straight to the owner.
///         A buy that is due is run by the plan's runner (Stoa's keeper, which pays the gas) or by the owner.
/// @dev    No owner, no settings, no fee, holds nothing between calls. The route is the router's own quote, read
///         on-chain in the same transaction. The runner passes a minimum from its own quote taken before sending, and
///         the contract also requires that minimum to be at least the on-chain quote less the plan's slippage: a pool
///         pushed off price just before the buy makes it revert instead of fill badly, and the runner cannot accept
///         less than the plan allows. Only the runner or the owner may run a plan, so nobody else can pick the moment.
///         A buy that cannot be made (allowance, balance, price) reverts and stays due. After a buy, the next one is
///         due `interval` later, counted from that buy, so a missed day never turns into a burst.
contract StoaAutoInvest is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Plan {
        address owner;
        address tokenIn;
        address tokenOut;
        uint96 amount; // per buy, in tokenIn units
        uint32 interval; // seconds between buys
        uint16 left; // buys still to make
        uint16 slipBps; // the most a buy may get below the router's quote
        uint64 nextAt; // when the next buy is due
        address runner; // who may run its buys besides the owner
    }

    uint32 public constant MIN_INTERVAL = 1 hours;
    uint32 public constant MAX_INTERVAL = 90 days;
    uint16 public constant MAX_BUYS = 1000;
    uint16 public constant MAX_SLIP_BPS = 500;

    StoaRouter public immutable router;
    Plan[] internal _plans;
    mapping(address => uint256[]) internal _ids;

    event Created(uint256 indexed id, address indexed owner, address tokenIn, address tokenOut, uint256 amount, uint32 interval, uint16 buys, uint16 slipBps, uint64 firstAt, address runner);
    event Bought(uint256 indexed id, address indexed owner, uint256 amountIn, uint256 amountOut, uint16 left, address runner);
    event Cancelled(uint256 indexed id, address indexed owner);

    error ZeroAddress();
    error BadPlan();
    error NotOwner();
    error NotRunner();
    error LowMinimum();
    error NotDue();
    error Done();
    error NoRoute();
    error ShortTransfer();

    constructor(StoaRouter router_) {
        if (address(router_) == address(0)) revert ZeroAddress();
        router = router_;
    }

    /// @notice Start a plan. The first buy is due at `firstAt` (0 = now). Approve this contract for tokenIn: at least
    ///         one amount, or amount x buys to cover the whole plan.
    function create(
        address tokenIn,
        address tokenOut,
        uint96 amount,
        uint32 interval,
        uint16 buys,
        uint16 slipBps,
        uint64 firstAt,
        address runner
    ) external returns (uint256 id) {
        if (tokenIn == address(0) || tokenIn == tokenOut || amount == 0 || runner == address(0)) revert BadPlan();
        if (interval < MIN_INTERVAL || interval > MAX_INTERVAL || buys == 0 || buys > MAX_BUYS) revert BadPlan();
        if (slipBps == 0 || slipBps > MAX_SLIP_BPS) revert BadPlan();
        uint64 at = firstAt < block.timestamp ? uint64(block.timestamp) : firstAt;
        if (at > block.timestamp + MAX_INTERVAL) revert BadPlan();
        id = _plans.length;
        _plans.push(Plan(msg.sender, tokenIn, tokenOut, amount, interval, buys, slipBps, at, runner));
        _ids[msg.sender].push(id);
        emit Created(id, msg.sender, tokenIn, tokenOut, amount, interval, buys, slipBps, at, runner);
    }

    /// @notice Stop a plan. Nothing is held for it, so nothing comes back: revoke the allowance too if you like.
    function cancel(uint256 id) external {
        Plan storage p = _plans[id];
        if (p.owner != msg.sender) revert NotOwner();
        p.left = 0;
        emit Cancelled(id, msg.sender);
    }

    /// @notice Make a due buy along the router's current best route, for at least `minOut` (the runner's own quote less
    ///         the plan's slippage). Only the plan's runner or its owner.
    function execute(uint256 id, uint256 minOut) external nonReentrant returns (uint256 amountOut) {
        Plan storage p = _plans[id];
        if (msg.sender != p.runner && msg.sender != p.owner) revert NotRunner();
        if (p.left == 0) revert Done();
        if (block.timestamp < p.nextAt) revert NotDue();
        (address owner, address tin, address tout, uint256 amt) = (p.owner, p.tokenIn, p.tokenOut, uint256(p.amount));
        uint16 left = p.left - 1;
        p.left = left;
        p.nextAt = uint64(block.timestamp) + p.interval;

        StoaRouter.Quote memory q = router.quote(tin, tout, amt);
        if (q.amountOut == 0) revert NoRoute();
        if (minOut < (q.amountOut * (10_000 - p.slipBps)) / 10_000) revert LowMinimum();

        IERC20 t = IERC20(tin);
        uint256 b0 = t.balanceOf(address(this));
        t.safeTransferFrom(owner, address(this), amt);
        if (t.balanceOf(address(this)) - b0 != amt) revert ShortTransfer();
        t.forceApprove(address(router), amt);
        amountOut = router.swap(
            StoaRouter.SwapParams({
                tokenIn: tin,
                tokenOut: tout,
                mid: q.mid,
                leg1: q.leg1,
                leg2: q.leg2,
                amountIn: amt,
                minOut: minOut,
                to: owner,
                deadline: block.timestamp,
                referrer: address(0)
            })
        );
        emit Bought(id, owner, amt, amountOut, left, msg.sender);
    }

    // ================================================================ reads

    function plan(uint256 id) external view returns (Plan memory) {
        return _plans[id];
    }

    function count() external view returns (uint256) {
        return _plans.length;
    }

    function plansOf(address owner) external view returns (uint256[] memory) {
        return _ids[owner];
    }

    /// @notice Ids from `start` (at most `max`) that are due now and still have buys left: for keepers.
    function due(uint256 start, uint256 max) external view returns (uint256[] memory ids) {
        uint256 n = _plans.length;
        uint256[] memory buf = new uint256[](max);
        uint256 k;
        for (uint256 i = start; i < n && k < max; ++i) {
            Plan storage p = _plans[i];
            if (p.left != 0 && p.nextAt <= block.timestamp) buf[k++] = i;
        }
        ids = new uint256[](k);
        for (uint256 i; i < k; ++i) ids[i] = buf[i];
    }
}
