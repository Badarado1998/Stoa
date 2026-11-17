// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CLTickSpacingAdapter, ICLTickSpacingFactory} from "../src/adapters/CLTickSpacingAdapter.sol";
import {UniswapV3Adapter, IUniswapV3Factory} from "../src/adapters/UniswapV3Adapter.sol";
import {IVenueAdapter} from "../src/interfaces/IStoa.sol";

/// @notice Run with eth_call as a contract creation: deploys candidate venue adapters in the call only and returns,
///         for native ETH (as WETH) -> tokenOut, the best quote of the existing adapters and of each candidate.
///         Nothing is deployed or sent.
contract VenueLens {
    constructor(address weth, address[] memory existing, address tokenOut, uint256 amount) {
        int24[] memory up = new int24[](7);
        (up[0], up[1], up[2], up[3], up[4], up[5], up[6]) = (int24(1), 10, 50, 60, 100, 200, 2000);
        int24[] memory topaz = new int24[](5);
        (topaz[0], topaz[1], topaz[2], topaz[3], topaz[4]) = (int24(1), 50, 100, 200, 2000);
        IVenueAdapter[3] memory cand = [
            IVenueAdapter(
                address(
                    new CLTickSpacingAdapter(
                        ICLTickSpacingFactory(0x1ac9dB4a2608ba45D6127B1737949b51Bb54B7F3), address(this), up
                    )
                )
            ),
            IVenueAdapter(
                address(
                    new CLTickSpacingAdapter(
                        ICLTickSpacingFactory(0xaa5865dC3A60b25D305226d66fd573021f0D8fFB), address(this), topaz
                    )
                )
            ),
            IVenueAdapter(
                address(
                    new UniswapV3Adapter(
                        IUniswapV3Factory(0x9a8442cb89fE713ce7C2f22852e61fBFFeE97EcF), weth, address(this)
                    )
                )
            )
        ];
        uint256 best;
        for (uint256 i; i < existing.length; ++i) {
            try IVenueAdapter(existing[i]).quote(weth, tokenOut, amount) returns (uint256 o) {
                if (o > best) best = o;
            } catch {}
        }
        uint256[3] memory c;
        for (uint256 i; i < 3; ++i) {
            try cand[i].quote(weth, tokenOut, amount) returns (uint256 o) {
                c[i] = o;
            } catch {}
        }
        bytes memory out = abi.encode(best, c[0], c[1], c[2]);
        assembly {
            return(add(out, 32), mload(out))
        }
    }
}
