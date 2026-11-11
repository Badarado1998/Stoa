// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVenueAdapter} from "../interfaces/IStoa.sol";

interface IUniswapV3Factory {
    function getPool(address a, address b, uint24 fee) external view returns (address);
}

interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function liquidity() external view returns (uint128);
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

/// @title UniswapV3Adapter
/// @notice Fills swaps for StoaRouter directly on Uniswap V3 pools: every fee tier, the direct pair and a two-hop
///         path through the hub token (WHYPE). Launchpad tokens on Elysium trade in V3 pools against HYPE.
/// @dev Quotes simulate the pool swap and revert from the callback (the QuoterV2 technique), so `quote` must be
///      called, not staticcalled, and only through eth_call or the router. Only the router may call `swap`.
contract UniswapV3Adapter is IVenueAdapter {
    using SafeERC20 for IERC20;

    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287233400603844494775084017;

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

    constructor(IUniswapV3Factory factory_, address hub_, address stoaRouter_) {
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
        try IUniswapV3Pool(pool)
            .swap(
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
