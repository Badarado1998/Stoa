# Quote freshness

A quote is only good for a short window, so swaps never fill at an old price.

Every quote carries an expiry. At launch a quote is valid for **2 blocks**, roughly 200–400 ms on Elysium. A pool rejects any swap against an expired quote; the router then uses the next best source.

{% hint style="info" %}

The swap screen shows how long the current quote is valid for, next to your slippage setting.

{% endhint %}
