// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {StoaRouter} from "./StoaRouter.sol";
import {FeeDistributor} from "./FeeDistributor.sol";

/// @title StoaBuyback
/// @notice Owns the FeeDistributor. Protocol fees can leave it only one way: swapped into $STOA through the Stoa
///         router and sent to the burn address, in the same transaction.
///         - The keeper (or the owner) calls `buyback`: it withdraws protocol fees of one token, swaps them to $STOA
///           (fees already in $STOA skip the swap) and burns every $STOA this contract holds.
///         - The owner (the 48h timelock) keeps the FeeDistributor's other settings through `exec`, which refuses
///           `withdrawProtocol`. Changing the policy itself means handing the FeeDistributor to another owner, a
///           public 48h timelock action like every other.
///         Referral earnings are untouched: referrers keep claiming them from the FeeDistributor.
contract StoaBuyback is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant BURN = 0x000000000000000000000000000000000000dEaD;

    FeeDistributor public immutable fees;
    StoaRouter public immutable router;
    IERC20 public immutable stoa;

    address public keeper;
    /// @notice $STOA this contract has burned so far
    uint256 public totalBurned;

    event BoughtAndBurned(address indexed token, uint256 amountIn, uint256 stoaBurned);
    event KeeperSet(address keeper);

    error NotKeeper();
    error NotAllowed();
    error ZeroAddress();

    constructor(address owner_, FeeDistributor fees_, StoaRouter router_, IERC20 stoa_, address keeper_) Ownable(owner_) {
        if (address(fees_) == address(0) || address(router_) == address(0) || address(stoa_) == address(0)) {
            revert ZeroAddress();
        }
        fees = fees_;
        router = router_;
        stoa = stoa_;
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    /// @notice Completes the FeeDistributor handover (two-step ownership). Anyone can call it once the current
    ///         owner has named this contract; the timelock does both in one operation.
    function acceptFeeOwnership() external {
        fees.acceptOwnership();
    }

    /// @notice Withdraw `amount` of `token` protocol fees, buy $STOA with them through the router along the given
    ///         route (from `router.quote`), and burn all $STOA held here. `minOut` bounds the swap.
    function buyback(
        address token,
        uint256 amount,
        address mid,
        StoaRouter.Leg calldata leg1,
        StoaRouter.Leg calldata leg2,
        uint256 minOut
    ) external nonReentrant returns (uint256 burned) {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        if (amount > 0) fees.withdrawProtocol(token, amount, address(this));
        if (token != address(stoa) && amount > 0) {
            IERC20(token).forceApprove(address(router), amount);
            router.swap(
                StoaRouter.SwapParams({
                    tokenIn: token,
                    tokenOut: address(stoa),
                    mid: mid,
                    leg1: leg1,
                    leg2: leg2,
                    amountIn: amount,
                    minOut: minOut,
                    to: address(this),
                    deadline: block.timestamp,
                    referrer: address(0)
                })
            );
        }
        burned = stoa.balanceOf(address(this));
        if (burned > 0) {
            stoa.safeTransfer(BURN, burned);
            totalBurned += burned;
        }
        emit BoughtAndBurned(token, amount, burned);
    }

    /// @notice Owner-only call into the FeeDistributor for its other settings (referral share, notifiers, a new
    ///         owner). Protocol fees cannot be withdrawn this way.
    function exec(bytes calldata data) external onlyOwner returns (bytes memory result) {
        if (data.length < 4 || bytes4(data[:4]) == FeeDistributor.withdrawProtocol.selector) revert NotAllowed();
        bool ok;
        (ok, result) = address(fees).call(data);
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }
}
