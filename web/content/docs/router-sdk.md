# Router and SDK

Quote and swap from your own app or contract.

## Quote

`quote` returns the best route: the amount out (after all fees), and the venue for each leg. It simulates swaps, so call it with `eth_call` (in viem, `simulateContract`). Use the zero address for native HYPE.

```ts
const { result: route } = await client.simulateContract({
  address: ROUTER, abi: routerAbi,
  functionName: 'quote',
  args: [USDC, WHYPE, 250_000_000n],
})
// route.amountOut, route.mid (zero = direct), route.leg1, route.leg2
```

## Swap

Pass the route back with your limits. The router only accepts venues on its allowlist and checks what the recipient actually receives.

```ts
await wallet.writeContract({
  address: ROUTER, abi: routerAbi, functionName: 'swap',
  args: [{
    tokenIn: USDC, tokenOut: WHYPE,
    mid: route.mid, leg1: route.leg1, leg2: route.leg2,
    amountIn: 250_000_000n,
    minOut: route.amountOut * 995n / 1000n, // 0.5% slippage
    to: account, deadline, referrer: zeroAddress,
  }],
  // value: amountIn when tokenIn is native HYPE
})
```

## Permit2

`swapWithPermit2(params, permit, signature)` pulls the input with a [Permit2](https://github.com/Uniswap/permit2) signature instead of an approval to the router. The permit must be signed by the caller, for the same token, with the router as spender.

{% hint style="info" %}

A typed SDK package will follow. Until then, the full ABI comes with the verified source on [Sourcify](https://repo.sourcify.dev/99901/0x104752D50ef893da579Ad813918269e09Ea17dbA).

{% endhint %}
