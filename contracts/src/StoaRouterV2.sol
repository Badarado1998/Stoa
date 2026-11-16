// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStoaPool, IVenueAdapter, IFeeDistributor} from "./interfaces/IStoa.sol";
import {IWHYPE, ISignatureTransfer} from "./StoaRouter.sol";

/// @title StoaRouterV2
/// @notice Quotes and executes swaps across Stoa maker pools and fallback venues (adapters). A swap is split over
///         up to MAX_ROUTES routes; each route is direct or two legs through a hop token, mixing venues per leg.
///         `quote` finds the best single route, `quoteSplit` also tries splitting the input; both are eth_calls and
///         their routes are passed to `swap`. The router only executes routes through registered venues.
/// @dev Changes from StoaRouter (v1):
///      - K-1 (bug bounty, 16 Nov 2026): the minimum is checked against what the recipient actually received
///        (balance difference at the recipient), so a token that taxes transfers can no longer be delivered below
///        `minOut`; and the router fee is notified for what the FeeDistributor actually received, so such a
///        token no longer makes the swap revert with `Unbacked`.
///      - Splits: the input can be split over several routes (for example two pools of one venue reached through
///        different adapters, or a direct route and a route through USDG), which gives larger swaps more output.
///      - Hop tokens: besides WHYPE (the wrapped native token), the owner can list up to MAX_HOPS hop tokens that
///        `quote` and `quoteSplit` try (for example USDG). `swap` accepts any hop token, as v1 did: venues are the
///        allowlist.
///      Safety (unchanged): every venue must spend exactly its input (`InputNotSpent`); venues are an allowlist with
///      a delay after `lockSetup()`; the owner or the guardian can pause; the protocol fee is charged once per
///      route: by a Stoa pool if the route uses one, otherwise by the router on the route's final leg.
contract StoaRouterV2 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_FEE_BPS = 30;
    uint256 public constant MAX_VENUES = 16;
    uint256 public constant MAX_ROUTES = 5;
    uint256 public constant MAX_HOPS = 4;
    uint256 public constant MIN_DELAY = 1 hours;
    uint256 public constant MAX_DELAY = 14 days;
    /// @notice Use as tokenIn / tokenOut for the native token.
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
    /// @notice Hop tokens tried by `quote` and `quoteSplit`, besides WHYPE.
    address[] public hops;

    struct Leg {
        address venue;
        bool isPool;
    }

    /// @param mid      address(0) for a single leg; otherwise the hop token between leg1 and leg2
    /// @param amountIn the part of the swap's input sent through this route
    struct Route {
        address mid;
        Leg leg1;
        Leg leg2;
        uint256 amountIn;
    }

    /// @param tokenIn  NATIVE for the native token sent as msg.value
    /// @param tokenOut NATIVE to receive the native token
    /// @param routes   1..MAX_ROUTES routes whose amountIn add up to amountIn
    struct SwapParams {
        address tokenIn;
        address tokenOut;
        Route[] routes;
        uint256 amountIn;
        uint256 minOut;
        address to;
        uint256 deadline;
        address referrer;
    }

    struct Quote {
        uint256 amountOut; // what the recipient gets, all fees included (before any transfer tax of tokenOut)
        Route[] routes;
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
    event HopsSet(address[] hops);
    event Swept(address indexed token, address to, uint256 amount);
    /// @notice One per swap. `amountOut` is what the recipient received.
    event Routed(
        address indexed sender,
        address indexed to,
        address indexed referrer,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 routes
    );
    /// @notice One per route of a swap.
    event RouteLeg(address mid, address venue1, address venue2, uint256 amountIn);

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
    error BadSplit();

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

    /// @notice Hop tokens tried by `quote` and `quoteSplit` besides WHYPE. Only affects quoting.
    function setHops(address[] calldata h) external onlyOwner {
        if (h.length > MAX_HOPS) revert TooMany();
        for (uint256 i; i < h.length; ++i) {
            if (h[i] == address(0) || h[i] == whype) revert ZeroAddress();
        }
        hops = h;
        emit HopsSet(h);
    }

    function hopTokens() external view returns (address[] memory) {
        return hops;
    }

    // ================================================================ quoting (eth_call)

    /// @notice Best single route: direct, or two legs through WHYPE or a listed hop token, with the best venue for
    ///         each leg. Not a view because adapters simulate swaps; call it with eth_call. Use NATIVE for the
    ///         native token. An empty `routes` means no route.
    function quote(address tokenIn, address tokenOut, uint256 amountIn) public returns (Quote memory q) {
        (address a, address b) = _ab(tokenIn, tokenOut);
        if (a == b || amountIn == 0) return q;
        (Route memory r, uint256 out) = _bestRoute(a, b, amountIn);
        if (out == 0) return q;
        r.amountIn = amountIn;
        q.amountOut = out;
        q.routes = new Route[](1);
        q.routes[0] = r;
    }

    /// @notice Like `quote`, but also tries splitting the input in `parts` equal slices (2..MAX_ROUTES) over the
    ///         candidate routes (every venue for the direct pair, and the best route through each hop token),
    ///         giving each slice to the route that adds the most output. Returns the split only if it beats the
    ///         best single route. Costs roughly `parts` times the gas of `quote`.
    function quoteSplit(address tokenIn, address tokenOut, uint256 amountIn, uint256 parts)
        external
        returns (Quote memory q)
    {
        q = quote(tokenIn, tokenOut, amountIn);
        if (q.routes.length == 0 || parts < 2) return q;
        if (parts > MAX_ROUTES) parts = MAX_ROUTES;
        (address a, address b) = _ab(tokenIn, tokenOut);

        Route[] memory cand = _candidates(a, b, amountIn);
        uint256 n = cand.length;
        uint256[] memory alloc = new uint256[](n);
        uint256[] memory outAt = new uint256[](n);
        uint256 slice = amountIn / parts;
        for (uint256 s; s < parts; ++s) {
            uint256 x = s == parts - 1 ? amountIn - slice * (parts - 1) : slice;
            uint256 best = type(uint256).max;
            uint256 bestGain;
            uint256 bestOut;
            for (uint256 i; i < n; ++i) {
                uint256 o = _routeOut(cand[i], a, b, alloc[i] + x);
                if (o > outAt[i] && o - outAt[i] > bestGain) (best, bestGain, bestOut) = (i, o - outAt[i], o);
            }
            if (best == type(uint256).max) return q; // a slice no route takes: keep the single route
            alloc[best] += x;
            outAt[best] = bestOut;
        }
        uint256 total;
        uint256 used;
        for (uint256 i; i < n; ++i) {
            if (alloc[i] > 0) {
                total += outAt[i];
                ++used;
            }
        }
        if (total <= q.amountOut) return q;
        Route[] memory rs = new Route[](used);
        uint256 k;
        for (uint256 i; i < n; ++i) {
            if (alloc[i] > 0) {
                cand[i].amountIn = alloc[i];
                rs[k++] = cand[i];
            }
        }
        q.amountOut = total;
        q.routes = rs;
    }

    // ================================================================ swapping

    /// @notice Execute a swap along the routes from `quote` or `quoteSplit`. Send the native token as msg.value when
    ///         tokenIn is NATIVE.
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

    function _ab(address tokenIn, address tokenOut) private view returns (address a, address b) {
        a = tokenIn == NATIVE ? whype : tokenIn;
        b = tokenOut == NATIVE ? whype : tokenOut;
    }

    function _check(SwapParams calldata p) private view {
        if (block.timestamp > p.deadline) revert Expired();
        if (p.amountIn == 0) revert ZeroAmount();
        if (p.to == address(0) || p.to == address(this)) revert BadRecipient();
        if (p.tokenIn == p.tokenOut) revert BadToken();
        if (p.routes.length == 0 || p.routes.length > MAX_ROUTES) revert BadSplit();
    }

    /// @dev The router holds `p.amountIn` of `a`. Runs every route and pays the recipient. The minimum is checked
    ///      against what the recipient actually received (K-1).
    function _execute(SwapParams calldata p, address a) private returns (uint256 amountOut) {
        address b = p.tokenOut == NATIVE ? whype : p.tokenOut;
        if (a == b) revert BadToken();
        bool native = p.tokenOut == NATIVE;
        address dest = native ? address(this) : p.to;
        uint256 before = IERC20(b).balanceOf(dest);

        uint256 sum;
        for (uint256 i; i < p.routes.length; ++i) {
            Route calldata r = p.routes[i];
            if (r.amountIn == 0) revert BadSplit();
            sum += r.amountIn;
            _route(r, a, b, dest, p.referrer);
            emit RouteLeg(r.mid, r.leg1.venue, r.leg2.venue, r.amountIn);
        }
        if (sum != p.amountIn) revert BadSplit();

        amountOut = IERC20(b).balanceOf(dest) - before;
        if (native) {
            if (amountOut < p.minOut || amountOut == 0) revert Slippage();
            IWHYPE(whype).withdraw(amountOut);
            (bool ok,) = p.to.call{value: amountOut}("");
            if (!ok) revert NativeTransferFailed();
        } else if (amountOut < p.minOut || amountOut == 0) {
            revert Slippage();
        }
        emit Routed(msg.sender, p.to, p.referrer, p.tokenIn, p.tokenOut, p.amountIn, amountOut, p.routes.length);
    }

    /// @dev One route: `r.amountIn` of `a` held by the router → `b` delivered to `dest`.
    function _route(Route calldata r, address a, address b, address dest, address ref) private {
        bool hop = r.mid != address(0);
        bool routerFee = !(r.leg1.isPool || (hop && r.leg2.isPool));
        if (!hop) {
            _leg(r.leg1, a, b, r.amountIn, dest, routerFee, ref);
        } else {
            if (r.mid == a || r.mid == b) revert BadToken();
            uint256 m = _leg(r.leg1, a, r.mid, r.amountIn, address(this), false, ref);
            _leg(r.leg2, r.mid, b, m, dest, routerFee, ref);
        }
    }

    /// @dev One leg: `amountIn` of `a` held by the router → `b` delivered to `dest`. Returns what the router
    ///      measured for the leg (for a hop leg, what the router holds for the next leg). Never trusts the venue's
    ///      return value.
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
            // notify what the distributor received: a token that taxes transfers delivers less than `fee` (K-1)
            uint256 f0 = IERC20(b).balanceOf(address(feeDistributor));
            IERC20(b).safeTransfer(address(feeDistributor), fee);
            uint256 sent = IERC20(b).balanceOf(address(feeDistributor)) - f0;
            if (sent > 0) feeDistributor.notifyFee(b, sent, ref);
        }
        if (dest != address(this)) {
            uint256 d0 = IERC20(b).balanceOf(dest);
            IERC20(b).safeTransfer(dest, got);
            got = IERC20(b).balanceOf(dest) - d0;
        }
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

    /// @dev Best single route (net of fees) over the direct pair and each hop token.
    function _bestRoute(address a, address b, uint256 amountIn) private returns (Route memory best, uint256 out) {
        (Leg memory d, uint256 o) = _bestLeg(a, b, amountIn);
        if (d.venue != address(0)) {
            best.leg1 = d;
            out = d.isPool ? o : _net(o);
        }
        uint256 n = hops.length;
        for (uint256 i; i <= n; ++i) {
            address mid = i == n ? whype : hops[i];
            if (mid == a || mid == b) continue;
            (Leg memory l1, uint256 m) = _bestLeg(a, mid, amountIn);
            if (l1.venue == address(0)) continue;
            (Leg memory l2, uint256 o2) = _bestLeg(mid, b, m);
            if (l2.venue == address(0)) continue;
            uint256 net = (l1.isPool || l2.isPool) ? o2 : _net(o2);
            if (net > out) {
                out = net;
                best.mid = mid;
                best.leg1 = l1;
                best.leg2 = l2;
            }
        }
    }

    /// @dev Routes a split can use: every venue for the direct pair, and the best route through each hop token
    ///      (venues chosen at the full amount).
    function _candidates(address a, address b, uint256 amountIn) private returns (Route[] memory c) {
        address[] storage list = _pools[pairKey(a, b)];
        uint256 n = hops.length;
        c = new Route[](list.length + adapters.length + n + 1);
        uint256 k;
        for (uint256 i; i < list.length; ++i) {
            c[k++].leg1 = Leg(list[i], true);
        }
        for (uint256 i; i < adapters.length; ++i) {
            c[k++].leg1 = Leg(adapters[i], false);
        }
        for (uint256 i; i <= n; ++i) {
            address mid = i == n ? whype : hops[i];
            if (mid == a || mid == b) continue;
            (Leg memory l1, uint256 m) = _bestLeg(a, mid, amountIn);
            if (l1.venue == address(0)) continue;
            (Leg memory l2,) = _bestLeg(mid, b, m);
            if (l2.venue == address(0)) continue;
            c[k].mid = mid;
            c[k].leg1 = l1;
            c[k++].leg2 = l2;
        }
        assembly {
            mstore(c, k)
        }
    }

    /// @dev Output of one route for `x` of `a`, net of the pool or router fee; 0 if a venue cannot quote.
    function _routeOut(Route memory r, address a, address b, uint256 x) private returns (uint256) {
        if (r.mid == address(0)) {
            uint256 o = _legOut(r.leg1, a, b, x);
            return r.leg1.isPool ? o : _net(o);
        }
        uint256 m = _legOut(r.leg1, a, r.mid, x);
        if (m == 0) return 0;
        uint256 o2 = _legOut(r.leg2, r.mid, b, m);
        return (r.leg1.isPool || r.leg2.isPool) ? o2 : _net(o2);
    }

    function _legOut(Leg memory l, address a, address b, uint256 x) private returns (uint256) {
        if (l.isPool) {
            try IStoaPool(l.venue).quoteOut(a, x) returns (uint256 o) {
                return o;
            } catch {
                return 0;
            }
        }
        try IVenueAdapter(l.venue).quote(a, b, x) returns (uint256 o) {
            return o;
        } catch {
            return 0;
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
