# Router and SDK

Quote and swap from your own app.

```ts
import { Stoa } from '@stoa/sdk'
const stoa = new Stoa({ chainId: 99901 })
const quote = await stoa.quote({ sell: 'USDC', buy: 'WHYPE', amount: '250' })
const tx = await stoa.swap(quote, { slippageBps: 50 })
```

{% hint style="info" %}

The SDK is a preview. Package name and methods may change before launch.

{% endhint %}
