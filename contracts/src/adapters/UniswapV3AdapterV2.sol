// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVenueAdapter} from "../interfaces/IStoa.sol";
import {IUniswapV3Factory, IUniswapV3Pool} from "./UniswapV3Adapter.sol";

/// @title UniswapV3AdapterV2
/// @notice Fills swaps for StoaRouter directly on Uniswap V3 pools: every fee tier, the direct pair and a two-hop
///         path through the hub token (WHYPE). Launchpad tokens on Elysium trade in V3 pools against HYPE.
/// @dev Quotes simulate the pool swap and revert from the callback (the QuoterV2 technique), so `quote` must be
///      called, not staticcalled, and only through eth_call or the router. Only the router may call `swap`.
/// @dev V2 of UniswapV3Adapter: each pool's quote simulation is capped at SIM_GAS, as in UniswapV4AdapterV3. Without
///      the cap anyone could add a dust-liquidity pool whose simulation walks the whole tick bitmap and push a swap of
///      that pair past Robinhood Chain's 32M gas limit. A capped simulation that runs out is skipped; a call that cannot
///      give the next simulation its full SIM_GAS reverts (LowGas) instead of starving it. A swap runs at most 12
///      simulations (4 fee tiers on the direct pair and on each hub leg), so at most 12 x SIM_GAS.
contract UniswapV3AdapterV2 is IVenueAdapter {
    using SafeERC20 for IERC20;

    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287233400603844494775084017;
    /// @notice Gas each pool's quote simulation gets. An ordinary swap simulation uses well under 400k; one that runs
    ///         out (a pool built to make the tick walk expensive) is skipped instead of eating the transaction's gas.
    uint256 public constant SIM_GAS = 1_000_000;
    /// @dev Gas a simulation needs left before it starts: SIM_GAS reaches the call only if 64/63 of it is available.
    uint256 internal constant SIM_GAS_NEEDED = SIM_GAS + SIM_GAS / 16;

    IUniswapV3Factory public immutable factory;
    address public immutable hub;
    address public immutable stoaRouter;
    uint24[4] internal FEES = [uint24(100), 500, 3000, 10000];

    struct Leg {
        address pool;
        uint256 out;
    }

    error OnlyRouter();
    error NoPath();
    error Slippage();
    error BadCallback();
    error Partial();
    error LowGas();

    constructor(IUniswapV3Factory factory_, address hub_, address stoaRouter_) {
        if (address(factory_) == address(0) || hub_ == address(0) || stoaRouter_ == address(0)) revert NoPath();
        factory = factory_;
        hub = hub_;
        stoaRouter = stoaRouter_;
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn) external returns (uint256 amountOut) {
        (amountOut,,,) = _best(tokenIn, tokenOut, amountIn);
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
        external
        returns (uint256 amountOut)
    {
        if (msg.sender != stoaRouter) revert OnlyRouter();
        (uint256 out, bool viaHub, address p1, address p2) = _best(tokenIn, tokenOut, amountIn);
        if (out == 0) revert NoPath();
        if (!viaHub) {
            amountOut = _exec(p1, tokenIn, tokenOut, amountIn, to);
        } else {
            uint256 mid = _exec(p1, tokenIn, hub, amountIn, address(this));
            amountOut = _exec(p2, hub, tokenOut, mid, to);
        }
        if (amountOut < minOut) revert Slippage();
    }

    /// @dev Real swaps pay what the pool asks for; quote simulations revert with the output amount.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        (bool isQuote, address payer) = abi.decode(data, (bool, address));
        _checkPool(msg.sender);
        (int256 paid, int256 got) = amount0Delta > 0 ? (amount0Delta, amount1Delta) : (amount1Delta, amount0Delta);
        if (isQuote) {
            uint256 out = uint256(-got);
            uint256 inUsed = uint256(paid);
            assembly {
                let p := mload(0x40)
                mstore(p, inUsed)
                mstore(add(p, 0x20), out)
                revert(p, 64)
            }
        }
        address tokenPaid = amount0Delta > 0 ? IUniswapV3Pool(msg.sender).token0() : IUniswapV3Pool(msg.sender).token1();
        if (payer == address(this)) IERC20(tokenPaid).safeTransfer(msg.sender, uint256(paid));
        else revert BadCallback();
    }

    // ---------------------------------------------------------------- internal

    function _best(address tokenIn, address tokenOut, uint256 amountIn)
        private
        returns (uint256 out, bool viaHub, address p1, address p2)
    {
        Leg memory d = _bestLeg(tokenIn, tokenOut, amountIn);
        (out, p1) = (d.out, d.pool);
        if (tokenIn != hub && tokenOut != hub) {
            Leg memory a = _bestLeg(tokenIn, hub, amountIn);
            if (a.out > 0) {
                Leg memory b = _bestLeg(hub, tokenOut, a.out);
                if (b.out > out) (out, viaHub, p1, p2) = (b.out, true, a.pool, b.pool);
            }
        }
    }

    function _bestLeg(address a, address b, uint256 amountIn) private returns (Leg memory best) {
        if (amountIn == 0 || amountIn > uint256(type(int256).max)) return best;
        for (uint256 i; i < FEES.length; ++i) {
            address pool = factory.getPool(a, b, FEES[i]);
            if (pool == address(0) || IUniswapV3Pool(pool).liquidity() == 0) continue;
            uint256 o = _simulate(pool, a, b, amountIn);
            if (o > best.out) best = Leg(pool, o);
        }
    }

    function _simulate(address pool, address a, address b, uint256 amountIn) private returns (uint256) {
        bool zeroForOne = a < b;
        if (gasleft() < SIM_GAS_NEEDED) revert LowGas();
        try IUniswapV3Pool(pool)
            .swap{gas: SIM_GAS}(
                address(this),
                zeroForOne,
                int256(amountIn),
                zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
                abi.encode(true, address(this))
            ) {
            return 0; // a quote simulation always reverts; reaching here means something is off
        } catch (bytes memory reason) {
            if (reason.length != 64) return 0;
            (uint256 inUsed, uint256 out) = abi.decode(reason, (uint256, uint256));
            return inUsed == amountIn ? out : 0; // not enough liquidity for the full amount
        }
    }

    function _exec(address pool, address a, address b, uint256 amountIn, address to) private returns (uint256 out) {
        bool zeroForOne = a < b;
        (int256 d0, int256 d1) = IUniswapV3Pool(pool)
            .swap(
                to,
                zeroForOne,
                int256(amountIn),
                zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
                abi.encode(false, address(this))
            );
        (int256 paid, int256 got) = zeroForOne ? (d0, d1) : (d1, d0);
        if (uint256(paid) != amountIn) revert Partial();
        out = uint256(-got);
    }

    /// @dev The caller must be the canonical pool for its own tokens and fee.
    function _checkPool(address pool) private view {
        IUniswapV3Pool p = IUniswapV3Pool(pool);
        if (factory.getPool(p.token0(), p.token1(), p.fee()) != pool) revert BadCallback();
    }
}
