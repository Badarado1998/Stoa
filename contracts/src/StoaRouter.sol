// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStoaPool, IVenueAdapter, IFeeDistributor} from "./interfaces/IStoa.sol";

interface IWHYPE {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @dev Uniswap Permit2 signature transfers (canonical deployment at 0x000000000022D473030F116dDEE9F6B43aC78BA3).
interface ISignatureTransfer {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    function permitTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;
}

/// @title StoaRouter
/// @notice Quotes and executes swaps across Stoa maker pools and fallback venues (Uniswap adapters), directly or in
///         two legs through a hop token (WHYPE), mixing venues per leg. The best route is found with `quote`
///         (eth_call) and passed to `swap`; the router only executes routes through registered venues.
/// @dev Safety:
///      - Output is measured, never trusted: what the recipient actually receives must reach `minOut`, and every
///        venue must spend exactly its input (`InputNotSpent`).
///      - Venues are an allowlist. Additions are instant only during setup; after `lockSetup()` they are proposed
///        and wait `delay`. Removals are instant.
///      - The owner or the guardian can pause swaps; only the owner unpauses.
///      - The protocol fee is charged once per swap: by a Stoa pool if the route uses one, otherwise by the router
///        on the final leg.
contract StoaRouter is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_FEE_BPS = 30;
    uint256 public constant MAX_VENUES = 16;
    uint256 public constant MIN_DELAY = 1 hours;
    uint256 public constant MAX_DELAY = 14 days;
    /// @notice Use as tokenIn / tokenOut for native HYPE.
    address public constant NATIVE = address(0);

    IFeeDistributor public immutable feeDistributor;
    address public immutable whype;
    ISignatureTransfer public immutable permit2;
    uint256 public immutable delay;

    uint16 public fallbackFeeBps = 2;
    address public guardian;
    bool public paused;
    bool public setupLocked;

    mapping(bytes32 pair => address[]) private _pools;
    address[] public adapters;
    mapping(address => bool) public isPool;
    mapping(address => bool) public isAdapter;
    /// @notice proposal id => earliest execution time of a proposed addition (0 = none)
    mapping(bytes32 id => uint256 eta) public pending;

    struct Leg {
        address venue;
        bool isPool;
    }

    /// @param tokenIn  NATIVE for HYPE sent as msg.value
    /// @param tokenOut NATIVE to receive HYPE
    /// @param mid      address(0) for a single leg; otherwise the hop token between leg1 and leg2
    struct SwapParams {
        address tokenIn;
        address tokenOut;
        address mid;
        Leg leg1;
        Leg leg2;
        uint256 amountIn;
        uint256 minOut;
        address to;
        uint256 deadline;
        address referrer;
    }

    struct Quote {
        uint256 amountOut; // what the recipient gets, all fees included
        address mid;
        Leg leg1;
        Leg leg2;
    }

    event PoolAdded(address indexed pool, bytes32 indexed pair);
    event PoolRemoved(address indexed pool, bytes32 indexed pair);
    event AdapterAdded(address indexed adapter);
    event AdapterRemoved(address indexed adapter);
    event Proposed(bytes32 indexed id, bool isPool, address venue, uint256 eta);
    event Cancelled(bytes32 indexed id);
    event SetupLocked();
    event GuardianSet(address guardian);
    event Paused(bool paused);
    event FallbackFeeSet(uint16 bps);
    event Swept(address indexed token, address to, uint256 amount);
    event Routed(
        address indexed sender,
        address indexed to,
        address indexed referrer,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address mid,
        address venue1,
        address venue2
    );

    error Expired();
    error Slippage();
    error ZeroAmount();
    error TooMany();
    error NotFound();
    error TooHigh();
    error NativeTransferFailed();
    error NotWhype();
    error IsPaused();
    error NotGuardian();
    error SetupIsLocked();
    error NotProposed();
    error TooEarly();
    error BadDelay();
    error BadToken();
    error BadRecipient();
    error BadValue();
    error UnknownVenue();
    error InputNotSpent();
    error ZeroAddress();

