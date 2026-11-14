// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Robinhood Chain mainnet (chain 4663) addresses for the venues Stoa routes through. Each one was checked
///         on-chain (code present, factory of live pools, symbol/decimals) and exercised in test/ForkRobinhood.t.sol.
abstract contract VenuesRobinhood {
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    /// Global Dollar, the chain's main stablecoin (6 decimals)
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // Uniswap (official Robinhood Chain deployment; the V2 factory is the factory() of live V2 pairs)
    address internal constant UNI_V2_FACTORY = 0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f;
    address internal constant UNI_V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address internal constant V4_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;

    // Safe v1.3.0 (canonical addresses, present on Robinhood Chain)
    address internal constant SAFE_FACTORY = 0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2;
    address internal constant SAFE_SINGLETON_L2 = 0x3E5c63644E683549055b9Be8653de26E0B4CD36E;
    address internal constant SAFE_FALLBACK = 0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4;

    /// @dev V4 hooks the adapter accepts: no hook, Pons V2 (the main launchpad), the ETH/USDG pool's hook and the
    ///      launchpad hooks with the most pools. Each passed a live buy-and-sell in the fork test.
    function v4Hooks() internal pure returns (address[] memory h) {
        h = new address[](6);
        h[0] = address(0);
        h[1] = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044; // Pons V2 meme hook
        h[2] = 0x987E330F00B79864a07FE81dFaC344D0078ABCC0; // ETH/USDG pool
        h[3] = 0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544;
        h[4] = 0x0Af57F62982D03066ef917AcAd87F771c06528Ec;
        h[5] = 0xee588bCF2bd3e658f5160489f4199d1851BBf0Cc;
    }
}
