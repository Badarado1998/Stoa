// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IMetricPoolSwap {
    function swap(address, bool, int128, uint128, bytes calldata, bytes calldata) external returns (int128, int128);
}

/// @notice Never deployed: script/data/metric_pools.py runs it with eth_call and a code override. It takes a Metric
///         pool down its real swap path, up to the payment callback, and reverts there with what the pool would take
///         and give. Unlike Metric's quoter, this meets the checks a real swap meets: some pools' oracles answer a
///         simulated quote but refuse the pool when it swaps.
contract MetricSwapProbe {
    error Deltas(int256 amount0, int256 amount1);

    /// @dev Always reverts: with Deltas (perhaps wrapped by the pool) when the pool got as far as asking to be paid.
    function probe(address pool, bool zeroForOne, int128 amountIn) external {
        IMetricPoolSwap(pool).swap(address(this), zeroForOne, amountIn, zeroForOne ? 0 : type(uint128).max, "", "");
    }

    function metricOmmSwapCallback(int256 amount0, int256 amount1, bytes calldata) external pure {
        revert Deltas(amount0, amount1);
    }
}
