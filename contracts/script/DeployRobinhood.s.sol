// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MakerRegistry} from "../src/MakerRegistry.sol";
import {FeeDistributor} from "../src/FeeDistributor.sol";
import {StoaRouter, ISignatureTransfer} from "../src/StoaRouter.sol";
import {UniswapV2Adapter, IUniswapV2Factory} from "../src/adapters/UniswapV2Adapter.sol";
import {UniswapV3Adapter, IUniswapV3Factory} from "../src/adapters/UniswapV3Adapter.sol";
import {UniswapV4Adapter, IPoolManager} from "../src/adapters/UniswapV4Adapter.sol";
import {IMakerRegistry, IFeeDistributor} from "../src/interfaces/IStoa.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {VenuesRobinhood} from "./VenuesRobinhood.sol";

interface ISafeFactory {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

interface ISafe {
    function setup(
        address[] calldata owners,
        uint256 threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address paymentReceiver
    ) external;
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
}

/// @notice Deploys Stoa on Robinhood Chain (chain 4663) with the same governance as on Elysium, in one run:
///         a 2-of-3 Safe (SIGNERS), a 48h TimelockController that only the Safe can use, and the router with the
///         Uniswap V2, V3 and V4 adapters. There are no maker pools on Robinhood Chain (no makers yet), so the
///         maker registry exists only because the fee distributor needs one.
///         The deployer holds temporary timelock roles with a 0 delay just long enough to accept ownership of the
///         contracts and raise the delay to 48h, then gives every role up. Writes deployments/4663.json.
/// Env (required): SIGNERS (3 comma-separated addresses), TREASURY, GUARDIAN (pause-only wallet)
contract DeployRobinhood is Script, VenuesRobinhood {
    uint256 constant DELAY = 48 hours;
    uint64 constant UNBOND = 3 days;

    struct Out {
        address safe;
        TimelockController tl;
        MakerRegistry reg;
        FeeDistributor fees;
        StoaRouter router;
        UniswapV2Adapter v2;
        UniswapV3Adapter v3;
        UniswapV4Adapter v4;
        uint256 block_;
    }

    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain mainnet");
        require(UNI_V2_FACTORY.code.length > 0 && UNI_V3_FACTORY.code.length > 0, "uniswap factories missing");
        require(V4_POOL_MANAGER.code.length > 0 && PERMIT2.code.length > 0 && WETH.code.length > 0, "venue missing");
        require(SAFE_FACTORY.code.length > 0 && SAFE_SINGLETON_L2.code.length > 0, "Safe contracts missing");
        address[] memory signers = vm.envAddress("SIGNERS", ",");
        address treasury = vm.envAddress("TREASURY");
        address guardian = vm.envAddress("GUARDIAN");
        require(signers.length == 3 && treasury != address(0) && guardian != address(0), "SIGNERS/TREASURY/GUARDIAN");

        vm.startBroadcast();
        Out memory o = _deploy(signers, treasury, guardian, msg.sender);
        vm.stopBroadcast();
        o.block_ = block.number;
        _check(o, signers, msg.sender);
        _write(o, guardian, treasury);
    }

