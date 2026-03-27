# Predict.fun Decoder

JavaScript library and CLI for decoding Predict.fun on-chain data — including trade logs, market parameters, and full-circle validation.

## Modules

| Module | Description |
|--------|-------------|
| `trade_decoder` | Decode `OrderFilled` / `OrdersMatched` / `PositionSplit` from a `txHash`, `receipt`, or raw `logs[]` |
| `market_decoder` | Resolve `conditionId`, tokenIds, and complement relationships from a `marketId` or `tokenId` (API + on-chain dual-source) |
| `demo_validate` | End-to-end validation: market → trade → positions across all three data sources |

## Quick Start

```bash
npm install

# Copy environment config (uses BNB Testnet + public RPC by default)
cp .env.example .env

# Task A: decode a real trade
node src/trade_decoder.js --tx-hash 0x2b06856b775b0918c0c865955dc9a6c8e62f4e03251bd759e70e71482a3614dc

# Task A (offline): decode from fixture files
node src/trade_decoder.js --receipt-file ./fixtures/receipt_0x2b06856b775b0918c0c865955dc9a6c8e62f4e03251bd759e70e71482a3614dc.json
node src/trade_decoder.js --logs-file ./fixtures/logs_0x2b06856b775b0918c0c865955dc9a6c8e62f4e03251bd759e70e71482a3614dc.json

# Task B: decode a market
node src/market_decoder.js --market-id 72829
node src/market_decoder.js --token-id 12723470295927997005591429032016946047344374045078339206225302506313975527799

# Task C: full-circle validation
node src/demo_validate.js --market-id 72829

# Offline regression tests
npm test
```

### More Options

```bash
# Specify a different RPC
node src/trade_decoder.js --tx-hash <hash> --rpc-url https://bsc-testnet.publicnode.com

# Enrich fills with on-chain conditionId / complementTokenId
node src/trade_decoder.js --tx-hash <hash> --enrich

# Custom market cache for tokenId -> market reverse lookup
node src/market_decoder.js --token-id <tokenId> --market-cache-file ./fixtures/market_index.json

# Write output to file
node src/trade_decoder.js --tx-hash <hash> --output ./data/trade.json
node src/market_decoder.js --market-id 72829 --output ./data/market.json
```

### RPC Note

BNB Testnet's official `data-seed-prebsc-*` nodes often work fine with raw `curl`, but may fail with ethers v6's default network detection (`failed to detect network`, `request timeout`, or intermittent `ECONNRESET`). This project defaults to PublicNode and internally uses `staticNetwork + batchMaxCount: 1` for reliable initialization.

## Project Structure

```
src/
├── constants.js        # Contract addresses, ABI, Topic Hashes, routing
├── index.js            # Package entry exports
├── normalize.js        # 18-decimal normalization, BigInt utilities
├── provider.js         # RPC provider factory
├── trade_decoder.js   # Task A: trade log decoding
├── market_decoder.js   # Task B: market parameter decoding
└── demo_validate.js   # Task C: full-circle validation
fixtures/               # Sample market / receipt / matches / positions / market index
test/                   # node:test offline regression suite
data/                   # Output directory
```

## Key Design Decisions

### 1. Keep `taker == exchange` OrderFilled events

In Predict.fun's MINT-type matches, the taker-side summary leg has `taker == exchange address`. This log **should not be dropped** — it carries the complementary outcome's fill information.

### 2. Filter by `log.address`, not `receipt.to`

Predict.fun uses Kernel smart accounts. The transaction's `receipt.to` is usually the account entry, not the Exchange contract. Correct filtering scans all known Exchange/CTF contract addresses.

### 3. CTF events come from two contract sources

`PositionSplit` / `PositionsMerge` events fire on the **ConditionalTokens** contract, not on the Exchange. Decoding must listen to both contract sets.

### 4. ethers v6 compatible RPC initialization

The BNB Testnet official RPCs can fail ethers v6's network detection. This project defaults to PublicNode with `staticNetwork + batchMaxCount: 1`.

### 5. Three-precision normalization unified to BigInt

| Source | Format |
|--------|--------|
| On-chain `OrderFilled` | `uint256`, 1e18 precision |
| API `orders/matches` | `"1e18"` integer string |
| API `orderbook` | `[0.42, 5.1785]` human-readable float |

All internal computation uses BigInt. External output is formatted on demand.

### 6. `tokenId -> market` uses cache fallback

The Predict.fun testnet API cannot reliably filter markets by `conditionId`. The implementation uses a two-stage reverse lookup: try API filter first, fall back to `fixtures/market_index.json`.

## Predict.fun vs Polymarket

| Aspect | Polymarket | Predict.fun |
|--------|-----------|-------------|
| Blockchain | Polygon | **BNB Chain** |
| Collateral decimals | USDC **6 decimals** | USDT **18 decimals** |
| Contract sets | Single | **Four** (standard / NegRisk / Yield-bearing / combined) |
| Match entry | Exchange address | **Kernel smart account** (`receipt.to ≠ exchange`) |
| Fee type | Untyped | **SHARES / COLLATERAL** |

## Supported Market Types

| Type | Status |
|------|--------|
| Regular binary (`isNegRisk=false, isYieldBearing=false`) | ✅ Supported |
| NegRisk markets | ⚠️ v0 reads API data but skips tokenId derivation |
| Yield-bearing markets | ⚠️ v0 reads API data but skips Yield-bearing contract set |
| Mainnet (`chainId=56`) | ⚠️ Requires `RPC_URL` + API key config |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RPC_URL` | `https://bsc-testnet.publicnode.com` | Recommended BNB Testnet RPC |
| `CHAIN_ID` | `97` | Chain ID |
| `API_BASE_URL` | `https://api-testnet.predict.fun` | Predict.fun testnet API |
| `API_KEY` | empty | Mainnet API key; sent as `x-api-key` header when set |
| `MARKET_CACHE_FILE` | `./fixtures/market_index.json` | Local market index for tokenId reverse lookup |

For mainnet: set `CHAIN_ID=56`, `API_BASE_URL=https://api.predict.fun`, and configure `API_KEY`.

## License

MIT
