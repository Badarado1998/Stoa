// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {StoaRouter} from "../StoaRouter.sol";

/// @title StoaGasless
/// @notice Swaps without gas for the trader: the trader signs an order (EIP-712) and, for a token with EIP-2612, a
///         permit; anyone may submit both, paying the gas. The contract pulls exactly the signed input from the
///         trader, swaps it through the Stoa router along the signed route and sends the output straight to the
///         trader. Stoa's relayer submits orders and pays their gas.
/// @dev    No owner, no settings, no fee, and it never holds funds between calls. Everything that decides the outcome
///         is signed by the trader: tokens, amount, the minimum out, the route and the deadline. The submitter only
///         chooses when, within the deadline. Each owner's orders run in nonce order, once; `cancel` burns the next
///         nonce. The output always goes to the owner. Native ETH cannot be an input (it cannot be pulled), and can
///         be the output. The permit is tried and ignored on failure, so a permit someone else already used does not
///         block the order: the allowance it set is what the transfer uses.
contract StoaGasless is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Order {
        address owner;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minOut;
        address mid;
        address venue1;
        bool isPool1;
        address venue2;
        bool isPool2;
        uint256 nonce;
        uint256 deadline;
    }

    /// @dev EIP-2612 permit for tokenIn, owner -> this contract. `deadline == 0` means none: an allowance is already set.
    struct Permit {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address owner,address tokenIn,address tokenOut,uint256 amountIn,uint256 minOut,address mid,address venue1,bool isPool1,address venue2,bool isPool2,uint256 nonce,uint256 deadline)"
    );

    StoaRouter public immutable router;
    /// @notice the nonce the owner's next order must carry
    mapping(address => uint256) public nonces;

    event Executed(
        address indexed owner,
        uint256 indexed nonce,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address indexed submitter
    );
    event Cancelled(address indexed owner, uint256 nonce);

    error ZeroAddress();
    error Expired();
    error BadNonce();
    error BadSignature();
    error NativeIn();
    error ShortTransfer();

    constructor(StoaRouter router_) EIP712("StoaGasless", "1") {
        if (address(router_) == address(0)) revert ZeroAddress();
        router = router_;
    }

    function hashOrder(Order calldata o) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ORDER_TYPEHASH,
                    o.owner,
                    o.tokenIn,
                    o.tokenOut,
                    o.amountIn,
                    o.minOut,
                    o.mid,
                    o.venue1,
                    o.isPool1,
                    o.venue2,
                    o.isPool2,
                    o.nonce,
                    o.deadline
                )
            )
        );
    }

    /// @notice Run a signed order: pull `amountIn` of `tokenIn` from the owner, swap it along the signed route and send
    ///         at least `minOut` of `tokenOut` to the owner. Reverts as a whole if any of it fails.
    function execute(Order calldata o, bytes calldata signature, Permit calldata permit)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (o.owner == address(0)) revert ZeroAddress();
        if (o.tokenIn == address(0)) revert NativeIn();
        if (block.timestamp > o.deadline) revert Expired();
        if (o.nonce != nonces[o.owner]) revert BadNonce();
        if (!_validSignature(o.owner, hashOrder(o), signature)) revert BadSignature();
        nonces[o.owner] = o.nonce + 1;

        if (permit.deadline != 0) {
            // ignored on failure: a permit front-run by someone else has already set the same allowance
            try IERC20Permit(o.tokenIn).permit(
                o.owner, address(this), permit.value, permit.deadline, permit.v, permit.r, permit.s
            ) {} catch {}
        }

        IERC20 tin = IERC20(o.tokenIn);
        uint256 b0 = tin.balanceOf(address(this));
        tin.safeTransferFrom(o.owner, address(this), o.amountIn);
        if (tin.balanceOf(address(this)) - b0 != o.amountIn) revert ShortTransfer();

        tin.forceApprove(address(router), o.amountIn);
        amountOut = router.swap(
            StoaRouter.SwapParams({
                tokenIn: o.tokenIn,
                tokenOut: o.tokenOut,
                mid: o.mid,
                leg1: StoaRouter.Leg({venue: o.venue1, isPool: o.isPool1}),
                leg2: StoaRouter.Leg({venue: o.venue2, isPool: o.isPool2}),
                amountIn: o.amountIn,
                minOut: o.minOut,
                to: o.owner,
                deadline: o.deadline,
                referrer: address(0)
            })
        );
        emit Executed(o.owner, o.nonce, o.tokenIn, o.tokenOut, o.amountIn, amountOut, msg.sender);
    }

    /// @dev The owner's own key signs for an ordinary wallet and for one with EIP-7702 code (its key still controls
    ///      it), so ECDSA is tried first whatever the code; a contract wallet's ERC-1271 answer is tried after.
    function _validSignature(address signer, bytes32 hash, bytes calldata signature) private view returns (bool) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        if (err == ECDSA.RecoverError.NoError && recovered == signer) return true;
        return signer.code.length != 0 && SignatureChecker.isValidERC1271SignatureNow(signer, hash, signature);
    }

    /// @notice Burn your next nonce, so a signed order you have not seen run can no longer run.
    function cancel() external {
        uint256 n = nonces[msg.sender];
        nonces[msg.sender] = n + 1;
        emit Cancelled(msg.sender, n);
    }
}
