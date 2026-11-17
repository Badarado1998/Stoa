// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice up. (ve(3,3) exchange on Robinhood Chain): its concentrated-liquidity pools are Slipstream-style, keyed by
///         tick spacing, with the uniswapV3SwapCallback, so they use Stoa's existing CLTickSpacingAdapter.
abstract contract UpVenueRobinhood {
    address internal constant UP_CL_FACTORY = 0x1ac9dB4a2608ba45D6127B1737949b51Bb54B7F3; // up. CLFactory
    address internal constant UP_LIVE_ROUTER = 0x2F2804fad735a38015650f32f95Ad5E08D6B3eE5;

    /// @dev Every tick spacing the factory enables: tickSpacings() on 17 Nov 2026 returned [1, 50, 100, 200, 2000, 10, 60].
    function upSpacings() internal pure returns (int24[] memory s) {
        int24[7] memory v = [int24(1), 10, 50, 60, 100, 200, 2000];
        s = new int24[](7);
        for (uint256 i; i < 7; ++i) {
            s[i] = v[i];
        }
    }
}
