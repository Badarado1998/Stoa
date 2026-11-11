// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMakerRegistry} from "./interfaces/IStoa.sol";

/// @title MakerRegistry
/// @notice Lists Stoa pools and the makers allowed to quote them. Makers post a bond in native HYPE;
///         a maker can only quote while it is approved for the pool and its bond is at least the pool minimum.
/// @dev The owner is the protocol (multisig). The owner also acts as guardian and can pause pools.
contract MakerRegistry is IMakerRegistry, Ownable2Step, ReentrancyGuard {
    struct Bond {
        uint128 amount; // active bond
        uint128 pending; // amount waiting to be withdrawn
        uint64 unlockAt; // when `pending` can be withdrawn
    }

    uint64 public constant MAX_UNBOND_DELAY = 30 days;

    uint64 public unbondDelay;
    address public treasury;

    mapping(address pool => bool) public isPool;
    mapping(address pool => uint256) public minBond;
    mapping(address pool => mapping(address maker => bool)) public approved;
    mapping(address pool => mapping(address maker => Bond)) public bonds;

    event PoolListed(address indexed pool, uint256 minBond);
    event PoolDelisted(address indexed pool);
    event MinBondSet(address indexed pool, uint256 minBond);
    event MakerApproved(address indexed pool, address indexed maker, bool approved);
    event Bonded(address indexed pool, address indexed maker, uint256 amount);
    event UnbondRequested(address indexed pool, address indexed maker, uint256 amount, uint64 unlockAt);
    event Unbonded(address indexed pool, address indexed maker, uint256 amount);
    event Slashed(address indexed pool, address indexed maker, uint256 amount);
    event UnbondDelaySet(uint64 delay);
    event TreasurySet(address treasury);

    error NotPool();
    error ZeroAmount();
    error InsufficientBond();
    error StillLocked();
    error DelayTooLong();
    error ZeroAddress();
    error TransferFailed();

    constructor(address owner_, address treasury_, uint64 unbondDelay_) Ownable(owner_) {
        if (treasury_ == address(0)) revert ZeroAddress();
        if (unbondDelay_ > MAX_UNBOND_DELAY) revert DelayTooLong();
        treasury = treasury_;
        unbondDelay = unbondDelay_;
    }

    // ---------------------------------------------------------------- views

    function guardian() external view returns (address) {
        return owner();
    }

    function isActiveMaker(address pool, address maker) external view returns (bool) {
        return isPool[pool] && approved[pool][maker] && bonds[pool][maker].amount >= minBond[pool];
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

    /// @notice Take part of a maker's bond (active first, then pending) and send it to the treasury.
    function slash(address pool, address maker, uint256 amount) external onlyOwner nonReentrant {
        Bond storage b = bonds[pool][maker];
        uint256 fromActive = amount <= b.amount ? amount : b.amount;
        uint256 rest = amount - fromActive;
        if (rest > b.pending) revert InsufficientBond();
        b.amount -= uint128(fromActive);
        b.pending -= uint128(rest);
        emit Slashed(pool, maker, amount);
        _send(treasury, amount);
    }

    function setUnbondDelay(uint64 delay) external onlyOwner {
        if (delay > MAX_UNBOND_DELAY) revert DelayTooLong();
        unbondDelay = delay;
        emit UnbondDelaySet(delay);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    // ---------------------------------------------------------------- makers

    /// @notice Add native HYPE to your bond for `pool`.
    function bond(address pool) external payable {
        if (!isPool[pool]) revert NotPool();
        if (msg.value == 0) revert ZeroAmount();
        bonds[pool][msg.sender].amount += uint128(msg.value);
        emit Bonded(pool, msg.sender, msg.value);
    }

    /// @notice Move `amount` of your active bond into the unbonding queue. Restarts the timer.
    function requestUnbond(address pool, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        Bond storage b = bonds[pool][msg.sender];
        if (amount > b.amount) revert InsufficientBond();
        b.amount -= uint128(amount);
        b.pending += uint128(amount);
        b.unlockAt = uint64(block.timestamp) + unbondDelay;
        emit UnbondRequested(pool, msg.sender, amount, b.unlockAt);
    }

    function withdrawUnbonded(address pool) external nonReentrant {
        Bond storage b = bonds[pool][msg.sender];
        if (block.timestamp < b.unlockAt) revert StillLocked();
        uint256 amount = b.pending;
        if (amount == 0) revert ZeroAmount();
        b.pending = 0;
        emit Unbonded(pool, msg.sender, amount);
        _send(msg.sender, amount);
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
