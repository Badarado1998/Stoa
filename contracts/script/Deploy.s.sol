// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MakerRegistry} from "../src/MakerRegistry.sol";
import {FeeDistributor} from "../src/FeeDistributor.sol";
import {StoaPool} from "../src/StoaPool.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {UniswapV2Adapter, IUniswapV2Factory} from "../src/adapters/UniswapV2Adapter.sol";
import {UniswapV3Adapter, IUniswapV3Factory} from "../src/adapters/UniswapV3Adapter.sol";
import {IMakerRegistry, IFeeDistributor} from "../src/interfaces/IStoa.sol";

/// @notice Deploys Stoa v1 on Elysium mainnet (chain 99901): registry, fee distributor, router, the WHYPE/USDC
///         maker pool and the Uniswap V2 + V3 fallback adapters. Writes the addresses to deployments/99901.json.
/// Env (required): OWNER (multisig or owner wallet), TREASURY
/// Env (optional): CURATOR (pool owner, default OWNER), MAKER (approved maker, default none),
///                 MIN_BOND (wei of HYPE, default 10 HYPE), MAX_SWAP_USDC (raw, default 500e6),
///                 UNBOND_DELAY (seconds, default 1 day)
/// Ownership moves to OWNER in two steps: OWNER must call acceptOwnership() on the registry, distributor and router.
contract Deploy is Script {
    address constant WHYPE = 0xbA876237B0F021A6c6D852d6c26E107997cC5E81;
    address constant USDC = 0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65;
    // Uniswap on Elysium (factories checked on-chain; see Uniswap/sdks#782)
    address constant UNI_V2_FACTORY = 0xBbBcC62853a5fA27b93d6Bab3E6F7ce841E25Df2;
    address constant UNI_V3_FACTORY = 0x1707327F626496A7b5b3872e7E4d2879Df7d7a9f;

    function run() external {
        require(block.chainid == 99901, "not Elysium mainnet");
        address owner = vm.envAddress("OWNER");
        address treasury = vm.envAddress("TREASURY");
        address curator = vm.envOr("CURATOR", owner);
        address maker = vm.envOr("MAKER", address(0));
        uint256 minBond = vm.envOr("MIN_BOND", uint256(10 ether));
        uint256 maxSwap = vm.envOr("MAX_SWAP_USDC", uint256(500e6));
        uint64 unbondDelay = uint64(vm.envOr("UNBOND_DELAY", uint256(1 days)));
        require(owner != address(0) && treasury != address(0), "OWNER/TREASURY");
        require(UNI_V2_FACTORY.code.length > 0 && UNI_V3_FACTORY.code.length > 0, "uniswap factories missing");

        vm.startBroadcast();
        address me = msg.sender;
        MakerRegistry reg = new MakerRegistry(me, treasury, unbondDelay);
        FeeDistributor fees = new FeeDistributor(me, IMakerRegistry(address(reg)));
        StoaPool pool =
            new StoaPool(WHYPE, USDC, IMakerRegistry(address(reg)), IFeeDistributor(address(fees)), curator, maxSwap);
        StoaRouter router = new StoaRouter(me, IFeeDistributor(address(fees)), WHYPE);
        UniswapV2Adapter v2 = new UniswapV2Adapter(IUniswapV2Factory(UNI_V2_FACTORY), WHYPE, address(router));
        UniswapV3Adapter v3 = new UniswapV3Adapter(IUniswapV3Factory(UNI_V3_FACTORY), WHYPE, address(router));

        reg.listPool(address(pool), minBond);
        if (maker != address(0)) reg.setMakerApproval(address(pool), maker, true);
        fees.setNotifier(address(router), true);
        router.addPool(address(pool));
        router.addAdapter(address(v2));
        router.addAdapter(address(v3));

        if (owner != me) {
            reg.transferOwnership(owner);
            fees.transferOwnership(owner);
            router.transferOwnership(owner);
        }
        vm.stopBroadcast();

        _write(owner, address(reg), address(fees), address(pool), address(router), address(v2), address(v3));
        console2.log("StoaRouter      ", address(router));
        console2.log("StoaPool        ", address(pool));
        console2.log("FeeDistributor  ", address(fees));
        console2.log("MakerRegistry   ", address(reg));
        console2.log("UniswapV2Adapter", address(v2));
        console2.log("UniswapV3Adapter", address(v3));
    }

    function _write(address owner, address reg, address fees, address pool, address router, address v2, address v3)
        private
    {
        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "block", block.number);
        vm.serializeAddress(o, "owner", owner);
        vm.serializeAddress(o, "makerRegistry", reg);
        vm.serializeAddress(o, "feeDistributor", fees);
        vm.serializeAddress(o, "poolWhypeUsdc", pool);
        vm.serializeAddress(o, "uniswapV2Adapter", v2);
        vm.serializeAddress(o, "uniswapV3Adapter", v3);
        string memory json = vm.serializeAddress(o, "router", router);
        vm.writeJson(json, "./deployments/99901.json");
    }
}