    constructor(
        address owner_,
        IFeeDistributor feeDistributor_,
        address whype_,
        ISignatureTransfer permit2_,
        uint256 delay_
    ) Ownable(owner_) {
        if (delay_ < MIN_DELAY || delay_ > MAX_DELAY) revert BadDelay();
        if (address(feeDistributor_) == address(0) || whype_ == address(0)) revert ZeroAddress();
        feeDistributor = feeDistributor_;
        whype = whype_;
        permit2 = permit2_; // may be zero on chains without Permit2; swapWithPermit2 then reverts
        delay = delay_;
        guardian = owner_;
    }

    /// @dev Only WHYPE unwrapping sends native HYPE here.
    receive() external payable {
        if (msg.sender != whype) revert NotWhype();
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    // ================================================================ views

    function pairKey(address a, address b) public pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    function poolsFor(address a, address b) external view returns (address[] memory) {
        return _pools[pairKey(a, b)];
    }

    function adapterCount() external view returns (uint256) {
        return adapters.length;
    }

    function proposalId(bool pool, address venue) public pure returns (bytes32) {
        return keccak256(abi.encode(pool, venue));
    }

    // ================================================================ venues

    /// @notice Instant addition, only before `lockSetup()`.
    function addPool(address pool) external onlyOwner {
        if (setupLocked) revert SetupIsLocked();
        _addPool(pool);
    }

    /// @notice Instant addition, only before `lockSetup()`.
    function addAdapter(address adapter) external onlyOwner {
        if (setupLocked) revert SetupIsLocked();
        _addAdapter(adapter);
    }

    /// @notice Ends the setup phase for good. From now on additions go through propose → wait `delay` → execute.
    function lockSetup() external onlyOwner {
        setupLocked = true;
        emit SetupLocked();
    }

    function propose(bool pool, address venue) external onlyOwner {
        if (venue == address(0) || venue.code.length == 0) revert NotFound();
        bytes32 id = proposalId(pool, venue);
        uint256 eta = block.timestamp + delay;
        pending[id] = eta;
        emit Proposed(id, pool, venue, eta);
    }

    function execute(bool pool, address venue) external onlyOwner {
        bytes32 id = proposalId(pool, venue);
        uint256 eta = pending[id];
        if (eta == 0) revert NotProposed();
        if (block.timestamp < eta) revert TooEarly();
        delete pending[id];
        if (pool) _addPool(venue);
        else _addAdapter(venue);
    }

    function cancel(bool pool, address venue) external onlyOwner {
        bytes32 id = proposalId(pool, venue);
        if (pending[id] == 0) revert NotProposed();
        delete pending[id];
        emit Cancelled(id);
    }

    /// @notice Removal is instant: taking a venue out can only reduce risk.
    function removePool(address pool) external onlyOwner {
        bytes32 k = pairKey(IStoaPool(pool).base(), IStoaPool(pool).quote());
        _remove(_pools[k], pool);
        isPool[pool] = false;
        emit PoolRemoved(pool, k);
    }

    function removeAdapter(address adapter) external onlyOwner {
        _remove(adapters, adapter);
        isAdapter[adapter] = false;
        emit AdapterRemoved(adapter);
    }

    // ================================================================ admin

    function setFallbackFeeBps(uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert TooHigh();
        fallbackFeeBps = bps;
        emit FallbackFeeSet(bps);
    }

    function setGuardian(address g) external onlyOwner {
        if (g == address(0)) revert ZeroAddress();
        guardian = g;
        emit GuardianSet(g);
    }

    /// @notice Emergency stop for all swaps (owner or guardian).
    function pause() external {
        if (msg.sender != owner() && msg.sender != guardian) revert NotGuardian();
        paused = true;
        emit Paused(true);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Paused(false);
    }

    /// @notice Return tokens or HYPE sent to the router by mistake. The router holds no user funds between swaps.
    function sweep(address token, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount;
        if (token == NATIVE) {
            amount = address(this).balance;
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            amount = IERC20(token).balanceOf(address(this));
            IERC20(token).safeTransfer(to, amount);
        }
        emit Swept(token, to, amount);
    }

    // ================================================================ quoting (eth_call)

    /// @notice Best route for a swap: direct, or two legs through WHYPE with the best venue for each leg.
    ///         Not a view because adapters simulate swaps; call it with eth_call. Use NATIVE for HYPE.
    function quote(address tokenIn, address tokenOut, uint256 amountIn) external returns (Quote memory q) {
        address a = tokenIn == NATIVE ? whype : tokenIn;
        address b = tokenOut == NATIVE ? whype : tokenOut;
        if (a == b || amountIn == 0) return q;

        (Leg memory d, uint256 out) = _bestLeg(a, b, amountIn);
        if (d.venue != address(0)) {
            q.amountOut = d.isPool ? out : _net(out);
            q.leg1 = d;
        }
        if (a == whype || b == whype) return q;

        (Leg memory l1, uint256 m) = _bestLeg(a, whype, amountIn);
        if (l1.venue == address(0)) return q;
        (Leg memory l2, uint256 o) = _bestLeg(whype, b, m);
        if (l2.venue == address(0)) return q;
        uint256 net = (l1.isPool || l2.isPool) ? o : _net(o);
        if (net > q.amountOut) {
            q.amountOut = net;
            q.mid = whype;
            q.leg1 = l1;
            q.leg2 = l2;
        }
    }

    // ================================================================ swapping

    /// @notice Execute a swap along a route from `quote`. Send HYPE as msg.value when tokenIn is NATIVE.
    function swap(SwapParams calldata p) external payable nonReentrant whenNotPaused returns (uint256 amountOut) {
        _check(p);
        address a;
        if (p.tokenIn == NATIVE) {
            if (msg.value != p.amountIn) revert BadValue();
            IWHYPE(whype).deposit{value: msg.value}();
            a = whype;
        } else {
            if (msg.value != 0) revert BadValue();
            uint256 b0 = IERC20(p.tokenIn).balanceOf(address(this));
            IERC20(p.tokenIn).safeTransferFrom(msg.sender, address(this), p.amountIn);
            if (IERC20(p.tokenIn).balanceOf(address(this)) - b0 != p.amountIn) revert BadToken();
            a = p.tokenIn;
        }
        amountOut = _execute(p, a);
    }

    /// @notice Same as `swap`, pulling the input with a Permit2 signature instead of an approval to this router.
    ///         The permit must be signed by msg.sender for `p.tokenIn`.
    function swapWithPermit2(
        SwapParams calldata p,
        ISignatureTransfer.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        _check(p);
        if (p.tokenIn == NATIVE || permit.permitted.token != p.tokenIn) revert BadToken();
        uint256 b0 = IERC20(p.tokenIn).balanceOf(address(this));
        permit2.permitTransferFrom(
            permit,
            ISignatureTransfer.SignatureTransferDetails({to: address(this), requestedAmount: p.amountIn}),
            msg.sender,
            signature
        );
        if (IERC20(p.tokenIn).balanceOf(address(this)) - b0 != p.amountIn) revert BadToken();
        amountOut = _execute(p, p.tokenIn);
    }

    // ================================================================ internal

    function _check(SwapParams calldata p) private view {
        if (block.timestamp > p.deadline) revert Expired();
        if (p.amountIn == 0) revert ZeroAmount();
        if (p.to == address(0) || p.to == address(this)) revert BadRecipient();
        if (p.tokenIn == p.tokenOut) revert BadToken();
    }

    /// @dev The router holds `p.amountIn` of `a`. Runs one or two legs and pays the recipient.
    function _execute(SwapParams calldata p, address a) private returns (uint256 amountOut) {
        address b = p.tokenOut == NATIVE ? whype : p.tokenOut;
        if (a == b) revert BadToken();
        bool hop = p.mid != address(0);
        bool routerFee = !(p.leg1.isPool || (hop && p.leg2.isPool));
        address dest = p.tokenOut == NATIVE ? address(this) : p.to;

        if (!hop) {
            amountOut = _leg(p.leg1, a, b, p.amountIn, dest, routerFee, p.referrer);
        } else {
            if (p.mid == a || p.mid == b) revert BadToken();
            uint256 m = _leg(p.leg1, a, p.mid, p.amountIn, address(this), false, p.referrer);
            amountOut = _leg(p.leg2, p.mid, b, m, dest, routerFee, p.referrer);
        }
        if (amountOut < p.minOut || amountOut == 0) revert Slippage();

        if (p.tokenOut == NATIVE) {
            IWHYPE(whype).withdraw(amountOut);
            (bool ok,) = p.to.call{value: amountOut}("");
            if (!ok) revert NativeTransferFailed();
        }
        _emitRouted(p, amountOut);
    }

    function _emitRouted(SwapParams calldata p, uint256 amountOut) private {
        emit Routed(
            msg.sender,
            p.to,
            p.referrer,
            p.tokenIn,
            p.tokenOut,
            p.amountIn,
            amountOut,
            p.mid,
            p.leg1.venue,
            p.leg2.venue
        );
    }

    /// @dev One leg: `amountIn` of `a` held by the router → `b` delivered to `dest`. Returns what `dest` received
    ///      (net of the router fee when `chargeFee`). Never trusts the venue's return value.
    function _leg(Leg calldata l, address a, address b, uint256 amountIn, address dest, bool chargeFee, address ref)
        private
        returns (uint256 got)
    {
        uint256 inBefore = IERC20(a).balanceOf(address(this)) - amountIn;
        if (l.isPool) got = _poolLeg(l.venue, a, b, amountIn, dest, ref);
        else got = _adapterLeg(l.venue, a, b, amountIn, dest, chargeFee, ref);
        if (IERC20(a).balanceOf(address(this)) != inBefore) revert InputNotSpent();
    }

    function _poolLeg(address pool, address a, address b, uint256 amountIn, address dest, address ref)
        private
        returns (uint256 got)
    {
        if (!isPool[pool] || pairKey(IStoaPool(pool).base(), IStoaPool(pool).quote()) != pairKey(a, b)) {
            revert UnknownVenue();
        }
        uint256 d0 = IERC20(b).balanceOf(dest);
        IERC20(a).forceApprove(pool, amountIn);
        IStoaPool(pool).swap(a, amountIn, 0, dest, ref);
        IERC20(a).forceApprove(pool, 0);
        got = IERC20(b).balanceOf(dest) - d0;
    }

    function _adapterLeg(
        address adapter,
        address a,
        address b,
        uint256 amountIn,
        address dest,
        bool chargeFee,
        address ref
    ) private returns (uint256 got) {
        if (!isAdapter[adapter]) revert UnknownVenue();
        uint256 r0 = IERC20(b).balanceOf(address(this));
        IERC20(a).safeTransfer(adapter, amountIn);
        IVenueAdapter(adapter).swap(a, b, amountIn, 0, address(this));
        uint256 gross = IERC20(b).balanceOf(address(this)) - r0;
        uint256 fee = chargeFee ? gross * fallbackFeeBps / 10_000 : 0;
        got = gross - fee;
        if (fee > 0) {
            IERC20(b).safeTransfer(address(feeDistributor), fee);
            feeDistributor.notifyFee(b, fee, ref);
        }
        if (dest != address(this)) IERC20(b).safeTransfer(dest, got);
    }

    /// @dev Best venue for one leg (pool quotes are already net of the pool fee).
    function _bestLeg(address a, address b, uint256 amountIn) private returns (Leg memory best, uint256 out) {
        address[] storage list = _pools[pairKey(a, b)];
        for (uint256 i; i < list.length; ++i) {
            try IStoaPool(list[i]).quoteOut(a, amountIn) returns (uint256 o) {
                if (o > out) (best, out) = (Leg(list[i], true), o);
            } catch {}
        }
        for (uint256 i; i < adapters.length; ++i) {
            try IVenueAdapter(adapters[i]).quote(a, b, amountIn) returns (uint256 o) {
                if (o > out) (best, out) = (Leg(adapters[i], false), o);
            } catch {}
        }
    }

    function _net(uint256 gross) private view returns (uint256) {
        return gross - gross * fallbackFeeBps / 10_000;
    }

    function _addPool(address pool) private {
        if (isPool[pool]) return;
        bytes32 k = pairKey(IStoaPool(pool).base(), IStoaPool(pool).quote());
        address[] storage list = _pools[k];
        if (list.length >= MAX_VENUES) revert TooMany();
        list.push(pool);
        isPool[pool] = true;
        emit PoolAdded(pool, k);
    }

    function _addAdapter(address adapter) private {
        if (isAdapter[adapter]) return;
        if (adapters.length >= MAX_VENUES) revert TooMany();
        adapters.push(adapter);
        isAdapter[adapter] = true;
        emit AdapterAdded(adapter);
    }

    function _remove(address[] storage list, address item) private {
        uint256 n = list.length;
        for (uint256 i; i < n; ++i) {
            if (list[i] == item) {
                list[i] = list[n - 1];
                list.pop();
                return;
            }
        }
        revert NotFound();
    }
}
