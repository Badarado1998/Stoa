// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {RugCover} from "../src/RugCover.sol";
import {TokenPackageRobinhood} from "./TokenPackageRobinhood.sol";

/// @notice Deploys RugCover on Robinhood Chain, owned by the 48h timelock from the constructor (no handover), with the
///         router's guardian and the buyback keeper, reading creators from the Pons factory. Deployed with CREATE2
///         through the standard deterministic deployer, so its address is known before the deploy. Once the web app
///         ships it (web/lib/deployments-4663.json `rugCover`), the script refuses to deploy to any other address.
contract DeployRugCoverRobinhood is Script, TokenPackageRobinhood {
    address internal constant GUARDIAN = 0x5A63C75B38e7ee42220Cc3A57702E06D1D8903c9;
    address internal constant PONS_FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    bytes32 internal constant SALT = keccak256("stoa.rugcover.v1");

    function params() internal pure returns (RugCover.Params memory) {
        return RugCover.Params({
            term: 7 days,
            feeBps: 200, // 2% of the bond per term
            capacityBps: 7500, // cover sold is at most 75% of the bond
            premiumBps: 100, // 1% of the ETH swapped, all burned
            walletCapBps: 2500, // one buyer, at most a quarter of a term's cover
            bountyBps: 100, // 1% of the bond to whoever calls breach
            burnBps: 1000, // 10% of creator fees and forfeited bonds burned, 90% to backers
            minFloorBps: 50, // the creator must hold at least 0.5% of supply
            minFee: 0.002 ether,
            minBond: 0.05 ether,
            maxBond: 1 ether, // beta cap per token
            minCover: 0.005 ether,
            maxCover: 0.25 ether,
            maxTotalBonds: 20 ether // beta cap for all open bonds
        });
    }

    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        string memory json = vm.readFile("deployments/4663.json");
        require(vm.parseJsonAddress(json, ".router") == LIVE_ROUTER, "router mismatch");
        require(vm.parseJsonAddress(json, ".timelock") == LIVE_TIMELOCK, "timelock mismatch");
        require(vm.parseJsonAddress(json, ".guardian") == GUARDIAN, "guardian mismatch");
        require(PONS_FACTORY.code.length > 0, "no Pons factory");
        bytes memory init = abi.encodePacked(
            type(RugCover).creationCode,
            abi.encode(
                LIVE_TIMELOCK, StoaRouter(payable(LIVE_ROUTER)), IERC20(STOA), PONS_FACTORY, GUARDIAN, KEEPER, params()
            )
        );
        address predicted = vm.computeCreate2Address(SALT, keccak256(init));
        console2.log("predicted", predicted);
        require(CREATE2_FACTORY.code.length > 0, "no CREATE2 deployer");
        require(predicted.code.length == 0, "already deployed");
        if (vm.keyExistsJson(json, ".rugCover")) {
            require(vm.parseJsonAddress(json, ".rugCover") == predicted, "address differs from the web app's");
        }

        vm.startBroadcast();
        RugCover rc = new RugCover{salt: SALT}(
            LIVE_TIMELOCK, StoaRouter(payable(LIVE_ROUTER)), IERC20(STOA), PONS_FACTORY, GUARDIAN, KEEPER, params()
        );
        vm.stopBroadcast();

        require(address(rc) == predicted, "unexpected address");
        require(rc.owner() == LIVE_TIMELOCK && rc.guardian() == GUARDIAN && rc.keeper() == KEEPER, "roles");
        require(
            address(rc.stoa()) == STOA && address(rc.router()) == LIVE_ROUTER && rc.ponsFactory() == PONS_FACTORY,
            "wiring"
        );
        require(rc.creatorOf(STOA) != address(0), "factory read");
        console2.log("RugCover", address(rc));
        vm.writeJson(vm.serializeAddress("r", "rugCover", address(rc)), "deployments/4663-rugcover.json");
    }
}
