// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVenueAdapter} from "../interfaces/IStoa.sol";

/// @notice Factories that key concentrated-liquidity pools by tick spacing (Aero Slipstream, Ramses CL).
interface ICLTickSpacingFactory {
    function getPool(address a, address b, int24 tickSpacing) external view returns (address);
}

interface ICLPool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function tickSpacing() external view returns (int24);
    function liquidity() external view returns (uint128);
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

/// @title CLTickSpacingAdapter
/// @notice Fills swaps for StoaRouter on Uniswap-V3-style pools whose factory looks pools up by tick spacing
///         (Aero Slipstream and Ramses CL on Elysium). Picks the best pool across the configured tick spacings.
///         Two-step routes through WHYPE are handled by the router, not here.
/// @dev Quotes simulate the pool swap and revert from the callback (the QuoterV2 technique), so `quote` must be
///      called, not staticcalled. Only the router may call `swap`. The callback only pays a pool that the factory
///      returns for that pool's own tokens and tick spacing.
contract CLTickSpacingAdapter is IVenueAdapter {
    using SafeERC20 for IERC20;

    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287233400603844494775084017;
    uint256 public constant MAX_SPACINGS = 12;

    ICLTickSpacingFactory public immutable factory;
    address public immutable stoaRouter;
    int24[] internal _spacings;

    error OnlyRouter();
    error NoPath();
    error Slippage();
    error BadCallback();
    error Partial();
    error BadConfig();

    constructor(ICLTickSpacingFactory factory_, address stoaRouter_, int24[] memory spacings_) {
        if (address(factory_) == address(0) || stoaRouter_ == address(0)) revert BadConfig();
        if (spacings_.length == 0 || spacings_.length > MAX_SPACINGS) revert BadConfig();
        factory = factory_;
        stoaRouter = stoaRouter_;
        _spacings = spacings_;
    }

    function spacings() external view returns (int24[] memory) {
        return _spacings;
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn) external returns (uint256 amountOut) {
        (, amountOut) = _best(tokenIn, tokenOut, amountIn);
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
        external
        returns (uint256 amountOut)
    {
        if (msg.sender != stoaRouter) revert OnlyRouter();
        (address pool, uint256 out) = _best(tokenIn, tokenOut, amountIn);
        if (out == 0) revert NoPath();
        bool zeroForOne = tokenIn < tokenOut;
        (int256 d0, int256 d1) = ICLPool(pool)
            .swap(
                to,
                zeroForOne,
                int256(amountIn),
                zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
                abi.encode(false)
            );
        (int256 paid, int256 got) = zeroForOne ? (d0, d1) : (d1, d0);
        if (uint256(paid) != amountIn) revert Partial();
        amountOut = uint256(-got);
        if (amountOut < minOut) revert Slippage();
    }

    /// @dev Real swaps pay what the pool asks for; quote simulations revert with (input used, output).
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        ICLPool p = ICLPool(msg.sender);
        address t0 = p.token0();
        address t1 = p.token1();
        if (factory.getPool(t0, t1, p.tickSpacing()) != msg.sender) revert BadCallback();
        bool isQuote = abi.decode(data, (bool));
        (int256 paid, int256 got) = amount0Delta > 0 ? (amount0Delta, amount1Delta) : (amount1Delta, amount0Delta);
        if (isQuote) {
            uint256 inUsed = uint256(paid);
            uint256 out = uint256(-got);
            assembly {
                let ptr := mload(0x40)
                mstore(ptr, inUsed)
                mstore(add(ptr, 0x20), out)
                revert(ptr, 64)
            }
        }
        IERC20(amount0Delta > 0 ? t0 : t1).safeTransfer(msg.sender, uint256(paid));
    }

    // ---------------------------------------------------------------- internal

    function _best(address a, address b, uint256 amountIn) private returns (address pool, uint256 out) {
        if (a == b || amountIn == 0 || amountIn > uint256(type(int256).max)) return (address(0), 0);
        for (uint256 i; i < _spacings.length; ++i) {
            address p = factory.getPool(a, b, _spacings[i]);
            if (p == address(0) || p.code.length == 0) continue;
            try ICLPool(p).liquidity() returns (uint128 l) {
                if (l == 0) continue;
            } catch {
                continue;
            }
            uint256 o = _simulate(p, a, b, amountIn);
            if (o > out) (pool, out) = (p, o);
        }
    }

    function _simulate(address pool, address a, address b, uint256 amountIn) private returns (uint256) {
        bool zeroForOne = a < b;
        try ICLPool(pool)
            .swap(
                address(this),
                zeroForOne,
                int256(amountIn),
                zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
                abi.encode(true)
            ) {
            return 0; // a simulation always reverts
        } catch (bytes memory reason) {
            if (reason.length != 64) return 0;
            (uint256 inUsed, uint256 o) = abi.decode(reason, (uint256, uint256));
            return inUsed == amountIn ? o : 0; // not enough liquidity for the full amount
        }
    }
}
