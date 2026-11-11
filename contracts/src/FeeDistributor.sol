// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IFeeDistributor, IMakerRegistry} from "./interfaces/IStoa.sol";

/// @title FeeDistributor
/// @notice Collects the 2 bps protocol fee from pools and the router. A share (10% by default) is credited
///         to the referrer of the swap; the rest accrues to the protocol and is withdrawn by the owner.
/// @dev Fees are pushed first, then `notifyFee` is called. The contract checks that its balance covers
///      everything it has accounted for, so a caller cannot credit fees it did not send.
contract FeeDistributor is IFeeDistributor, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_REFERRAL_BPS = 5_000;

    IMakerRegistry public immutable registry;
    uint16 public referralBps = 1_000; // 10% of the protocol fee

    mapping(address => bool) public isNotifier; // e.g. the router, besides listed pools
    mapping(address token => uint256) public accounted; // referral owed + protocol accrued
    mapping(address token => uint256) public protocolAccrued;
    mapping(address referrer => mapping(address token => uint256)) public referralOwed;

    event FeeNotified(
        address indexed from, address indexed token, uint256 amount, address indexed referrer, uint256 toReferrer
    );
    event ReferralClaimed(address indexed referrer, address indexed token, uint256 amount, address to);
    event ProtocolWithdrawn(address indexed token, uint256 amount, address to);
    event ReferralBpsSet(uint16 bps);
    event NotifierSet(address indexed who, bool ok);

    error NotAllowed();
    error Unbacked();
    error TooHigh();
    error ZeroAddress();

    constructor(address owner_, IMakerRegistry registry_) Ownable(owner_) {
        registry = registry_;
    }

    function notifyFee(address token, uint256 amount, address referrer) external {
        if (!isNotifier[msg.sender] && !registry.isPool(msg.sender)) revert NotAllowed();
        if (amount == 0) return;
        uint256 newAccounted = accounted[token] + amount;
        if (IERC20(token).balanceOf(address(this)) < newAccounted) revert Unbacked();
        accounted[token] = newAccounted;

        uint256 toRef = referrer == address(0) ? 0 : amount * referralBps / 10_000;
        if (toRef > 0) referralOwed[referrer][token] += toRef;
        protocolAccrued[token] += amount - toRef;
        emit FeeNotified(msg.sender, token, amount, referrer, toRef);
    }

    function claimReferral(address[] calldata tokens, address to) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        for (uint256 i; i < tokens.length; ++i) {
            address t = tokens[i];
            uint256 amt = referralOwed[msg.sender][t];
            if (amt == 0) continue;
            referralOwed[msg.sender][t] = 0;
            accounted[t] -= amt;
            IERC20(t).safeTransfer(to, amt);
            emit ReferralClaimed(msg.sender, t, amt, to);
        }
    }

    function withdrawProtocol(address token, uint256 amount, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        protocolAccrued[token] -= amount; // reverts on underflow
        accounted[token] -= amount;
        IERC20(token).safeTransfer(to, amount);
        emit ProtocolWithdrawn(token, amount, to);
    }

    function setReferralBps(uint16 bps) external onlyOwner {
        if (bps > MAX_REFERRAL_BPS) revert TooHigh();
        referralBps = bps;
        emit ReferralBpsSet(bps);
    }

    function setNotifier(address who, bool ok) external onlyOwner {
        isNotifier[who] = ok;
        emit NotifierSet(who, ok);
    }
}
