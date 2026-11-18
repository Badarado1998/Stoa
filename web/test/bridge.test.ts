import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkLifiTx } from "../lib/bridge";

// real LI.FI Across quotes into Robinhood Chain, recorded 18 Nov 2026
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/lifi-quotes.json", import.meta.url), "utf8")) as {
  want: { user: `0x${string}`; chainId: number; token: `0x${string}`; amount: string };
  tx: { to: `0x${string}`; data: `0x${string}`; value?: string; chainId: number };
}[];
const X = "1111111111111111111111111111111111111111";

test("real quotes pass", () => {
  assert.ok(fixtures.length >= 2);
  for (const f of fixtures) assert.equal(checkLifiTx(f.tx, { ...f.want, amount: BigInt(f.want.amount) }), null);
});

test("swapping the user's address anywhere in the call is refused", () => {
  for (const f of fixtures) {
    const want = { ...f.want, amount: BigInt(f.want.amount) };
    const me = f.want.user.slice(2).toLowerCase(), body = f.tx.data.slice(10).toLowerCase();
    let i = -1, n = 0;
    while ((i = body.indexOf(me, i + 1)) >= 0) {
      n++;
      const data = (f.tx.data.slice(0, 10) + body.slice(0, i) + X + body.slice(i + 40)) as `0x${string}`;
      assert.notEqual(checkLifiTx({ ...f.tx, data }, want), null);
    }
    assert.ok(n >= 3); // BridgeData receiver, Across receiver, Across refund address
  }
});

test("a different amount, chain, token, contract or extra value is refused", () => {
  for (const f of fixtures) {
    const want = { ...f.want, amount: BigInt(f.want.amount) };
    assert.notEqual(checkLifiTx(f.tx, { ...want, amount: want.amount - 1n }), null);
    assert.notEqual(checkLifiTx(f.tx, { ...want, chainId: want.chainId + 1 }), null);
    assert.notEqual(checkLifiTx(f.tx, { ...want, token: `0x${X}` }), null);
    assert.notEqual(checkLifiTx({ ...f.tx, to: `0x${X}` }, want), null);
    assert.notEqual(checkLifiTx({ ...f.tx, value: (BigInt(f.tx.value ?? 0) + 10n ** 17n).toString() }, want), null);
    assert.notEqual(checkLifiTx({ ...f.tx, data: ("0xdeadbeef" + f.tx.data.slice(10)) as `0x${string}` }, want), null);
  }
});
