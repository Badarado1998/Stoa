// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MakerRegistry} from "../src/MakerRegistry.sol";
import {FeeDistributor} from "../src/FeeDistributor.sol";
import {StoaPool} from "../src/StoaPool.sol";
import {StoaRouter, ISignatureTransfer} from "../src/StoaRouter.sol";
import {UniswapV2Adapter, IUniswapV2Factory} from "../src/adapters/UniswapV2Adapter.sol";
import {UniswapV3Adapter, IUniswapV3Factory} from "../src/adapters/UniswapV3Adapter.sol";
import {IMakerRegistry, IFeeDistributor} from "../src/interfaces/IStoa.sol";

/// @notice Deploys Stoa v1 on Elysium mainnet (chain 99901): registry, fee distributor, router, the WHYPE/USDC
///         maker pool and the Uniswap V2 + V3 fallback adapters. Writes the addresses to deployments/99901.json.
/// Env (required): OWNER (multisig or hardware wallet), TREASURY
/// Env (optional): CURATOR (pool owner, default OWNER), MAKER (approved maker, default none),
///                 GUARDIAN (can pause the router, default OWNER), MIN_BOND (wei of HYPE, default 10 HYPE),
///                 MAX_SWAP_USDC (raw, default 500e6), UNBOND_DELAY (s, default 1 day),
///                 ROUTER_DELAY (s, timelock for new venues, default 1 day)
/// After deploy, OWNER must call acceptOwnership() on MakerRegistry, FeeDistributor and StoaRouter.
contract Deploy is Script {
    address constant WHYPE = 0xbA876237B0F021A6c6D852d6c26E107997cC5E81;
    address constant USDC = 0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    // Uniswap on Elysium (factories checked on-chain; see Uniswap/sdks#782)
    address constant UNI_V2_FACTORY = 0xBbBcC62853a5fA27b93d6Bab3E6F7ce841E25Df2;
    address constant UNI_V3_FACTORY = 0x1707327F626496A7b5b3872e7E4d2879Df7d7a9f;

    struct Cfg {
        address owner;
        address treasury;
        address curator;
        address maker;
        address guardian;
        uint256 minBond;
        uint256 maxSwap;
        uint64 unbondDelay;
        uint256 routerDelay;
    }

    struct Out {
        MakerRegistry reg;
        FeeDistributor fees;
        StoaPool pool;
        StoaRouter router;
        UniswapV2Adapter v2;
        UniswapV3Adapter v3;
    }

    function run() external {
        require(block.chainid == 99901, "not Elysium mainnet");
        require(UNI_V2_FACTORY.code.length > 0 && UNI_V3_FACTORY.code.length > 0, "uniswap factories missing");
        require(PERMIT2.code.length > 0, "permit2 missing");
        Cfg memory c = _cfg();
        vm.startBroadcast();
        Out memory o = _deploy(c, msg.sender);
        vm.stopBroadcast();
        _write(c, o);
    }

    function _cfg() private view returns (Cfg memory c) {
        c.owner = vm.envAddress("OWNER");
        c.treasury = vm.envAddress("TREASURY");
        require(c.owner != address(0) && c.treasury != address(0), "OWNER/TREASURY");
        c.curator = vm.envOr("CURATOR", c.owner);
        c.maker = vm.envOr("MAKER", address(0));
        c.guardian = vm.envOr("GUARDIAN", c.owner);
        c.minBond = vm.envOr("MIN_BOND", uint256(10 ether));
        c.maxSwap = vm.envOr("MAX_SWAP_USDC", uint256(500e6));
        c.unbondDelay = uint64(vm.envOr("UNBOND_DELAY", uint256(1 days)));
        c.routerDelay = vm.envOr("ROUTER_DELAY", uint256(1 days));
    }

    function _deploy(Cfg memory c, address me) private returns (Out memory o) {
        o.reg = new MakerRegistry(me, c.treasury, c.unbondDelay);
        o.fees = new FeeDistributor(me, IMakerRegistry(address(o.reg)));
        o.pool = new StoaPool(
            WHYPE, USDC, IMakerRegistry(address(o.reg)), IFeeDistributor(address(o.fees)), c.curator, c.maxSwap
        );
        o.router =
            new StoaRouter(me, IFeeDistributor(address(o.fees)), WHYPE, ISignatureTransfer(PERMIT2), c.routerDelay);
        o.v2 = new UniswapV2Adapter(IUniswapV2Factory(UNI_V2_FACTORY), WHYPE, address(o.router));
        o.v3 = new UniswapV3Adapter(IUniswapV3Factory(UNI_V3_FACTORY), WHYPE, address(o.router));

        o.reg.listPool(address(o.pool), c.minBond);
        if (c.maker != address(0)) o.reg.setMakerApproval(address(o.pool), c.maker, true);
        o.fees.setNotifier(address(o.router), true);
        o.router.addPool(address(o.pool));
        o.router.addAdapter(address(o.v2));
        o.router.addAdapter(address(o.v3));
        o.router.setGuardian(c.guardian);
        o.router.lockSetup(); // from here on, new venues wait `routerDelay`

        if (c.owner != me) {
            o.reg.transferOwnership(c.owner);
            o.fees.transferOwnership(c.owner);
            o.router.transferOwnership(c.owner);
        }
    }

    function _write(Cfg memory c, Out memory o) private {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "block", block.number);
        vm.serializeAddress(k, "owner", c.owner);
        vm.serializeAddress(k, "guardian", c.guardian);
        vm.serializeAddress(k, "makerRegistry", address(o.reg));
        vm.serializeAddress(k, "feeDistributor", address(o.fees));
        vm.serializeAddress(k, "poolWhypeUsdc", address(o.pool));
        vm.serializeAddress(k, "uniswapV2Adapter", address(o.v2));
        vm.serializeAddress(k, "uniswapV3Adapter", address(o.v3));
        vm.serializeAddress(k, "permit2", PERMIT2);
        string memory json = vm.serializeAddress(k, "router", address(o.router));
        vm.writeJson(json, "./deployments/99901.json");

        console2.log("StoaRouter      ", address(o.router));
        console2.log("StoaPool        ", address(o.pool));
        console2.log("FeeDistributor  ", address(o.fees));
        console2.log("MakerRegistry   ", address(o.reg));
        console2.log("UniswapV2Adapter", address(o.v2));
        console2.log("UniswapV3Adapter", address(o.v3));
    }
}
