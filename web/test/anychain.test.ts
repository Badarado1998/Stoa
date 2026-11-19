import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, parseAbi, type Address } from "viem";
import { ETH_USD_FLOOR, MAX_USD, RELAY_DEPOSITORY, capUsdOf, checkAnyQuote, depositIdOf, type AnyQuote } from "../lib/anychain";
import { NATIVE_ZERO } from "../lib/bridge";

const ABI = parseAbi(["function depositNative(address depositor, bytes32 id) payable", "function depositErc20(address depositor, address token, uint256 amount, bytes32 id)"]);
const user = "0x1111111111111111111111111111111111111111" as Address;
const id = `0x${"ab".repeat(32)}` as const;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;

function nativeQuote(amount: bigint, over: Partial<AnyQuote["estimate"]> = {}, ethUsd = 3000): AnyQuote {
  return {
    intentId: "00000000-0000-4000-8000-000000000000", provider: "relay", approvals: [], ethUsd, stoaPerUsd: 30000,
    estimate: { fromAmount: amount.toString(), toAmount: "1000000000000000000000", toAmountMin: "990000000000000000000", ...over },
    transaction: { chainId: 8453, to: RELAY_DEPOSITORY, value: amount.toString(), data: encodeFunctionData({ abi: ABI, functionName: "depositNative", args: [user, id] }) },
  };
}
const want = (amount: bigint, token: Address = NATIVE_ZERO) => ({ user, chainId: 8453, token, amount });

test("an honest ETH deposit under the cap passes", () => {
  const a = 10n ** 17n; // 0.1 ETH at $3,000
  assert.equal(checkAnyQuote(nativeQuote(a), want(a)), null);
});

test("a low ETH price cannot lift the cap: ETH is valued at no less than the floor", () => {
  const a = 10n ** 18n; // 1 ETH: $1,200 at the floor, over $500 however low the router read
  assert.match(checkAnyQuote(nativeQuote(a, {}, 1), want(a)) ?? "", /limited to \$500/);
  assert.ok((capUsdOf(want(a), 1) ?? 0) >= ETH_USD_FLOOR);
  assert.ok((capUsdOf(want(a), 5000) ?? 0) > MAX_USD);
});

test("no ETH price refuses", () => {
  const a = 10n ** 16n;
  assert.match(checkAnyQuote(nativeQuote(a, {}, 0), want(a)) ?? "", /could not price/);
});

test("the minimum must be within 2% of the quoted output, and not above it", () => {
  const a = 10n ** 16n;
  assert.notEqual(checkAnyQuote(nativeQuote(a, { toAmountMin: "1" }), want(a)), null);
  assert.notEqual(checkAnyQuote(nativeQuote(a, { toAmountMin: "970000000000000000000" }), want(a)), null);
  assert.notEqual(checkAnyQuote(nativeQuote(a, { toAmountMin: "1000000000000000000001" }), want(a)), null);
  assert.equal(checkAnyQuote(nativeQuote(a, { toAmountMin: "980000000000000000000" }), want(a)), null);
});

test("Trustware's dollar figure must agree with Stoa's", () => {
  const a = 10n ** 17n; // $300
  assert.equal(checkAnyQuote(nativeQuote(a, { fromAmountUsd: "301" }), want(a)), null);
  for (const v of ["1", "0", "", "-1", "abc"]) assert.notEqual(checkAnyQuote(nativeQuote(a, { fromAmountUsd: v }), want(a)), null, v);
});

test("stablecoins are valued from their own decimals", () => {
  assert.equal(capUsdOf(want(500_000_000n, BASE_USDC), null), 500);
  assert.equal(capUsdOf(want(500_000_001n, BASE_USDC), null)! > MAX_USD, true);
});

test("depositIdOf reads the order id from either deposit call", () => {
  assert.equal(depositIdOf(encodeFunctionData({ abi: ABI, functionName: "depositNative", args: [user, id] })), id);
  assert.equal(depositIdOf(encodeFunctionData({ abi: ABI, functionName: "depositErc20", args: [user, BASE_USDC, 5n, id] })), id);
  assert.equal(depositIdOf("0x12345678"), null);
});
