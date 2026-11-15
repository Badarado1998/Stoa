// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {SpotlightMarket} from "../src/SpotlightMarket.sol";
import {TokenPackageRobinhood} from "./TokenPackageRobinhood.sol";

/// @notice Deploys SpotlightMarket on Robinhood Chain, owned by the 48h timelock from the constructor (no handover),
///         with the router's guardian and the buyback keeper. Week 0 starts Monday 23 November 2026, 00:00 UTC
///         (07:00 WIB). Deployed with CREATE2 through the standard deterministic deployer, so its address is known
///         before the deploy: the web app ships with it (web/lib/deployments-4663.json `spotlightMarket`) and shows the
///         market as soon as code appears there. The script refuses to deploy to any other address.
contract DeploySpotlightRobinhood is Script, TokenPackageRobinhood {
    address internal constant GUARDIAN = 0x5A63C75B38e7ee42220Cc3A57702E06D1D8903c9;
    uint256 internal constant START = 1_795_392_000; // Mon 23 Nov 2026 00:00 UTC
    bytes32 internal constant SALT = keccak256("stoa.spotlight.v1");

    function params() internal pure returns (SpotlightMarket.Params memory) {
        return SpotlightMarket.Params({
            slots: 3,
            cutBps: 1000, // 10% of a winning bid to the burn pot
            entryFee: 0.001 ether,
            minBid: 0.01 ether,
            maxBid: 0.5 ether, // beta cap per token per week
            quorum: 1_000_000 ether // 1M $STOA votes
        });
    }

    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        string memory json = vm.readFile("deployments/4663.json");
        require(vm.parseJsonAddress(json, ".router") == LIVE_ROUTER, "router mismatch");
        require(vm.parseJsonAddress(json, ".timelock") == LIVE_TIMELOCK, "timelock mismatch");
        require(vm.parseJsonAddress(json, ".guardian") == GUARDIAN, "guardian mismatch");
        require(block.timestamp < START, "start already passed");
        bytes memory init = abi.encodePacked(
            type(SpotlightMarket).creationCode,
            abi.encode(LIVE_TIMELOCK, StoaRouter(payable(LIVE_ROUTER)), IERC20(STOA), GUARDIAN, KEEPER, START, params())
        );
        address predicted = vm.computeCreate2Address(SALT, keccak256(init));
        console2.log("predicted", predicted);
        require(CREATE2_FACTORY.code.length > 0, "no CREATE2 deployer");
        require(predicted.code.length == 0, "already deployed");
        if (vm.keyExistsJson(json, ".spotlightMarket")) {
            require(vm.parseJsonAddress(json, ".spotlightMarket") == predicted, "address differs from the web app's");
        }

        vm.startBroadcast();
        SpotlightMarket m = new SpotlightMarket{salt: SALT}(
            LIVE_TIMELOCK, StoaRouter(payable(LIVE_ROUTER)), IERC20(STOA), GUARDIAN, KEEPER, START, params()
        );
        vm.stopBroadcast();

        require(address(m) == predicted, "unexpected address");

        require(m.owner() == LIVE_TIMELOCK && m.guardian() == GUARDIAN && m.keeper() == KEEPER, "roles");
        require(m.start() == START && address(m.stoa()) == STOA && address(m.router()) == LIVE_ROUTER, "wiring");
        console2.log("SpotlightMarket", address(m));
        vm.serializeAddress("s", "spotlightMarket", address(m));
        vm.writeJson(vm.serializeUint("s", "spotlightStart", START), "deployments/4663-spotlight.json");
    }
}
