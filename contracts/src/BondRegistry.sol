// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMakerRegistry} from "./interfaces/IStoa.sol";

/// @title BondRegistry
/// @notice Lists Stoa maker pools and the makers allowed to quote them, with bonds in an ERC-20 token ($STOA on
///         Robinhood Chain). A maker stakes one bond that covers all its pools; it can quote a pool while the owner has
///         approved it for that pool and its bond is at least the pool's minimum. Slashed bonds are burned.
/// @dev Same read surface for pools as MakerRegistry (IMakerRegistry). The owner is the protocol (the 48h timelock)
///      and acts as guardian. The unbonding delay is longer than the timelock so a maker cannot leave before a slash
///      lands. Fee-on-transfer bond tokens are refused.
contract BondRegistry is IMakerRegistry, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Bond {
        uint128 amount; // active bond
        uint128 pending; // waiting to be withdrawn
        uint64 unlockAt; // when `pending` can be withdrawn
    }

    address public constant BURN = 0x000000000000000000000000000000000000dEaD;
    uint64 public constant MAX_UNBOND_DELAY = 30 days;

    IERC20 public immutable bondToken;
    uint64 public unbondDelay;

    mapping(address pool => bool) public isPool;
    mapping(address pool => uint256) public minBond;
    mapping(address pool => mapping(address maker => bool)) public approved;
    mapping(address maker => Bond) public bonds;

    /// @notice bond tokens held for makers (active + pending)
    uint256 public totalBonded;
    /// @notice bond tokens slashed and burned so far
    uint256 public totalSlashed;

    event PoolListed(address indexed pool, uint256 minBond);
    event PoolDelisted(address indexed pool);
    event MinBondSet(address indexed pool, uint256 minBond);
    event MakerApproved(address indexed pool, address indexed maker, bool approved);
    event Bonded(address indexed maker, uint256 amount);
    event UnbondRequested(address indexed maker, uint256 amount, uint64 unlockAt);
    event Unbonded(address indexed maker, uint256 amount);
    event Slashed(address indexed maker, uint256 amount);
    event UnbondDelaySet(uint64 delay);

    error NotPool();
    error ZeroAmount();
    error InsufficientBond();
    error StillLocked();
    error DelayTooLong();
    error ZeroAddress();
    error UnsupportedToken();
    error TooLarge();

    constructor(address owner_, IERC20 bondToken_, uint64 unbondDelay_) Ownable(owner_) {
        if (address(bondToken_) == address(0)) revert ZeroAddress();
        if (unbondDelay_ > MAX_UNBOND_DELAY) revert DelayTooLong();
        bondToken = bondToken_;
        unbondDelay = unbondDelay_;
    }

    // ---------------------------------------------------------------- views

    function guardian() external view returns (address) {
        return owner();
    }

    function isActiveMaker(address pool, address maker) external view returns (bool) {
        return isPool[pool] && approved[pool][maker] && bonds[maker].amount >= minBond[pool];
    }

    // ---------------------------------------------------------------- owner

    function listPool(address pool, uint256 minBond_) external onlyOwner {
        if (pool == address(0)) revert ZeroAddress();
        isPool[pool] = true;
        minBond[pool] = minBond_;
        emit PoolListed(pool, minBond_);
    }

    function delistPool(address pool) external onlyOwner {
        isPool[pool] = false;
        emit PoolDelisted(pool);
    }

    function setMinBond(address pool, uint256 minBond_) external onlyOwner {
        if (!isPool[pool]) revert NotPool();
        minBond[pool] = minBond_;
        emit MinBondSet(pool, minBond_);
    }

    function setMakerApproval(address pool, address maker, bool ok) external onlyOwner {
        if (!isPool[pool]) revert NotPool();
        approved[pool][maker] = ok;
        emit MakerApproved(pool, maker, ok);
    }

    /// @notice Burn part of a maker's bond (active first, then pending). Used when a maker posts abusive quotes.
    function slash(address maker, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Bond storage b = bonds[maker];
        uint256 fromActive = amount <= b.amount ? amount : b.amount;
        uint256 rest = amount - fromActive;
        if (rest > b.pending) revert InsufficientBond();
        b.amount -= uint128(fromActive);
        b.pending -= uint128(rest);
        totalBonded -= amount;
        totalSlashed += amount;
        emit Slashed(maker, amount);
        bondToken.safeTransfer(BURN, amount);
    }

    function setUnbondDelay(uint64 delay) external onlyOwner {
        if (delay > MAX_UNBOND_DELAY) revert DelayTooLong();
        unbondDelay = delay;
        emit UnbondDelaySet(delay);
    }

    // ---------------------------------------------------------------- makers

    /// @notice Add `amount` of the bond token to your bond (approve this contract first).
    function bond(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount + bonds[msg.sender].amount > type(uint128).max) revert TooLarge();
        uint256 before = bondToken.balanceOf(address(this));
        bondToken.safeTransferFrom(msg.sender, address(this), amount);
        if (bondToken.balanceOf(address(this)) - before != amount) revert UnsupportedToken();
        bonds[msg.sender].amount += uint128(amount);
        totalBonded += amount;
        emit Bonded(msg.sender, amount);
    }

    /// @notice Move `amount` of your active bond into the unbonding queue. Restarts the timer for everything queued.
    function requestUnbond(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        Bond storage b = bonds[msg.sender];
        if (amount > b.amount) revert InsufficientBond();
        b.amount -= uint128(amount);
        b.pending += uint128(amount);
        b.unlockAt = uint64(block.timestamp) + unbondDelay;
        emit UnbondRequested(msg.sender, amount, b.unlockAt);
    }

    function withdrawUnbonded() external nonReentrant {
        Bond storage b = bonds[msg.sender];
        if (block.timestamp < b.unlockAt) revert StillLocked();
        uint256 amount = b.pending;
        if (amount == 0) revert ZeroAmount();
        b.pending = 0;
        totalBonded -= amount;
        emit Unbonded(msg.sender, amount);
        bondToken.safeTransfer(msg.sender, amount);
    }
}
