// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStoaPool, IMakerRegistry, IFeeDistributor} from "./interfaces/IStoa.sol";

/// @title StoaPool
/// @notice A maker-quoted pool for one base/quote pair (e.g. WHYPE/USDC).
///         An approved, bonded maker posts a bid and an ask with sizes and a short expiry. Traders swap
///         against the latest quote; each fill uses up the quoted size, and expired quotes cannot be filled.
/// @dev Prices are in quote-token raw units per 1e18 raw units of the base token.
///      v1 liquidity is supplied by the pool owner (the curator). Public LP vaults come in a later version.
contract StoaPool is IStoaPool, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant PRICE_SCALE = 1e18;
    uint16 public constant MAX_FEE_BPS = 30;

    struct Quote {
        uint128 bidPx; // pool buys base at this price
        uint128 askPx; // pool sells base at this price
        uint96 bidSize; // base the pool will still buy
        uint96 askSize; // base the pool will still sell
        uint64 expiry; // quote is valid while block.number < expiry
    }

    address public immutable base;
    address public immutable quote;
    IMakerRegistry public immutable registry;
    IFeeDistributor public immutable feeDistributor;

    Quote public current;
    address public quoter;

    uint16 public feeBps = 2;
    uint8 public maxValidBlocks = 2;
    uint256 public maxSwapQuote; // per-swap cap, in quote-token raw units (0 = no cap)
    bool public paused;

    event QuoteSet(address indexed maker, uint128 bidPx, uint128 askPx, uint96 bidSize, uint96 askSize, uint64 expiry);
    event QuoteCancelled(address indexed by);
    event Swap(
        address indexed sender,
        address indexed to,
        bool sellBase,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee,
        address referrer
    );
    event Withdrawn(address indexed token, uint256 amount, address to);
    event MaxSwapQuoteSet(uint256 cap);
    event FeeBpsSet(uint16 bps);
    event MaxValidBlocksSet(uint8 blocks);
    event Paused(bool paused);

    error NotMaker();
    error NotGuardian();
    error BadQuote();
    error BadToken();
    error QuoteExpired();
    error SizeExceeded();
    error CapExceeded();
    error Slippage();
    error IsPaused();
    error ZeroAmount();
    error UnsupportedToken();
    error TooHigh();

    constructor(
        address base_,
        address quote_,
        IMakerRegistry registry_,
        IFeeDistributor feeDistributor_,
        address owner_,
        uint256 maxSwapQuote_
    ) Ownable(owner_) {
        if (base_ == quote_ || base_ == address(0) || quote_ == address(0)) {
            revert BadToken();
        }
        base = base_;
        quote = quote_;
        registry = registry_;
        feeDistributor = feeDistributor_;
        maxSwapQuote = maxSwapQuote_;
    }

    modifier onlyGuardian() {
        if (msg.sender != registry.guardian()) revert NotGuardian();
        _;
    }

    // ---------------------------------------------------------------- maker

    /// @notice Post a new quote. Replaces the previous one.
    /// @param validBlocks how many blocks the quote stays valid, counting the current one (1..maxValidBlocks)
    function setQuote(uint128 bidPx, uint128 askPx, uint96 bidSize, uint96 askSize, uint8 validBlocks) external {
        if (!registry.isActiveMaker(address(this), msg.sender)) revert NotMaker();
        if (bidPx == 0 || askPx <= bidPx || validBlocks == 0 || validBlocks > maxValidBlocks) revert BadQuote();
        uint64 expiry = uint64(block.number) + validBlocks;
        current = Quote(bidPx, askPx, bidSize, askSize, expiry);
        quoter = msg.sender;
        emit QuoteSet(msg.sender, bidPx, askPx, bidSize, askSize, expiry);
    }

    /// @notice Pull the quote immediately (maker, owner or guardian).
    function cancelQuote() external {
        if (msg.sender != quoter && msg.sender != owner() && msg.sender != registry.guardian()) revert NotMaker();
        current.expiry = 0;
        emit QuoteCancelled(msg.sender);
    }

    // ---------------------------------------------------------------- trading

    function quoteOut(address tokenIn, uint256 amountIn) external view returns (uint256) {
        if (paused || amountIn == 0 || !registry.isPool(address(this))) return 0;
        Quote memory q = current;
        if (block.number >= q.expiry) return 0;
        (bool sellBase, uint256 gross, bool ok) = _price(q, tokenIn, amountIn);
        if (!ok) return 0;
        address tokenOut = sellBase ? quote : base;
        if (IERC20(tokenOut).balanceOf(address(this)) < gross) return 0;
        return gross - gross * feeBps / 10_000;
    }

    function swap(address tokenIn, uint256 amountIn, uint256 minOut, address to, address referrer)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (paused || !registry.isPool(address(this))) revert IsPaused();
        if (amountIn == 0) revert ZeroAmount();
        Quote memory q = current;
        if (block.number >= q.expiry) revert QuoteExpired();

        bool sellBase = _side(tokenIn);
        uint256 gross;
        if (sellBase) {
            if (amountIn > q.bidSize) revert SizeExceeded();
            gross = amountIn * q.bidPx / PRICE_SCALE;
            if (maxSwapQuote != 0 && gross > maxSwapQuote) revert CapExceeded();
            current.bidSize = q.bidSize - uint96(amountIn);
        } else {
            if (maxSwapQuote != 0 && amountIn > maxSwapQuote) revert CapExceeded();
            gross = amountIn * PRICE_SCALE / q.askPx;
            if (gross > q.askSize) revert SizeExceeded();
            current.askSize = q.askSize - uint96(gross);
        }
        if (gross == 0) revert ZeroAmount();

        // pull input and reject fee-on-transfer tokens
        uint256 before = IERC20(tokenIn).balanceOf(address(this));
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        if (IERC20(tokenIn).balanceOf(address(this)) - before != amountIn) revert UnsupportedToken();

        uint256 fee = gross * feeBps / 10_000;
        amountOut = gross - fee;
        if (amountOut < minOut) revert Slippage();

        address tokenOut = sellBase ? quote : base;
        IERC20(tokenOut).safeTransfer(to, amountOut);
        if (fee > 0) {
            IERC20(tokenOut).safeTransfer(address(feeDistributor), fee);
            feeDistributor.notifyFee(tokenOut, fee, referrer);
        }
        emit Swap(msg.sender, to, sellBase, amountIn, amountOut, fee, referrer);
    }

    // ---------------------------------------------------------------- owner / guardian

    /// @notice Inventory is added by plain transfer; the owner withdraws it here.
    function withdraw(address token, uint256 amount, address to) external onlyOwner nonReentrant {
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, amount, to);
    }

    function setMaxSwapQuote(uint256 cap) external onlyOwner {
        maxSwapQuote = cap;
        emit MaxSwapQuoteSet(cap);
    }

    function setMaxValidBlocks(uint8 blocks) external onlyGuardian {
        if (blocks == 0 || blocks > 20) revert TooHigh();
        maxValidBlocks = blocks;
        emit MaxValidBlocksSet(blocks);
    }

    function setFeeBps(uint16 bps) external onlyGuardian {
        if (bps > MAX_FEE_BPS) revert TooHigh();
        feeBps = bps;
        emit FeeBpsSet(bps);
    }

    function setPaused(bool p) external {
        if (msg.sender != owner() && msg.sender != registry.guardian()) revert NotGuardian();
        paused = p;
        emit Paused(p);
    }

    // ---------------------------------------------------------------- internal

    function _side(address tokenIn) private view returns (bool sellBase) {
        if (tokenIn == base) return true;
        if (tokenIn == quote) return false;
        revert BadToken();
    }

    function _price(Quote memory q, address tokenIn, uint256 amountIn)
        private
        view
        returns (bool sellBase, uint256 gross, bool ok)
    {
        if (tokenIn == base) {
            sellBase = true;
            if (amountIn > q.bidSize) return (true, 0, false);
            gross = amountIn * q.bidPx / PRICE_SCALE;
            if (maxSwapQuote != 0 && gross > maxSwapQuote) return (true, 0, false);
        } else if (tokenIn == quote) {
            if (maxSwapQuote != 0 && amountIn > maxSwapQuote) return (false, 0, false);
            gross = amountIn * PRICE_SCALE / q.askPx;
            if (gross > q.askSize) return (false, 0, false);
        } else {
            return (false, 0, false);
        }
        ok = gross > 0;
    }
}
