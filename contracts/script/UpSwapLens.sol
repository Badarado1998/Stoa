// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CLTickSpacingAdapter, ICLTickSpacingFactory} from "../src/adapters/CLTickSpacingAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UpVenueRobinhood} from "./UpVenueRobinhood.sol";

interface IWETH {
    function deposit() external payable;
}

/// @notice eth_call (contract creation, with a balance override for the caller) that deploys the up. adapter with
///         itself as the router, quotes, then really swaps WETH -> tokenOut through it, and returns (quote, received).
///         Proves the quote and swap paths (pool callback included) on the real chain; nothing is sent.
contract UpSwapLens is UpVenueRobinhood {
    constructor(address weth, address tokenOut) payable {
        CLTickSpacingAdapter up =
            new CLTickSpacingAdapter(ICLTickSpacingFactory(UP_CL_FACTORY), address(this), upSpacings());
        uint256 q = up.quote(weth, tokenOut, msg.value);
        IWETH(weth).deposit{value: msg.value}();
        IERC20(weth).transfer(address(up), msg.value);
        uint256 b0 = IERC20(tokenOut).balanceOf(address(this));
        up.swap(weth, tokenOut, msg.value, q, address(this));
        bytes memory out = abi.encode(q, IERC20(tokenOut).balanceOf(address(this)) - b0);
        assembly {
            return(add(out, 32), mload(out))
        }
    }
}
