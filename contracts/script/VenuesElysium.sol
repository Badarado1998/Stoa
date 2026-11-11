// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Elysium mainnet (chain 99901) addresses for the venues Stoa routes through. Each one was checked
///         on-chain (factory lookups, pool state, live swaps in the fork tests).
abstract contract VenuesElysium {
    address internal constant WHYPE = 0xbA876237B0F021A6c6D852d6c26E107997cC5E81;
    address internal constant USDC = 0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // Uniswap (official Elysium deployment)
    address internal constant UNI_V2_FACTORY = 0xBbBcC62853a5fA27b93d6Bab3E6F7ce841E25Df2;
    address internal constant UNI_V3_FACTORY = 0x1707327F626496A7b5b3872e7E4d2879Df7d7a9f;
    address internal constant V4_POOL_MANAGER = 0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1;
    // Aero Slipstream (pools keyed by tick spacing; factory.tickSpacings() = 1,10,50,100,150,200,250)
    address internal constant AERO_CL_FACTORY = 0xEfd7A089D3057F05189B05f74Ffcf30610c42891;
    // Ramses CL (pools keyed by tick spacing; spacings seen in PoolCreated: 1,5,10,50,100,200,300,400,500)
    address internal constant RAMSES_CL_FACTORY = 0x29cd8852FF040CfE74fb20277A121eD1293AFb41;
    // Liquidity Book (DLMM) factory
    address internal constant LB_FACTORY = 0xF31632C73B8775e45Ce6d2539dEb008cB766D51b;

    function aeroSpacings() internal pure returns (int24[] memory s) {
        int24[7] memory v = [int24(1), 10, 50, 100, 150, 200, 250];
        s = new int24[](7);
        for (uint256 i; i < 7; ++i) {
            s[i] = v[i];
        }
    }

    function ramsesSpacings() internal pure returns (int24[] memory s) {
        int24[9] memory v = [int24(1), 5, 10, 50, 100, 200, 300, 400, 500];
        s = new int24[](9);
        for (uint256 i; i < 9; ++i) {
            s[i] = v[i];
        }
    }

    /// @dev V4 hooks with the most pools on Elysium (no hook, and the launchpad hooks), each with 250+ pools.
    function v4Hooks() internal pure returns (address[] memory h) {
        h = new address[](11);
        h[0] = address(0);
        h[1] = 0x6b1216A40B65c83e9c9e18a562C446697B8cf8EC;
        h[2] = 0xe0dEF4221b9840a610D4e7d55812a79A6431a8eC;
        h[3] = 0x3aB88DDc3CF2A012af88B60828edb4553697E5dC;
        h[4] = 0xE928F2336051cBD5B9D4531C25EaDd13f9A82aeC;
        h[5] = 0xBAcF71Bf02b8cfE171853C5eC4A060Ba2Ac1E0cc;
        h[6] = 0x3eA9581a32a396F69b177B65b91149Cf887BEACC;
        h[7] = 0x00C002Cdae688F39a90CF2AD74c59421C9502aCC;
        h[8] = 0x0fa71294c909b11A0b805df4763Ba576c69c2acC;
        h[9] = 0x10F11002b148BE522005f9b5D666bef339392aEC;
        h[10] = 0xb67656Ce894ac93c0164d8490aD23161A77EE000;
    }
}
