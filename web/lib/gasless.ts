import { erc20Abi, getAddress, isAddress, keccak256, encodeAbiParameters, stringToHex, parseAbi, type Address, type Hex, type PublicClient } from "viem";

/** Gasless swaps on Robinhood Chain (contracts/src/tools/StoaGasless.sol): the trader signs an order and, for a token
 *  with EIP-2612, a permit; Stoa's relayer submits both and pays the gas (app/api/gasless). Off until the contract is
 *  deployed: NEXT_PUBLIC_GASLESS holds its address. */

export const GASLESS: Address | undefined = (() => {
  const a = process.env.NEXT_PUBLIC_GASLESS ?? "";
  return isAddress(a) ? getAddress(a) : undefined;
})();
export const GASLESS_CHAIN = 4663;
/** how long a signed order stays valid */
export const GASLESS_TTL_S = 600;
/** gasless swaps per wallet per day */
export const GASLESS_PER_DAY = 10;
/** below this much ETH the Trade box offers a swap without gas first */
export const GAS_FLOOR_WEI = 20_000_000_000_000n; // 0.00002 ETH, about one swap at Robinhood Chain gas prices

export const gaslessAbi = parseAbi([
  "struct Order { address owner; address tokenIn; address tokenOut; uint256 amountIn; uint256 minOut; address mid; address venue1; bool isPool1; address venue2; bool isPool2; uint256 nonce; uint256 deadline; }",
  "struct Permit { uint256 value; uint256 deadline; uint8 v; bytes32 r; bytes32 s; }",
  "function execute(Order o, bytes signature, Permit permit) returns (uint256 amountOut)",
  "function nonces(address owner) view returns (uint256)",
  "function cancel()",
  "event Executed(address indexed owner, uint256 indexed nonce, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, address indexed submitter)",
  "error ZeroAddress()",
  "error Expired()",
  "error BadNonce()",
  "error BadSignature()",
  "error NativeIn()",
  "error ShortTransfer()",
]);

export type GaslessOrder = {
  owner: Address; tokenIn: Address; tokenOut: Address; amountIn: bigint; minOut: bigint;
  mid: Address; venue1: Address; isPool1: boolean; venue2: Address; isPool2: boolean; nonce: bigint; deadline: bigint;
};
export type GaslessPermit = { value: bigint; deadline: bigint; v: number; r: Hex; s: Hex };
export const NO_PERMIT: GaslessPermit = { value: 0n, deadline: 0n, v: 0, r: `0x${"00".repeat(32)}`, s: `0x${"00".repeat(32)}` };

export const orderTypes = {
  Order: [
    { name: "owner", type: "address" }, { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" }, { name: "minOut", type: "uint256" }, { name: "mid", type: "address" },
    { name: "venue1", type: "address" }, { name: "isPool1", type: "bool" }, { name: "venue2", type: "address" },
    { name: "isPool2", type: "bool" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
  ],
} as const;
export const orderDomain = (verifyingContract: Address) => ({ name: "StoaGasless", version: "1", chainId: GASLESS_CHAIN, verifyingContract });

export const permitTypes = {
  Permit: [
    { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
  ],
} as const;

const permitAbi = parseAbi([
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function nonces(address) view returns (uint256)",
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
]);
const DOMAIN_TYPEHASH = keccak256(stringToHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));

export type PermitDomain = { name: string; version: string; chainId: number; verifyingContract: Address };

/** The token's EIP-2612 signing domain, checked against its DOMAIN_SEPARATOR; null when it has no permit or the domain
 *  cannot be matched (then the token cannot be swapped without gas, unless it is already approved). */
export async function permitDomain(pub: PublicClient, token: Address): Promise<PermitDomain | null> {
  let sep: Hex;
  try {
    [sep] = await Promise.all([
      pub.readContract({ address: token, abi: permitAbi, functionName: "DOMAIN_SEPARATOR" }),
      pub.readContract({ address: token, abi: permitAbi, functionName: "nonces", args: [token] }),
    ]);
  } catch { return null; }
  const matches = (name: string, version: string) =>
    keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [DOMAIN_TYPEHASH, keccak256(stringToHex(name)), keccak256(stringToHex(version)), BigInt(GASLESS_CHAIN), token],
    )) === sep;
  const tries: [string, string][] = [];
  try {
    const d = await pub.readContract({ address: token, abi: permitAbi, functionName: "eip712Domain" });
    tries.push([d[1], d[2]]);
  } catch { /* EIP-5267 is optional */ }
  try {
    const name = await pub.readContract({ address: token, abi: erc20Abi, functionName: "name" });
    for (const v of ["1", "2"]) tries.push([name, v]);
  } catch { /* no name */ }
  for (const [name, version] of tries) if (matches(name, version)) return { name, version, chainId: GASLESS_CHAIN, verifyingContract: token };
  return null;
}

/** JSON wire form of an order, a permit and its signature (bigints as decimal strings) */
export type GaslessWire = { order: Record<keyof GaslessOrder, string | boolean>; signature: Hex; permit: Record<keyof GaslessPermit, string | number> };
export const toWire = (o: GaslessOrder, signature: Hex, p: GaslessPermit): GaslessWire => ({
  order: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])) as GaslessWire["order"],
  signature,
  permit: { value: p.value.toString(), deadline: p.deadline.toString(), v: p.v, r: p.r, s: p.s },
});
