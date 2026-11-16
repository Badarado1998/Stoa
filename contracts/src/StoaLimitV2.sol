// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {StoaRouter} from "./StoaRouter.sol";

/// @title StoaLimitV2
/// @notice Limit orders on top of StoaRouter. A maker deposits what they sell and names the least they accept. When the
///         market reaches it, Stoa's keeper (or the maker) fills the order with an ordinary router swap that pays the
///         maker directly and reverts below the maker's minimum. The maker can cancel and take the deposit back at any
///         time; after expiry anyone can return it. The contract never sends a deposit anywhere but the router (on a
///         fill) or the maker (on a cancel), and nobody, owner included, can move deposits.
/// @dev Fills are limited to the keeper and the maker: a permissionless filler could push a pool to exactly the
///      maker's minimum, fill, and keep the difference. The keeper fills at the best route the router finds.
///      V2 of StoaLimit (0xf570F16D9dBcf6FF5fF8F2b6dF321ca4Fa4355B3): the same contract without a cap on open orders
///      across all makers. That cap (1,000) let anyone fill the book with dust orders that never fill, from fresh
///      addresses, and block every new order; nobody could clear them before they expired (reported by Hey Research
///      Lab). Each maker is still limited to MAX_OPEN_PER_MAKER open orders; the keeper reads the open orders in
///      pages, so the list needs no bound.
contract StoaLimitV2 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Order {
        address maker;
        uint8 status; // OPEN, FILLED or CANCELLED
        uint64 expiry; // last second it can be filled
        address tokenIn; // NATIVE for the gas token
        address tokenOut; // NATIVE for the gas token
        address referrer; // passed to the router, earns the referral share of its fee
        uint256 amountIn;
        uint256 minOut; // the least the maker accepts, enforced by the router
    }

    address public constant NATIVE = address(0);
    uint8 public constant OPEN = 1;
    uint8 public constant FILLED = 2;
    uint8 public constant CANCELLED = 3;
    uint256 public constant MAX_TTL = 30 days;
    uint256 public constant MAX_OPEN_PER_MAKER = 20;

    StoaRouter public immutable router;
    address public guardian;
    address public keeper;
    bool public paused;

    uint256 public nextId = 1;
    mapping(uint256 => Order) internal _orders;
    mapping(address => uint256[]) internal _byMaker;
    mapping(address => uint256) public openCount;
    uint256[] internal _open;
    mapping(uint256 => uint256) internal _openPos; // index in _open + 1

    event Created(
        uint256 indexed id,
        address indexed maker,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        uint256 expiry
    );
    event Filled(uint256 indexed id, address indexed maker, uint256 amountOut, address by);
    event Cancelled(uint256 indexed id, address indexed maker, address by);
    event Paused(bool paused);
    event GuardianSet(address guardian);
    event KeeperSet(address keeper);

    error ZeroAddress();
    error BadOrder();
    error BadValue();
    error BadToken();
    error TooMany();
    error NotOpen();
    error Expired();
    error NotAllowed();
    error IsPaused();
    error NotGuardian();
    error SendFailed();
    error NoRenounce();

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    constructor(address owner_, StoaRouter router_, address guardian_, address keeper_) Ownable(owner_) {
        if (address(router_) == address(0) || guardian_ == address(0) || keeper_ == address(0)) revert ZeroAddress();
        router = router_;
        guardian = guardian_;
        keeper = keeper_;
    }

    // ================================================================ makers

    /// @notice Deposit `amountIn` of `tokenIn` (send it as msg.value for the gas token, approve it otherwise) to be
    ///         swapped for at least `minOut` of `tokenOut`, paid to you, any time until `expiry`.
    function create(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        uint64 expiry,
        address referrer
    ) external payable nonReentrant whenNotPaused returns (uint256 id) {
        if (tokenIn == tokenOut || amountIn == 0 || minOut == 0) revert BadOrder();
        if (expiry <= block.timestamp || expiry > block.timestamp + MAX_TTL) revert BadOrder();
        if (tokenOut == address(this) || tokenIn == address(this)) revert BadOrder();
        if (openCount[msg.sender] >= MAX_OPEN_PER_MAKER) revert TooMany();
        if (tokenIn == NATIVE) {
            if (msg.value != amountIn) revert BadValue();
        } else {
            if (msg.value != 0) revert BadValue();
            uint256 b0 = IERC20(tokenIn).balanceOf(address(this));
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
            // the router refuses tokens that take a fee on transfer, so they could never be filled
            if (IERC20(tokenIn).balanceOf(address(this)) - b0 != amountIn) revert BadToken();
        }
        id = nextId++;
        _orders[id] = Order({
            maker: msg.sender,
            status: OPEN,
            expiry: expiry,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            referrer: referrer,
            amountIn: amountIn,
            minOut: minOut
        });
        _byMaker[msg.sender].push(id);
        ++openCount[msg.sender];
        _open.push(id);
        _openPos[id] = _open.length;
        emit Created(id, msg.sender, tokenIn, tokenOut, amountIn, minOut, expiry);
    }

    /// @notice Cancel an open order and return its deposit to its maker. The maker can always cancel, paused or not;
    ///         once an order has expired, anyone can, and the deposit still goes only to the maker.
    function cancel(uint256 id) external nonReentrant {
        Order storage o = _orders[id];
        if (o.status != OPEN) revert NotOpen();
        if (msg.sender != o.maker && block.timestamp <= o.expiry) revert NotAllowed();
        o.status = CANCELLED;
        _close(id, o.maker);
        emit Cancelled(id, o.maker, msg.sender);
        if (o.tokenIn == NATIVE) {
            (bool ok,) = o.maker.call{value: o.amountIn}("");
            if (!ok) revert SendFailed();
        } else {
            IERC20(o.tokenIn).safeTransfer(o.maker, o.amountIn);
        }
    }

    // ================================================================ keeper

    /// @notice Fill an open order along a route from `router.quote`. Only the keeper or the order's maker. The router
    ///         pays the maker directly and reverts if that is below the order's minimum.
    function fill(uint256 id, address mid, StoaRouter.Leg calldata leg1, StoaRouter.Leg calldata leg2)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 amountOut)
    {
        Order storage o = _orders[id];
        if (o.status != OPEN) revert NotOpen();
        if (block.timestamp > o.expiry) revert Expired();
        if (msg.sender != keeper && msg.sender != o.maker) revert NotAllowed();
        o.status = FILLED;
        _close(id, o.maker);
        StoaRouter.SwapParams memory p = StoaRouter.SwapParams({
            tokenIn: o.tokenIn,
            tokenOut: o.tokenOut,
            mid: mid,
            leg1: leg1,
            leg2: leg2,
            amountIn: o.amountIn,
            minOut: o.minOut,
            to: o.maker,
            deadline: block.timestamp,
            referrer: o.referrer
        });
        if (o.tokenIn == NATIVE) {
            amountOut = router.swap{value: o.amountIn}(p);
        } else {
            IERC20(o.tokenIn).forceApprove(address(router), o.amountIn);
            amountOut = router.swap(p);
            IERC20(o.tokenIn).forceApprove(address(router), 0);
        }
        emit Filled(id, o.maker, amountOut, msg.sender);
    }

    // ================================================================ guardian and owner

    /// @notice Stops new orders and fills. Cancels keep working, so every deposit can always go back to its maker.
    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        paused = true;
        emit Paused(true);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Paused(false);
    }

    function setGuardian(address g) external onlyOwner {
        if (g == address(0)) revert ZeroAddress();
        guardian = g;
        emit GuardianSet(g);
    }

    function setKeeper(address k) external onlyOwner {
        if (k == address(0)) revert ZeroAddress();
        keeper = k;
        emit KeeperSet(k);
    }

    function renounceOwnership() public pure override {
        revert NoRenounce();
    }

    // ================================================================ views

    function order(uint256 id) external view returns (Order memory) {
        return _orders[id];
    }

    function ordersOf(address maker) external view returns (uint256[] memory) {
        return _byMaker[maker];
    }

    function openLength() external view returns (uint256) {
        return _open.length;
    }

    /// @notice Open order ids, paged, for the keeper.
    function openIds(uint256 start, uint256 count) external view returns (uint256[] memory ids) {
        uint256 n = _open.length;
        if (start >= n) return new uint256[](0);
        uint256 end = start + count > n ? n : start + count;
        ids = new uint256[](end - start);
        for (uint256 i = start; i < end; ++i) {
            ids[i - start] = _open[i];
        }
    }

    // ================================================================ internal

    function _close(uint256 id, address maker) private {
        --openCount[maker];
        uint256 pos = _openPos[id];
        uint256 last = _open[_open.length - 1];
        _open[pos - 1] = last;
        _openPos[last] = pos;
        _open.pop();
        delete _openPos[id];
    }
}
