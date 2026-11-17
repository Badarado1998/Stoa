// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PoolKey, V4SwapParams, IPoolManager} from "../src/adapters/UniswapV4Adapter.sol";

/// @notice Never deployed: script/data/v4_gas_report.py runs it with eth_call and a code override. It simulates one
///         exact-input swap on one Uniswap V4 pool the way Stoa's V4 adapters do (price limit at the end of the range)
///         and reports the gas the simulation used, so the daily job can flag listed keys that make a pair's quotes
///         expensive (HEY Research Lab, UniswapV4AdapterV3 review, L-1 fix 3).
contract V4GasProbe {
    uint160 internal constant MIN_SQRT_PRICE = 4295128739;
    uint160 internal constant MAX_SQRT_PRICE = 1461446703485210103287233400603844494775084017;

    error Simulated(uint256 inUsed, uint256 out);
    error Result(uint256 gasUsed, uint256 inUsed, uint256 out, bool simulated);

    /// @dev Always reverts with Result. `simulated` is false when the swap failed or ran out of the `cap` gas.
    function probe(IPoolManager pm, PoolKey calldata key, bool zeroForOne, uint256 amountIn, uint256 cap) external {
        bytes memory reason;
        uint256 g = gasleft();
        try pm.unlock{gas: cap}(abi.encode(pm, key, zeroForOne, amountIn)) {}
        catch (bytes memory r) {
            reason = r;
        }
        g -= gasleft();
        if (reason.length == 68 && bytes4(reason) == Simulated.selector) {
            uint256 inUsed;
            uint256 out;
            assembly {
                inUsed := mload(add(reason, 36))
                out := mload(add(reason, 68))
            }
            revert Result(g, inUsed, out, true);
        }
        revert Result(g, 0, 0, false);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        (IPoolManager pm, PoolKey memory key, bool zeroForOne, uint256 amountIn) =
            abi.decode(data, (IPoolManager, PoolKey, bool, uint256));
        int256 delta = pm.swap(
            key,
            V4SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE + 1 : MAX_SQRT_PRICE - 1
            }),
            ""
        );
        int128 d0 = int128(delta >> 128);
        int128 d1 = int128(delta);
        (int128 dIn, int128 dOut) = zeroForOne ? (d0, d1) : (d1, d0);
        revert Simulated(dIn < 0 ? uint256(uint128(-dIn)) : 0, dOut > 0 ? uint256(uint128(dOut)) : 0);
    }
}
