// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StoaRouter, ISignatureTransfer} from "../src/StoaRouter.sol";
import {StoaRouterV2} from "../src/StoaRouterV2.sol";
import {IFeeDistributor} from "../src/interfaces/IStoa.sol";

/// @notice Run with eth_call as a contract creation (cast call --create): deploys StoaRouterV2 in the call only,
///         adds the given adapters and hop tokens, and returns (live router quote, v2 quote, v2 split quote, routes
///         used) for native -> tokenOut. Nothing is deployed or sent; it lets the real chain (with its precompiles)
///         compare the routers, which a local fork cannot always do.
contract RouterV2Lens {
    constructor(
        address live,
        address fd,
        address weth,
        address[] memory adapters,
        address[] memory hops,
        address tokenOut,
        uint256 amount,
        uint256 parts
    ) {
        StoaRouterV2 v2 = new StoaRouterV2(
            address(this), IFeeDistributor(fd), weth, ISignatureTransfer(address(0)), 1 days
        );
        for (uint256 i; i < adapters.length; ++i) {
            v2.addAdapter(adapters[i]);
        }
        v2.setHops(hops);
        uint256 l;
        try StoaRouter(payable(live)).quote(address(0), tokenOut, amount) returns (StoaRouter.Quote memory q) {
            l = q.amountOut;
        } catch {}
        uint256 one = v2.quote(address(0), tokenOut, amount).amountOut;
        StoaRouterV2.Quote memory s = v2.quoteSplit(address(0), tokenOut, amount, parts);
        bytes memory out = abi.encode(l, one, s.amountOut, s.routes.length);
        assembly {
            return(add(out, 32), mload(out))
        }
    }
}
