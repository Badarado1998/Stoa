import { test } from "node:test";
import assert from "node:assert/strict";
import { minOut, parseAmount, fmt, swapKind, routeTokens, cleanRef } from "../lib/swap";
import { TOKENS, WHYPE, NATIVE } from "../lib/tokens";

const [HYPE, W, USDC] = TOKENS;

test("parseAmount", () => {
  assert.equal(parseAmount("1.5", 6), 1_500_000n);
  assert.equal(parseAmount("0.000001", 6), 1n);
  assert.equal(parseAmount("0.0000001", 6), undefined); // too many decimals
  assert.equal(parseAmount("0", 6), undefined);
  assert.equal(parseAmount("abc", 6), undefined);
  assert.equal(parseAmount(".5", 18), 5n * 10n ** 17n);
});

test("minOut applies slippage and rounds down", () => {
  assert.equal(minOut(10_000n, 0.5), 9_950n);
  assert.equal(minOut(999n, 1), 989n);
});

test("fmt", () => {
  assert.equal(fmt(1_234_567_890n, 6, 2), "1,234.56");
  assert.equal(fmt(10n ** 18n, 18), "1");
});

test("swap kind and router tokens", () => {
  assert.equal(swapKind(HYPE, W), "wrap");
  assert.equal(swapKind(W, HYPE), "unwrap");
  assert.equal(swapKind(HYPE, USDC), "hypeIn");
  assert.equal(swapKind(USDC, HYPE), "hypeOut");
  assert.equal(swapKind(USDC, W), "erc20");
  assert.deepEqual(routeTokens(HYPE, USDC), { tokenIn: WHYPE, tokenOut: USDC.address });
  assert.notEqual(routeTokens(USDC, HYPE).tokenOut, NATIVE);
});

test("referral cannot be yourself or garbage", () => {
  const a = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
  assert.equal(cleanRef(a), a);
  assert.equal(cleanRef(a, a.toLowerCase()), undefined);
  assert.equal(cleanRef("0x123"), undefined);
});
