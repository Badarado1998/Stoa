// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {StoaLimit} from "../src/StoaLimit.sol";
import {TokenPackageRobinhood} from "./TokenPackageRobinhood.sol";

/// @notice Deploys StoaLimit (limit orders) on Robinhood Chain, owned by the 48h timelock from the constructor, with
///         the router's guardian and the buyback keeper as filler. CREATE2 through the standard deterministic
///         deployer, so the address is known before the deploy; once the web app ships it
///         (web/lib/deployments-4663.json `limit`), the script refuses to deploy anywhere else.
contract DeployLimitRobinhood is Script, TokenPackageRobinhood {
    address internal constant GUARDIAN = 0x5A63C75B38e7ee42220Cc3A57702E06D1D8903c9;
    bytes32 internal constant SALT = keccak256("stoa.limit.v1");

    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        string memory json = vm.readFile("deployments/4663.json");
        require(vm.parseJsonAddress(json, ".router") == LIVE_ROUTER, "router mismatch");
        require(vm.parseJsonAddress(json, ".timelock") == LIVE_TIMELOCK, "timelock mismatch");
        require(vm.parseJsonAddress(json, ".guardian") == GUARDIAN, "guardian mismatch");
        bytes memory init = abi.encodePacked(
            type(StoaLimit).creationCode, abi.encode(LIVE_TIMELOCK, StoaRouter(payable(LIVE_ROUTER)), GUARDIAN, KEEPER)
        );
        address predicted = vm.computeCreate2Address(SALT, keccak256(init));
        console2.log("predicted", predicted);
        require(CREATE2_FACTORY.code.length > 0, "no CREATE2 deployer");
        require(predicted.code.length == 0, "already deployed");
        if (vm.keyExistsJson(json, ".limit")) {
            require(vm.parseJsonAddress(json, ".limit") == predicted, "address differs from the web app's");
        }

        vm.startBroadcast();
        StoaLimit lim = new StoaLimit{salt: SALT}(LIVE_TIMELOCK, StoaRouter(payable(LIVE_ROUTER)), GUARDIAN, KEEPER);
        vm.stopBroadcast();

        require(address(lim) == predicted, "unexpected address");
        require(lim.owner() == LIVE_TIMELOCK && lim.guardian() == GUARDIAN && lim.keeper() == KEEPER, "roles");
        require(address(lim.router()) == LIVE_ROUTER && !lim.paused(), "wiring");
        console2.log("StoaLimit", address(lim));
        vm.writeJson(vm.serializeAddress("l", "limit", address(lim)), "deployments/4663-limit.json");
    }
}
