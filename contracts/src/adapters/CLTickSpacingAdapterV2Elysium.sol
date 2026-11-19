// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVenueAdapter} from "../interfaces/IStoa.sol";
import {ICLTickSpacingFactory, ICLPool} from "./CLTickSpacingAdapter.sol";

/// @title CLTickSpacingAdapterV2
/// @notice Fills swaps for StoaRouter on Uniswap-V3-style pools whose factory looks pools up by tick spacing
///         (Aero Slipstream and Ramses CL on Elysium). Picks the best pool across the configured tick spacings.
///         Two-step routes through WHYPE are handled by the router, not here.
/// @dev Quotes simulate the pool swap and revert from the callback (the QuoterV2 technique), so `quote` must be
///      called, not staticcalled. Only the router may call `swap`. The callback only pays a pool that the factory
///      returns for that pool's own tokens and tick spacing.
/// @dev V2 of CLTickSpacingAdapter: each pool's quote simulation is capped at SIM_GAS, as in UniswapV4AdapterV3.
///      Without the cap anyone could add a dust-liquidity pool whose simulation walks the whole tick bitmap and push a
///      swap of that pair past Robinhood Chain's 32M gas limit. A capped simulation that runs out is skipped; a call
///      that cannot give the next simulation its full SIM_GAS reverts (LowGas). At most MAX_SPACINGS x SIM_GAS.
/// @dev Elysium build: identical to CLTickSpacingAdapterV2 except SIM_GAS, 1.5M instead of 1M, so the Aero HYPE/USDC pool
///      can simulate large HYPE sells (about 2,000 HYPE as the pool stood on 19 Nov 2026). The Robinhood Chain
///      adapters stay CLTickSpacingAdapterV2 at 1M.
contract CLTickSpacingAdapterV2Elysium is IVenueAdapter {
    using SafeERC20 for IERC20;

    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287233400603844494775084017;
    /// @notice Gas each pool's quote simulation gets. An ordinary swap simulation uses well under 400k; one that runs
    ///         out (a pool built to make the tick walk expensive) is skipped instead of eating the transaction's gas.
    uint256 public constant SIM_GAS = 1_500_000;
    /// @dev Gas a simulation needs left before it starts: SIM_GAS reaches the call only if 64/63 of it is available.
    uint256 internal constant SIM_GAS_NEEDED = SIM_GAS + SIM_GAS / 16;
    uint256 public constant MAX_SPACINGS = 12;

    ICLTickSpacingFactory public immutable factory;
    address public immutable stoaRouter;
    int24[] internal _spacings;

    error OnlyRouter();
    error NoPath();
    error Slippage();
    error BadCallback();
    error Partial();
    error LowGas();
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
        if (gasleft() < SIM_GAS_NEEDED) revert LowGas();
        try ICLPool(pool)
            .swap{gas: SIM_GAS}(
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
