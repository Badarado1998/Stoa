// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VenuePackageRobinhood} from "./VenuePackageRobinhood.sol";

/// @notice $STOA utility on Robinhood Chain: addresses and the one governance operation it needs.
/// @dev StoaBuyback becomes the FeeDistributor's owner through the 48h timelock, in one batch:
///        fees.transferOwnership(buyback), then buyback.acceptFeeOwnership() (the FeeDistributor is Ownable2Step)
///      After that, protocol fees can only be swapped into $STOA and burned (keeper: the Robinhood deployer wallet).
///      BondRegistry is owned by the timelock from deployment and needs no handover.
abstract contract TokenPackageRobinhood is VenuePackageRobinhood {
    /// official $STOA (Pons launch, 18 decimals)
    address internal constant STOA = 0x13E6993417616De724F2b337D65063f229e96718;
    address internal constant LIVE_FEES = 0x76c30317bB8C0bC47E2aC5D83b329FE9F386F4e7;
    /// keeper of the weekly buyback: the Robinhood deployer wallet (it already pays gas for pool registration)
    address internal constant KEEPER = 0xbf666e8D054935170b9f09127247905A975b3B80;
    /// makers wait 3 days to withdraw a bond: longer than the timelock, so a slash can land first
    uint64 internal constant BOND_UNBOND_DELAY = 3 days;

    function _handoverOp(address buyback) internal pure returns (Op memory o) {
        o.targets = new address[](2);
        o.values = new uint256[](2);
        o.payloads = new bytes[](2);
        o.targets[0] = LIVE_FEES;
        o.payloads[0] = abi.encodeWithSignature("transferOwnership(address)", buyback);
        o.targets[1] = buyback;
        o.payloads[1] = abi.encodeWithSignature("acceptFeeOwnership()");
    }
}
