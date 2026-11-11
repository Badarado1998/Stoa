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

/// @title StoaRouter
/// @notice Finds the best fill for a swap across Stoa pools and fallback venues (Uniswap, ... via adapters) and
///         executes it in one transaction. Stoa pools charge the protocol fee themselves; on the fallback path the
///         router takes the same fee from the output.
/// @dev Safety:
///      - The router never trusts a venue's return value: it measures what the recipient actually received and
///        reverts if that is below `minOut`, and it reverts if a venue did not take exactly `amountIn`.
///      - New pools and adapters can be added instantly only during setup. After `lockSetup()` they must be
///        proposed and wait `delay` before they can be added, so users can see them coming. Removals are instant.
///      - The owner or the guardian can pause swaps; only the owner can unpause.
contract StoaRouter is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_FEE_BPS = 30;
    uint256 public constant MAX_VENUES = 16;
    uint256 public constant MIN_DELAY = 1 hours;
    uint256 public constant MAX_DELAY = 14 days;

    IFeeDistributor public immutable feeDistributor;
    address public immutable whype;
    uint256 public immutable delay;

    uint16 public fallbackFeeBps = 2;
    address public guardian;
    bool public paused;
    bool public setupLocked;

    mapping(bytes32 pair => address[]) private _pools;
    address[] public adapters;
    /// @notice id => earliest execution time of a proposed addition (0 = none)
    mapping(bytes32 id => uint256 eta) public pending;

    struct Best {
        address venue;
        bool isPool;
        uint256 amountOut; // net of protocol fee
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
    event Routed(
        address indexed sender,
        address indexed to,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address venue,
        bool isPool,
        address referrer
    );

    error Expired();
    error NoRoute();
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
    error InputNotSpent();

    constructor(address owner_, IFeeDistributor feeDistributor_, address whype_, uint256 delay_) Ownable(owner_) {
        if (delay_ < MIN_DELAY || delay_ > MAX_DELAY) revert BadDelay();
        if (address(feeDistributor_) == address(0) || whype_ == address(0)) revert NotFound();
        feeDistributor = feeDistributor_;
        whype = whype_;
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

    // ---------------------------------------------------------------- views

    function pairKey(address a, address b) public pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    function poolsFor(address a, address b) external view returns (address[] memory) {
        return _pools[pairKey(a, b)];
    }

    function adapterCount() external view returns (uint256) {
        return adapters.length;
    }

    function proposalId(bool isPool, address venue) public pure returns (bytes32) {
        return keccak256(abi.encode(isPool, venue));
    }

    // ---------------------------------------------------------------- venues

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

    function propose(bool isPool, address venue) external onlyOwner {
        if (venue == address(0) || venue.code.length == 0) revert NotFound();
        bytes32 id = proposalId(isPool, venue);
        uint256 eta = block.timestamp + delay;
        pending[id] = eta;
        emit Proposed(id, isPool, venue, eta);
    }

    function execute(bool isPool, address venue) external onlyOwner {
        bytes32 id = proposalId(isPool, venue);
        uint256 eta = pending[id];
        if (eta == 0) revert NotProposed();
        if (block.timestamp < eta) revert TooEarly();
        delete pending[id];
        if (isPool) _addPool(venue);
        else _addAdapter(venue);
    }

    function cancel(bool isPool, address venue) external onlyOwner {
        bytes32 id = proposalId(isPool, venue);
        if (pending[id] == 0) revert NotProposed();
        delete pending[id];
        emit Cancelled(id);
    }

    /// @notice Removal is instant: taking a venue out can only reduce risk.
    function removePool(address pool) external onlyOwner {
        bytes32 k = pairKey(IStoaPool(pool).base(), IStoaPool(pool).quote());
        _remove(_pools[k], pool);
        emit PoolRemoved(pool, k);
    }

    function removeAdapter(address adapter) external onlyOwner {
        _remove(adapters, adapter);
        emit AdapterRemoved(adapter);
    }

    // ---------------------------------------------------------------- admin

    function setFallbackFeeBps(uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert TooHigh();
        fallbackFeeBps = bps;
        emit FallbackFeeSet(bps);
    }

    function setGuardian(address g) external onlyOwner {
        if (g == address(0)) revert NotGuardian();
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

    // ---------------------------------------------------------------- quoting

    /// @notice Best net output for a swap. Not a view because fallback quoters simulate swaps; call it with eth_call.
    function quoteBest(address tokenIn, address tokenOut, uint256 amountIn) public returns (Best memory best) {
        if (tokenIn == tokenOut || amountIn == 0) return best;
        address[] storage list = _pools[pairKey(tokenIn, tokenOut)];
        for (uint256 i; i < list.length; ++i) {
            try IStoaPool(list[i]).quoteOut(tokenIn, amountIn) returns (uint256 out) {
                if (out > best.amountOut) best = Best(list[i], true, out);
            } catch {}
        }
        for (uint256 i; i < adapters.length; ++i) {
            try IVenueAdapter(adapters[i]).quote(tokenIn, tokenOut, amountIn) returns (uint256 gross) {
                uint256 out = gross - gross * fallbackFeeBps / 10_000;
                if (out > best.amountOut) best = Best(adapters[i], false, out);
            } catch {}
        }
    }

    // ---------------------------------------------------------------- swapping

    /// @notice Swap an exact amount of an ERC-20 for the best available output.
    function swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        address to,
        uint256 deadline,
        address referrer
    ) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        _check(deadline, amountIn, to);
        _pull(tokenIn, amountIn);
        amountOut = _route(tokenIn, tokenOut, amountIn, minOut, to, referrer);
    }

    /// @notice Swap native HYPE (sent as value) for `tokenOut`. The HYPE is wrapped to WHYPE first.
    function swapExactHYPEIn(address tokenOut, uint256 minOut, address to, uint256 deadline, address referrer)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 amountOut)
    {
        _check(deadline, msg.value, to);
        IWHYPE(whype).deposit{value: msg.value}();
        amountOut = _route(whype, tokenOut, msg.value, minOut, to, referrer);
    }

    /// @notice Swap an exact amount of an ERC-20 for native HYPE.
    function swapExactInForHYPE(
        address tokenIn,
        uint256 amountIn,
        uint256 minOut,
        address payable to,
        uint256 deadline,
        address referrer
    ) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        _check(deadline, amountIn, to);
        _pull(tokenIn, amountIn);
        amountOut = _route(tokenIn, whype, amountIn, minOut, address(this), referrer);
        IWHYPE(whype).withdraw(amountOut);
        (bool ok,) = to.call{value: amountOut}("");
        if (!ok) revert NativeTransferFailed();
    }

    // ---------------------------------------------------------------- internal

    function _check(uint256 deadline, uint256 amountIn, address to) private view {
        if (block.timestamp > deadline) revert Expired();
        if (amountIn == 0) revert ZeroAmount();
        if (to == address(0) || to == address(this)) revert BadRecipient();
    }

    /// @dev Pulls exactly `amountIn`; fee-on-transfer tokens are rejected.
    function _pull(address token, uint256 amountIn) private {
        uint256 b = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amountIn);
        if (IERC20(token).balanceOf(address(this)) - b != amountIn) revert BadToken();
    }

    /// @dev `amountIn` of `tokenIn` is already held by the router. Output is measured, never trusted.
    function _route(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to, address referrer)
        private
        returns (uint256 amountOut)
    {
        if (tokenIn == tokenOut) revert BadToken();
        Best memory best = quoteBest(tokenIn, tokenOut, amountIn);
        if (best.venue == address(0)) revert NoRoute();

        uint256 inBefore = IERC20(tokenIn).balanceOf(address(this)) - amountIn;
        if (best.isPool) {
            uint256 toBefore = IERC20(tokenOut).balanceOf(to);
            IERC20(tokenIn).forceApprove(best.venue, amountIn);
            IStoaPool(best.venue).swap(tokenIn, amountIn, minOut, to, referrer);
            IERC20(tokenIn).forceApprove(best.venue, 0);
            amountOut = IERC20(tokenOut).balanceOf(to) - toBefore;
        } else {
            uint256 outBefore = IERC20(tokenOut).balanceOf(address(this));
            IERC20(tokenIn).safeTransfer(best.venue, amountIn);
            IVenueAdapter(best.venue).swap(tokenIn, tokenOut, amountIn, 0, address(this));
            uint256 gross = IERC20(tokenOut).balanceOf(address(this)) - outBefore;
            uint256 fee = gross * fallbackFeeBps / 10_000;
            amountOut = gross - fee;
            if (amountOut < minOut) revert Slippage();
            if (to != address(this)) IERC20(tokenOut).safeTransfer(to, amountOut);
            if (fee > 0) {
                IERC20(tokenOut).safeTransfer(address(feeDistributor), fee);
                feeDistributor.notifyFee(tokenOut, fee, referrer);
            }
        }
        if (IERC20(tokenIn).balanceOf(address(this)) != inBefore) revert InputNotSpent();
        if (amountOut < minOut || amountOut == 0) revert Slippage();
        emit Routed(msg.sender, to, tokenIn, tokenOut, amountIn, amountOut, best.venue, best.isPool, referrer);
    }

    function _addPool(address pool) private {
        bytes32 k = pairKey(IStoaPool(pool).base(), IStoaPool(pool).quote());
        address[] storage list = _pools[k];
        if (list.length >= MAX_VENUES) revert TooMany();
        for (uint256 i; i < list.length; ++i) {
            if (list[i] == pool) return;
        }
        list.push(pool);
        emit PoolAdded(pool, k);
    }

    function _addAdapter(address adapter) private {
        if (adapters.length >= MAX_VENUES) revert TooMany();
        for (uint256 i; i < adapters.length; ++i) {
            if (adapters[i] == adapter) return;
        }
        adapters.push(adapter);
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
