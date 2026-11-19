import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, parseAbi, type Log } from "viem";
import { CROSS_BUY, crossBuyResult } from "../lib/anyToken";

const ev = parseAbi(["event Refunded(address indexed to, address indexed tokenOut, uint256 ethIn)"]);
const buyer = "0x1111111111111111111111111111111111111111", token = "0x2222222222222222222222222222222222222222";
const refunded = (eth: bigint): Log => ({
  address: CROSS_BUY, topics: encodeEventTopics({ abi: ev, eventName: "Refunded", args: { to: buyer, tokenOut: token } }) as Log["topics"],
  data: encodeAbiParameters([{ type: "uint256" }], [eth]), blockHash: null, blockNumber: null, logIndex: 0, transactionHash: null, transactionIndex: null, removed: false,
});

// HEY Research Lab, any-token review, N-5: anyone can call StoaCrossBuy for any address
test("a refund counts only for the whole ETH this purchase delivered", () => {
  assert.deepEqual(crossBuyResult([refunded(5n)], buyer, token, 5n), { kind: "refunded", eth: 5n });
  assert.equal(crossBuyResult([refunded(1n)], buyer, token, 5n), null);
});
