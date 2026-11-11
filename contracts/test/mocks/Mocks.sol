// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IVenueAdapter} from "../../src/interfaces/IStoa.sol";

contract MockToken is ERC20 {
    uint8 private immutable _dec;

    constructor(string memory n, uint8 d) ERC20(n, n) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

/// @dev Fallback venue with a fixed rate: out = in * num / den.
contract MockAdapter is IVenueAdapter {
    uint256 public num;
    uint256 public den;
    bool public broken;

    constructor(uint256 num_, uint256 den_) {
        num = num_;
        den = den_;
    }

    function setRate(uint256 num_, uint256 den_) external {
        num = num_;
        den = den_;
    }

    function setBroken(bool b) external {
        broken = b;
    }

    function quote(address, address, uint256 amountIn) external view returns (uint256) {
        require(!broken, "broken");
        return amountIn * num / den;
    }

    function swap(address, address tokenOut, uint256 amountIn, uint256 minOut, address to)
        external
        returns (uint256 out)
    {
        out = amountIn * num / den;
        require(out >= minOut, "slippage");
        IERC20(tokenOut).transfer(to, out);
    }
}

/// @dev WETH9-style wrapper for native HYPE, with a test mint.
contract MockWHYPE is ERC20 {
    constructor() ERC20("Wrapped HYPE", "WHYPE") {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amt) external {
        _burn(msg.sender, amt);
        (bool ok,) = msg.sender.call{value: amt}("");
        require(ok, "send");
    }

    receive() external payable {
        _mint(msg.sender, msg.value);
    }
}

/// @dev Minimal Uniswap V2 router: constant-product pairs with a 0.3% fee, reserves kept in this contract.
contract MockV2Router {
    mapping(address => mapping(address => uint256)) public reserve; // reserve[tokenA][tokenB] = amount of tokenA

    function addLiquidity(address a, address b, uint256 ra, uint256 rb) external {
        IERC20(a).transferFrom(msg.sender, address(this), ra);
        IERC20(b).transferFrom(msg.sender, address(this), rb);
        reserve[a][b] += ra;
        reserve[b][a] += rb;
    }

    function _out(uint256 amountIn, uint256 rIn, uint256 rOut) internal pure returns (uint256) {
        require(rIn > 0 && rOut > 0, "no pair");
        uint256 inFee = amountIn * 997;
        return inFee * rOut / (rIn * 1000 + inFee);
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path) public view returns (uint256[] memory a) {
        a = new uint256[](path.length);
        a[0] = amountIn;
        for (uint256 i; i < path.length - 1; ++i) {
            a[i + 1] = _out(a[i], reserve[path[i]][path[i + 1]], reserve[path[i + 1]][path[i]]);
        }
    }

    function swapExactTokensForTokens(uint256 amountIn, uint256 minOut, address[] calldata path, address to, uint256)
        external
        returns (uint256[] memory a)
    {
        a = getAmountsOut(amountIn, path);
        require(a[a.length - 1] >= minOut, "V2: INSUFFICIENT_OUTPUT_AMOUNT");
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        for (uint256 i; i < path.length - 1; ++i) {
            reserve[path[i]][path[i + 1]] += a[i];
            reserve[path[i + 1]][path[i]] -= a[i + 1];
        }
        IERC20(path[path.length - 1]).transfer(to, a[a.length - 1]);
    }
}
