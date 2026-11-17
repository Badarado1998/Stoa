// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PoolKey} from "../src/adapters/UniswapV4Adapter.sol";
import {VenuesRobinhood} from "./VenuesRobinhood.sol";

/// @notice What the UniswapV4AdapterV3 deploy, its rollout and its fork rehearsal share on Robinhood Chain.
/// @dev Runbook notes from HEY Research Lab's follow-up (17 Nov 2026):
///      - SIM_GAS stays 2M, knowingly (F-1): a pool whose simulation needs more is skipped even if it can fill the
///        trade (today: 3M USDG on the deepest ETH/USDG pool; dust positions can lower that size on narrow pools). The
///        daily gas report alerts when a pinned pool's reference trade passes 1.2M.
///      - The guardian's disableHook also works on address(0), which stops every hook-less pool (F-6): the same reach
///        as pausing the router. The guardian is an EOA; if its key is lost, the timelock batch that re-allows a hook
///        must first call setGuardian(new). If the guardian switches off a hook while the timelock has a queued
///        setHookAllowed(hook, true), cancel that operation (the Safe holds the canceller role).
abstract contract V4AdapterV3Robinhood is VenuesRobinhood {
    address internal constant V3_GUARDIAN = 0x5A63C75B38e7ee42220Cc3A57702E06D1D8903c9; // the router's guardian
    address internal constant V4_OLD = 0x8965140Fb51b2E99a0Cd31a0E99Eae01D36517B8; // first V4 adapter
    address internal constant V4_V2 = 0x27958279F95225b2a5517E7DD12b6Fc0317E5c5d; // UniswapV4AdapterV2
    address internal constant STOA_TOKEN = 0x13E6993417616De724F2b337D65063f229e96718;
    address internal constant PONS_V2_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address internal constant USDG_TOKEN = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    /// @notice V2's allowlist (v4Hooks()) plus the three Fables hooks Hey Research Lab reviewed on 17 Nov 2026.
    function hooksV3() internal pure returns (address[] memory h) {
        address[] memory base = v4Hooks();
        h = new address[](base.length + 3);
        for (uint256 i; i < base.length; ++i) {
            h[i] = base[i];
        }
        h[base.length] = 0x08E52564Bad99E05a694b4809F397edcA417A080; // FablesRamp
        h[base.length + 1] = 0x594e8e6281eDf2d363a0293a50004Cf868E7a080; // FablesRampETH
        h[base.length + 2] = 0x5Eb87F69bE00Df39981622Fd60A8De4b7837e080; // FablesRWA
    }

    /// @notice The pools Stoa's own flows use, registered by the keeper right after the deploy and then pinned by the
    ///         timelock, each pin its own operation (Hey Research Lab, I-2 and I-6): the canonical $STOA pool (Pons
    ///         graduation pool) and the two main ETH/USDG pools.
    function pinnedKeys() internal pure returns (PoolKey[] memory k) {
        k = new PoolKey[](3);
        k[0] = PoolKey(address(0), STOA_TOKEN, 0, 200, PONS_V2_HOOK);
        k[1] = PoolKey(address(0), USDG_TOKEN, 500, 10, address(0));
        k[2] = PoolKey(address(0), USDG_TOKEN, 8388608, 1, 0x987E330F00B79864a07FE81dFaC344D0078ABCC0);
    }
}
