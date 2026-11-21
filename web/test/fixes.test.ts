import { test } from "node:test";
import assert from "node:assert/strict";
import { hasTag, relayAmount } from "../lib/pay";
import { ldJson } from "../lib/ldJson";
import { visitorOf } from "../lib/visitor";

// 21 Nov review fixes: Stoa Pay tags and Relay amounts (H-1, M-2), JSON-LD escaping (M-4), IPv6 visitors (M-3)
test("the tag is found inside a wrapped call, for this id only", () => {
  const id = "0123456789abcdef";
  assert.equal(hasTag(`0xa9059cbb${"0".repeat(128)}53504159${id}${"0".repeat(40)}`, id), true);
  assert.equal(hasTag(`0xa9059cbb53504159${id}`, "fedcba9876543210"), false);
  assert.equal(hasTag("0x53504159", "not-an-id"), false);
});

test("each request gets its own few micro-USDG from another chain", () => {
  const a = relayAmount(25_000_000n, "bbbbbbbbbbbbbbbb"), b = relayAmount(25_000_000n, "cccccccccccccccc");
  assert.notEqual(a, b);
  assert.ok(a - 25_000_000n < 10_000n && b - 25_000_000n < 10_000n);
});

test("a symbol can never close a JSON-LD script", () => {
  const s = ldJson({ name: "How do I buy </script><script>alert(1)</script>?" });
  assert.ok(!s.includes("<") && !s.includes(">"));
  assert.deepEqual(JSON.parse(s), { name: "How do I buy </script><script>alert(1)</script>?" });
});

test("IPv6 visitors are counted by their /64", () => {
  const r = (ip: string) => new Request("https://x", { headers: { "x-forwarded-for": ip } });
  assert.equal(visitorOf(r("2001:db8:1:2:aaaa::1")), visitorOf(r("2001:db8:1:2:bbbb::9")));
  assert.notEqual(visitorOf(r("2001:db8:1:3::1")), visitorOf(r("2001:db8:1:2::1")));
  assert.equal(visitorOf(r("1.2.3.4, 10.0.0.1")), "1.2.3.4");
});
