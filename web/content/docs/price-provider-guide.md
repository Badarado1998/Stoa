# Build a price provider

Plug any price source into a pool.

A price provider is a contract that returns a mid price for a pair. Pools call it to sanity-check maker quotes.

```solidity
// interface preview, may change before launch
interface IPriceProvider {
 function midPrice(address base, address quote)
 external view returns (uint256 price, uint256 updatedAt);
}
```
