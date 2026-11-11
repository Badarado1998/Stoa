// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Read surface of the maker registry used by pools and the fee distributor.
interface IMakerRegistry {
    function isPool(address pool) external view returns (bool);
    function isActiveMaker(address pool, address maker) external view returns (bool);
    function guardian() external view returns (address);
}

/// @notice Pools forward the protocol fee here after transferring it.
interface IFeeDistributor {
    function notifyFee(address token, uint256 amount, address referrer) external;
}

/// @notice A maker-quoted pool for one base/quote pair.
interface IStoaPool {
    function base() external view returns (address);
    function quote() external view returns (address);
    function quoteOut(address tokenIn, uint256 amountIn) external view returns (uint256 amountOut);
    function swap(address tokenIn, uint256 amountIn, uint256 minOut, address to, address referrer)
        external
        returns (uint256 amountOut);
}

/// @notice Adapter for a fallback venue (Uniswap, Nest, ...).
/// @dev `quote` may be non-view (Uniswap quoters revert-and-catch); the router calls it with try/catch.
///      `swap` is called after the router has transferred `amountIn` of `tokenIn` to the adapter, and must
///      send at least `minOut` of `tokenOut` to `to`, returning the amount sent.
interface IVenueAdapter {
    function quote(address tokenIn, address tokenOut, uint256 amountIn) external returns (uint256 amountOut);
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
        external
        returns (uint256 amountOut);
}