    function _deploy(address[] memory signers, address treasury, address guardian, address me)
        private
        returns (Out memory o)
    {
        // 1. Safe 2 of 3
        bytes memory init =
            abi.encodeCall(ISafe.setup, (signers, 2, address(0), "", SAFE_FALLBACK, address(0), 0, address(0)));
        o.safe = ISafeFactory(SAFE_FACTORY)
            .createProxyWithNonce(SAFE_SINGLETON_L2, init, uint256(keccak256("stoa-admin-safe-robinhood")));

        // 2. timelock: Safe (and, briefly, the deployer) propose and execute; the deployer is admin until the end
        address[] memory who = new address[](2);
        who[0] = o.safe;
        who[1] = me;
        o.tl = new TimelockController(0, who, who, me);

        // 3. Stoa
        o.reg = new MakerRegistry(me, treasury, UNBOND);
        o.fees = new FeeDistributor(me, IMakerRegistry(address(o.reg)));
        o.router = new StoaRouter(me, IFeeDistributor(address(o.fees)), WETH, ISignatureTransfer(PERMIT2), 1 days);
        o.v2 = new UniswapV2Adapter(IUniswapV2Factory(UNI_V2_FACTORY), WETH, address(o.router));
        o.v3 = new UniswapV3Adapter(IUniswapV3Factory(UNI_V3_FACTORY), WETH, address(o.router));
        o.v4 = new UniswapV4Adapter(IPoolManager(V4_POOL_MANAGER), WETH, address(o.router), address(o.tl), v4Hooks());
        o.fees.setNotifier(address(o.router), true);
        o.router.addAdapter(address(o.v2));
        o.router.addAdapter(address(o.v3));
        o.router.addAdapter(address(o.v4));
        o.router.setGuardian(guardian);
        o.router.lockSetup(); // from here on, new venues wait the router delay
        o.reg.transferOwnership(address(o.tl));
        o.fees.transferOwnership(address(o.tl));
        o.router.transferOwnership(address(o.tl));

        // 4. the timelock accepts the three contracts and raises its own delay to 48h, in one batch at delay 0
        address[] memory t = new address[](4);
        bytes[] memory d = new bytes[](4);
        uint256[] memory v = new uint256[](4);
        t[0] = address(o.reg);
        t[1] = address(o.fees);
        t[2] = address(o.router);
        t[3] = address(o.tl);
        for (uint256 i; i < 3; ++i) {
            d[i] = abi.encodeWithSignature("acceptOwnership()");
        }
        d[3] = abi.encodeCall(TimelockController.updateDelay, (DELAY));
        bytes32 salt = keccak256("stoa-robinhood-handover");
        o.tl.scheduleBatch(t, v, d, bytes32(0), salt, 0);
        o.tl.executeBatch(t, v, d, bytes32(0), salt);

        // 5. the deployer gives up every timelock role; the Safe is the only proposer, executor and canceller
        o.tl.revokeRole(o.tl.PROPOSER_ROLE(), me);
        o.tl.revokeRole(o.tl.EXECUTOR_ROLE(), me);
        o.tl.revokeRole(o.tl.CANCELLER_ROLE(), me);
        o.tl.renounceRole(o.tl.DEFAULT_ADMIN_ROLE(), me);
    }

    function _check(Out memory o, address[] memory signers, address me) private view {
        require(ISafe(o.safe).getThreshold() == 2 && ISafe(o.safe).getOwners().length == 3, "Safe");
        for (uint256 i; i < 3; ++i) {
            require(_isOwner(o.safe, signers[i]), "Safe signer");
        }
        require(o.tl.getMinDelay() == DELAY, "delay");
        require(o.reg.owner() == address(o.tl) && o.fees.owner() == address(o.tl), "owners");
        require(o.router.owner() == address(o.tl) && o.v4.owner() == address(o.tl), "router owner");
        bytes32[4] memory roles =
            [o.tl.PROPOSER_ROLE(), o.tl.EXECUTOR_ROLE(), o.tl.CANCELLER_ROLE(), o.tl.DEFAULT_ADMIN_ROLE()];
        for (uint256 i; i < 4; ++i) {
            require(!o.tl.hasRole(roles[i], me), "deployer kept a role");
        }
        require(
            o.tl.hasRole(roles[0], o.safe) && o.tl.hasRole(roles[1], o.safe) && o.tl.hasRole(roles[2], o.safe),
            "Safe roles"
        );
        require(!o.tl.hasRole(roles[3], o.safe), "no admin");
    }

    function _isOwner(address safe, address a) private view returns (bool) {
        address[] memory ow = ISafe(safe).getOwners();
        for (uint256 i; i < ow.length; ++i) {
            if (ow[i] == a) return true;
        }
        return false;
    }

    function _write(Out memory o, address guardian, address treasury) private {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "block", o.block_);
        vm.serializeAddress(k, "safe", o.safe);
        vm.serializeAddress(k, "timelock", address(o.tl));
        vm.serializeAddress(k, "owner", address(o.tl));
        vm.serializeAddress(k, "guardian", guardian);
        vm.serializeAddress(k, "treasury", treasury);
        vm.serializeAddress(k, "makerRegistry", address(o.reg));
        vm.serializeAddress(k, "feeDistributor", address(o.fees));
        vm.serializeAddress(k, "uniswapV2Adapter", address(o.v2));
        vm.serializeAddress(k, "uniswapV3Adapter", address(o.v3));
        vm.serializeAddress(k, "uniswapV4Adapter", address(o.v4));
        vm.serializeAddress(k, "permit2", PERMIT2);
        string memory json = vm.serializeAddress(k, "router", address(o.router));
        vm.writeJson(json, "./deployments/4663.json");
        console2.log("Safe            ", o.safe);
        console2.log("Timelock (48h)  ", address(o.tl));
        console2.log("StoaRouter      ", address(o.router));
        console2.log("FeeDistributor  ", address(o.fees));
        console2.log("MakerRegistry   ", address(o.reg));
        console2.log("UniswapV2Adapter", address(o.v2));
        console2.log("UniswapV3Adapter", address(o.v3));
        console2.log("UniswapV4Adapter", address(o.v4));
    }
}
