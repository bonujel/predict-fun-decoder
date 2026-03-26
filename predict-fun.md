# 阶段一：Predict.fun 架构与链上数据解码

## 学习目标

- 了解 Predict.fun 当前可落地的数据模型，包括 `market`、`conditionId`、`oracleQuestionId`、`resolverAddress`、`outcome.onChainId`、`order match`、`position` 之间的关系。
- 理解 Predict.fun 在链上"市场登记 -> 交易撮合 -> 头寸变化 -> 结算"过程中，哪些信息来自合约日志，哪些信息来自 API，哪些信息必须交叉验证。
- 设计两个最小可实现能力面：
  - **trade_decoder**：输入 `txHash` 或 receipt/logs，输出一笔撮合里的成交腿结构。
  - **market_decoder**：输入 `marketId` / `conditionId` / `tokenId` 或市场上下文，输出 `condition`、`oracle`、`token ids` 等市场参数。
- 以 Predict.fun 的真实样例完成一个最小闭环：
  - 解出 1 笔或几笔真实成交。
  - 解出对应 market / condition / token ids。
  - 用 `markets` / `positions` / `orders/matches` 做轻量校验。

---

## 先定实现边界

这份文档不是"覆盖 Predict.fun 全部协议形态"，而是先给 JavaScript 版 decoder 定一个**能跑通的最小闭环**。v0 的边界如下：

- **链**：优先使用 `BNB Testnet (chainId = 97)` 做 demo 和验证；主网保留为后续兼容目标。
- **市场类型**：优先支持 `isNegRisk = false && isYieldBearing = false` 的常规二元市场。
- **trade_decoder**：先支持"给定 tx hash/receipt，解出该 tx 中的 `OrderFilled` / `OrdersMatched` / CTF 相关日志，并还原成交腿"。
- **market_decoder**：先支持"给定 `marketId`，输出市场上下文，并完成 tokenId / conditionId 的链上校验"。
- **validate/demo**：以 Predict.fun 的公开测试网 API + 测试网链上交易做轻量验收。

暂不纳入 v0 的内容：

- `isYieldBearing = true` 的收益型抵押品口径处理。
- 面向所有 NegRisk 市场的一般化 `conditionId` 推导。
- 主网 API 鉴权、全量历史回放、完整撮合归因。
- 完整结算流水对账，只保留"字段一致性验证"。

---

## 当前确认的基线（截至 2026-03-26）

### 1. 链与核心合约

Predict.fun 当前可直接落地的部署基线，以官方 SDK（`@predictdotfun/sdk`）`Constants.ts` 和已部署合约页为准。

#### BNB Mainnet（chainId = 56）

**常规合约集（v0 使用）**：

| 合约 | 地址 |
|------|------|
| `CTF_EXCHANGE` | `0x8BC070BEdAB741406F4B1Eb65A72bee27894B689` |
| `NEG_RISK_CTF_EXCHANGE` | `0x365fb81bd4A24D6303cd2F19c349dE6894D8d58A` |
| `NEG_RISK_ADAPTER` | `0xc3Cf7c252f65E0d8D88537dF96569AE94a7F1A6E` |
| `CONDITIONAL_TOKENS` | `0x22DA1810B194ca018378464a58f6Ac2B10C9d244` |
| `NEG_RISK_CONDITIONAL_TOKENS` | `0x22DA1810B194ca018378464a58f6Ac2B10C9d244` |
| `USDT` | `0x55d398326f99059fF775485246999027B3197955` |

**Yield-bearing 合约集（v0 不纳入，后续扩展）**：

| 合约 | 地址 |
|------|------|
| `YIELD_BEARING_CTF_EXCHANGE` | `0x6bEb5a40C032AFc305961162d8204CDA16DECFa5` |
| `YIELD_BEARING_NEG_RISK_CTF_EXCHANGE` | `0x8A289d458f5a134bA40015085A8F50Ffb681B41d` |
| `YIELD_BEARING_NEG_RISK_ADAPTER` | `0x41dCe1A4B8FB5e6327701750aF6231B7CD0B2A40` |
| `YIELD_BEARING_CONDITIONAL_TOKENS` | `0x9400F8Ad57e9e0F352345935d6D3175975eb1d9F` |
| `YIELD_BEARING_NEG_RISK_CONDITIONAL_TOKENS` | `0xF64b0b318AAf83BD9071110af24D24445719A07F` |

**智能账户合约**：

| 合约 | 地址 |
|------|------|
| `KERNEL` | `0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D` |
| `ECDSA_VALIDATOR` | `0x845ADb2C711129d4f3966735eD98a9F09fC4cE57` |

#### BNB Testnet（chainId = 97）

**常规合约集（v0 使用）**：

| 合约 | 地址 |
|------|------|
| `CTF_EXCHANGE` | `0x2A6413639BD3d73a20ed8C95F634Ce198ABbd2d7` |
| `NEG_RISK_CTF_EXCHANGE` | `0xd690b2bd441bE36431F6F6639D7Ad351e7B29680` |
| `NEG_RISK_ADAPTER` | `0x285c1B939380B130D7EBd09467b93faD4BA623Ed` |
| `CONDITIONAL_TOKENS` | `0x2827AAef52D71910E8FBad2FfeBC1B6C2DA37743` |
| `NEG_RISK_CONDITIONAL_TOKENS` | `0x2827AAef52D71910E8FBad2FfeBC1B6C2DA37743` |
| `USDT` | `0xB32171ecD878607FFc4F8FC0bCcE6852BB3149E0` |

**Yield-bearing 合约集**：

| 合约 | 地址 |
|------|------|
| `YIELD_BEARING_CTF_EXCHANGE` | `0x8a6B4Fa700A1e310b106E7a48bAFa29111f66e89` |
| `YIELD_BEARING_NEG_RISK_CTF_EXCHANGE` | `0x95D5113bc50eD201e319101bbca3e0E250662fCC` |
| `YIELD_BEARING_NEG_RISK_ADAPTER` | `0xb74aea04bdeBE912Aa425bC9173F9668e6f11F99` |
| `YIELD_BEARING_CONDITIONAL_TOKENS` | `0x38BF1cbD66d174bb5F3037d7068E708861D68D7f` |
| `YIELD_BEARING_NEG_RISK_CONDITIONAL_TOKENS` | `0x26e865CbaAe99b62fbF9D18B55c25B5E079A93D5` |

### 2. Predict.fun 与 Polymarket 的关键差异

这几条不是背景知识，而是实现时必须编码进去的约束：

| 维度 | Polymarket | Predict.fun |
|------|-----------|-------------|
| **区块链** | Polygon (chainId: 137) | BNB Chain (chainId: 56/97) |
| **抵押品** | USDC.e (6 decimals) | USDT (**18 decimals**) |
| **抵押品地址 (主网)** | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` | `0x55d398326f99059fF775485246999027B3197955` |
| **金额精度** | `1e6` | **`1e18`** |
| **收益功能** | 无 | 有 (通过 Venus Protocol, ~3-5% APY) |
| **合约集数量** | 单套 | **双套** (标准 + Yield-bearing) |
| **预言机** | UMA Optimistic Oracle | UMA + AI 混合 |
| **智能账户** | Gnosis Safe / Proxy | Kernel v0.3.1 (ZeroDev) |
| **EIP-712 域名** | `Polymarket CTF Exchange` | `predict.fun CTF Exchange` |
| **费率模型** | 近零 | Taker 费 (`feeRateBps`, 通常 200 = 2%) |
| **价格小数位** | 固定 2 位 | 2 或 3 位 (`decimalPrecision` 字段) |
| **市场变体** | 无 | `DEFAULT` / `SPORTS_MATCH` / `CRYPTO_UP_DOWN` / `TWEET_COUNT` / `SPORTS_TEAM_MATCH` |

实现时的**硬性约束清单**：

1. **稳定币是 18 位精度，不是 6 位。** 所有 `makerAmountFilled / takerAmountFilled / fee` 都是 `1e18` 口径。
2. **API 和链上口径不统一。**
   - `orders/matches`、`positions` 返回 `1e18` 整数字符串（如 `"778500000000000000"`）
   - `orderbook` 返回人类可读浮点数（如 `0.42`）
   - `orders/matches` 中的 `price` 也是 `1e18` 整数字符串（如 `"580000000000000000"` 表示 `0.58`）
3. **文档存在版本漂移。** 官方页面中仍能看到旧的 Blast / USDB / Sepolia 描述。以"SDK 常量 + live API + 合约 ABI"为准。
4. **主网 API 当前需要鉴权。** `https://api.predict.fun/v1/markets?first=1` 返回 `401`。v0 demo 用 `https://api-testnet.predict.fun`。
5. **NegRisk 的 `conditionId` 重建规则和常规市场不同。** 详见后文 NegRisk 章节。

---

## 事件签名与 Topic Hash（实现必备）

这是 JavaScript 实现时用于 `receipt.logs` 过滤和解码的核心常量。所有 Topic0 Hash 已通过 keccak256 独立计算验证。

### Exchange 事件

| 事件 | Solidity 签名 | Topic0 |
|------|--------------|--------|
| **OrderFilled** | `OrderFilled(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)` | `0xd0a08e8c493f9c94f29311604c9de1b4e8c8d4c06bd0c789af57f2d65bfec0f6` |
| **OrdersMatched** | `OrdersMatched(bytes32,address,uint256,uint256,uint256,uint256)` | `0x63bf4d16b7fa898ef4c4b2b6d90fd201e9c56313b65638af6088d149d2ce956c` |
| **TokenRegistered** | `TokenRegistered(uint256,uint256,bytes32)` | `0xbc9a2432e8aeb48327246cddd6e872ef452812b4243c04e6bfb786a2cd8faf0d` |
| **OrderCancelled** | `OrderCancelled(bytes32)` | `0x5152abf959f6564662358c2e52b702259b78bac5ee7842a0f01937e670efcc7d` |
| **FeeCharged** | `FeeCharged(address,uint256,uint256)` | `0xacffcc86834d0f1a64b0d5a675798deed6ff0bcfc2231edd3480e7288dba7ff4` |

### ConditionalTokens 事件

| 事件 | Solidity 签名 | Topic0 |
|------|--------------|--------|
| **ConditionPreparation** | `ConditionPreparation(bytes32,address,bytes32,uint256)` | `0xab3760c3bd2bb38b5bcf54dc79802ed67338b4cf29f3054ded67ed24661e4177` |
| **ConditionResolution** | `ConditionResolution(bytes32,address,bytes32,uint256,uint256[])` | `0xb44d84d3289691f71497564b85d4233648d9dbae8cbdbb4329f301c3a0185894` |
| **PositionSplit** | `PositionSplit(address,address,bytes32,bytes32,uint256[],uint256)` | `0x2e6bb91f8cbcda0c93623c54d0403a43514fabc40084ec96b6d5379a74786298` |
| **PositionsMerge** | `PositionsMerge(address,address,bytes32,bytes32,uint256[],uint256)` | `0x6f13ca62553fcc2bcd2372180a43949c1e4cebba603901ede2f4e14f36b282ca` |
| **PayoutRedemption** | `PayoutRedemption(address,address,bytes32,bytes32,uint256[],uint256)` | `0x2682012a4a4f1973119f1c9b90745d1bd91fa2bab387344f044cb3586864d18d` |

### JS 实现参考

```javascript
// ethers.js v6
import { id } from 'ethers';

const TOPICS = {
  OrderFilled: id('OrderFilled(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)'),
  OrdersMatched: id('OrdersMatched(bytes32,address,uint256,uint256,uint256,uint256)'),
  TokenRegistered: id('TokenRegistered(uint256,uint256,bytes32)'),
  ConditionPreparation: id('ConditionPreparation(bytes32,address,bytes32,uint256)'),
  PositionSplit: id('PositionSplit(address,address,bytes32,bytes32,uint256[],uint256)'),
  PositionsMerge: id('PositionsMerge(address,address,bytes32,bytes32,uint256[],uint256)'),
};
```

---

## 事件 ABI 解码规范

### OrderFilled 事件

```solidity
event OrderFilled(
    bytes32 indexed orderHash,     // topic[1]
    address indexed maker,         // topic[2]
    address indexed taker,         // topic[3]
    uint256 makerAssetId,          // data[0:32]   - 0 = USDT, 非零 = outcome tokenId
    uint256 takerAssetId,          // data[32:64]
    uint256 makerAmountFilled,     // data[64:96]  - 原始 uint256, 18 decimals
    uint256 takerAmountFilled,     // data[96:128]
    uint256 fee                    // data[128:160]
);
```

**JS 解码方式**：

```javascript
// topics
const orderHash = log.topics[1];
const maker = '0x' + log.topics[2].slice(26);
const taker = '0x' + log.topics[3].slice(26);

// data - 每 32 bytes (64 hex chars) 一个字段
const data = log.data.slice(2); // 去掉 0x
const makerAssetId   = BigInt('0x' + data.slice(0, 64));
const takerAssetId   = BigInt('0x' + data.slice(64, 128));
const makerAmountFilled = BigInt('0x' + data.slice(128, 192));
const takerAmountFilled = BigInt('0x' + data.slice(192, 256));
const fee            = BigInt('0x' + data.slice(256, 320));
```

### OrdersMatched 事件

```solidity
event OrdersMatched(
    bytes32 indexed takerOrderHash,  // topic[1]
    address indexed takerOrderMaker, // topic[2]
    uint256 makerAssetId,            // data[0:32]
    uint256 takerAssetId,            // data[32:64]
    uint256 makerAmountFilled,       // data[64:96]
    uint256 takerAmountFilled        // data[96:128]
);
```

### PositionSplit 事件

```solidity
event PositionSplit(
    address indexed stakeholder,       // topic[1]
    address         collateralToken,   // data (非 indexed)
    bytes32 indexed parentCollectionId,// topic[2]
    bytes32 indexed conditionId,       // topic[3]
    uint256[]       partition,         // data (动态数组)
    uint256         amount             // data
);
```

### PositionsMerge 事件

与 `PositionSplit` 布局完全相同，只是语义相反（合并赎回，而非拆分铸造）。

---

## Exchange 合约 ABI（decoder 需要的只读函数）

以下函数用于 `market_decoder` 的链上校验：

```javascript
const EXCHANGE_ABI = [
  // 只读函数
  'function getConditionId(uint256 tokenId) view returns (bytes32)',
  'function getComplement(uint256 tokenId) view returns (uint256)',
  'function validateTokenId(uint256 tokenId) view returns (bool)',
  'function getCollateral() view returns (address)',

  // 事件（用于 Interface.parseLog）
  'event OrderFilled(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint256 makerAssetId, uint256 takerAssetId, uint256 makerAmountFilled, uint256 takerAmountFilled, uint256 fee)',
  'event OrdersMatched(bytes32 indexed takerOrderHash, address indexed takerOrderMaker, uint256 makerAssetId, uint256 takerAssetId, uint256 makerAmountFilled, uint256 takerAmountFilled)',
  'event TokenRegistered(uint256 token0, uint256 token1, bytes32 conditionId)',
];
```

## ConditionalTokens 合约 ABI（decoder 需要的部分）

```javascript
const CTF_ABI = [
  // 只读函数
  'function getConditionId(address oracle, bytes32 questionId, uint256 outcomeSlotCount) pure returns (bytes32)',
  'function getCollectionId(bytes32 parentCollectionId, bytes32 conditionId, uint256 indexSet) view returns (bytes32)',
  'function getPositionId(address collateralToken, bytes32 collectionId) pure returns (uint256)',
  'function balanceOf(address owner, uint256 id) view returns (uint256)',
  'function payoutDenominator(bytes32 conditionId) view returns (uint256)',

  // 写函数（demo 不需要调用，但了解签名有助于理解日志）
  'function prepareCondition(bytes32 questionId, uint256 outcomeSlotCount)',
  'function splitPosition(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)',
  'function mergePositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)',
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)',
  'function reportPayouts(bytes32 questionId, uint256[] payouts)',

  // 事件
  'event ConditionPreparation(bytes32 indexed conditionId, address indexed oracle, bytes32 indexed questionId, uint256 outcomeSlotCount)',
  'event PositionSplit(address indexed stakeholder, address collateralToken, bytes32 indexed parentCollectionId, bytes32 indexed conditionId, uint256[] partition, uint256 amount)',
  'event PositionsMerge(address indexed stakeholder, address collateralToken, bytes32 indexed parentCollectionId, bytes32 indexed conditionId, uint256[] partition, uint256 amount)',
  'event ConditionResolution(bytes32 indexed conditionId, address indexed oracle, bytes32 indexed questionId, uint256 outcomeSlotCount, uint256[] payoutNumerators)',
  'event PayoutRedemption(address indexed redeemer, address collateralToken, bytes32 indexed parentCollectionId, bytes32 indexed conditionId, uint256[] indexSets, uint256 payout)',
];
```

---

## 合约路由逻辑

Predict.fun 的市场根据 `isNegRisk` 和 `isYieldBearing` 两个维度分成四种类型，每种对应不同的合约集：

```text
                    isYieldBearing = false          isYieldBearing = true
                    ─────────────────────           ──────────────────────
isNegRisk = false   CTF_EXCHANGE                    YIELD_BEARING_CTF_EXCHANGE
                    CONDITIONAL_TOKENS              YIELD_BEARING_CONDITIONAL_TOKENS
                    USDT                            USDT (经 Venus 包装)

isNegRisk = true    NEG_RISK_CTF_EXCHANGE           YIELD_BEARING_NEG_RISK_CTF_EXCHANGE
                    NEG_RISK_ADAPTER                YIELD_BEARING_NEG_RISK_ADAPTER
                    NEG_RISK_CONDITIONAL_TOKENS      YIELD_BEARING_NEG_RISK_CONDITIONAL_TOKENS
                    USDT                            USDT (经 Venus 包装)
```

**v0 只处理左上角象限**：`isNegRisk = false && isYieldBearing = false`。

### JS 路由实现建议

```javascript
function getContracts(market, chainId) {
  const addrs = ADDRESSES[chainId];

  if (market.isYieldBearing) {
    if (market.isNegRisk) {
      return {
        exchange: addrs.YIELD_BEARING_NEG_RISK_CTF_EXCHANGE,
        ctf: addrs.YIELD_BEARING_NEG_RISK_CONDITIONAL_TOKENS,
        adapter: addrs.YIELD_BEARING_NEG_RISK_ADAPTER,
      };
    }
    return {
      exchange: addrs.YIELD_BEARING_CTF_EXCHANGE,
      ctf: addrs.YIELD_BEARING_CONDITIONAL_TOKENS,
    };
  }

  if (market.isNegRisk) {
    return {
      exchange: addrs.NEG_RISK_CTF_EXCHANGE,
      ctf: addrs.NEG_RISK_CONDITIONAL_TOKENS,
      adapter: addrs.NEG_RISK_ADAPTER,
    };
  }

  // v0 默认路径
  return {
    exchange: addrs.CTF_EXCHANGE,
    ctf: addrs.CONDITIONAL_TOKENS,
  };
}
```

---

## 核心概念

### Market（市场）

在 Predict.fun 中，`market` 是应用层主对象。API 的 `GET /v1/markets/{id}` 会给出：

- `id`
- `conditionId`
- `oracleQuestionId`
- `resolverAddress`
- `isNegRisk`
- `isYieldBearing`
- `outcomes[]`
- `status` / `tradingStatus`
- `feeRateBps`
- `decimalPrecision`
- `marketVariant`
- `polymarketConditionIds[]`
- 描述、标题、类目等展示字段

对 decoder 来说，最重要的不是标题文案，而是这几个字段的组合关系：

- `market.id`：应用层主键
- `conditionId`：链上该市场条件的主键
- `oracleQuestionId`：链上问题标识
- `resolverAddress`：参与条件身份计算的地址
- `outcomes[].onChainId`：每个结果在链上的 ERC-1155 `tokenId`
- `feeRateBps`：手续费率（基点），必须从 API 动态获取，不能硬编码
- `decimalPrecision`：价格小数位（通常 2，但可能是 3）
- `polymarketConditionIds`：Polymarket 对应的 conditionId（交叉参考用）

### Condition（条件）

常规市场下，Predict.fun 仍然遵循 Conditional Tokens Framework 的核心身份模型：

```text
conditionId = keccak256(oracle, questionId, outcomeSlotCount)
```

对于常规二元市场，`outcomeSlotCount = 2`。

实现时可以用链上函数直接校验：

```text
ConditionalTokens.getConditionId(oracle, questionId, 2)
```

#### 一个重要细节

当前 Predict.fun 的 `ConditionalTokens` 合约上，`prepareCondition` 的函数签名是：

```text
prepareCondition(bytes32 questionId, uint256 outcomeSlotCount)
```

也就是说，**prepareCondition 的外部调用参数里没有显式 oracle**。但 `conditionId` 的身份计算函数 `getConditionId` 仍然需要 `oracle`。这意味着：

- 不能假设"只靠 prepareCondition 的输入参数"就能还原完整 condition 身份。
- decoder 应优先使用：
  - `market.resolverAddress`
  - `market.oracleQuestionId`
  - `ConditionalTokens.getConditionId(...)`
  - 或者市场 API 本身给出的 `conditionId`

### Collection 与 TokenId（头寸）

常规市场下，YES/NO tokenId 的推导方式仍然是 CTF 标准路径：

```text
collectionId = getCollectionId(parentCollectionId, conditionId, indexSet)
tokenId = getPositionId(collateralToken, collectionId)
```

对独立二元市场：

- `parentCollectionId = bytes32(0)`
- `YES / 第一个 outcome` 对应 `indexSet = 1`
- `NO / 第二个 outcome` 对应 `indexSet = 2`

因此常规市场下：

```text
yesCollectionId = getCollectionId(0x0, conditionId, 1)
noCollectionId  = getCollectionId(0x0, conditionId, 2)
yesTokenId      = getPositionId(USDT, yesCollectionId)
noTokenId       = getPositionId(USDT, noCollectionId)
```

### Outcome / onChainId

API `market.outcomes[]` 中每个 outcome 都会带一个 `onChainId`。这个 `onChainId` 就是 decoder 最终要对齐到的 `tokenId`。

这也是 `market_decoder` 的核心任务之一：

- 输入一个 `marketId`
- 输出该 market 的 outcome 名称和 `tokenId`
- 再反向验证：
  - `exchange.getConditionId(tokenId) == market.conditionId`
  - `exchange.getComplement(tokenId)` 是否等于另一侧 outcome 的 `tokenId`

### Order / Match / Position

Predict.fun 的交易信息分成三层：

- **订单层**：SDK 中的订单对象，包含 `side`、`price`、`amount` 等。
- **撮合层**：API `GET /v1/orders/matches` 返回的聚合成交结果。
- **链上执行层**：`OrderFilled`、`OrdersMatched`、`PositionSplit`、`PositionsMerge` 等链上日志。

此外还有：

- **持仓层**：`GET /v1/positions/{address}` 返回地址在某市场的 outcome 持仓。

decoder 不能只盯其中一层。真正可用的实现，必须把：

- API 里的 `market` / `orders/matches`
- receipt 里的 `OrderFilled` / `OrdersMatched`
- 链上的 `getConditionId(tokenId)` / `getComplement(tokenId)`

串成一条证据链。

---

## API 接口规范与实测 Schema

### API 环境

| 环境 | Base URL | 认证 |
|------|----------|------|
| **BNB Mainnet** | `https://api.predict.fun/` | 必需 (`x-api-key` header) |
| **BNB Testnet** | `https://api-testnet.predict.fun/` | 不需要 |
| **WebSocket** | `wss://ws.predict.fun/ws` | 可选 |
| **Swagger UI** | `https://api.predict.fun/docs` | - |
| **开发者文档** | `https://dev.predict.fun/` | - |

速率限制：240 请求/分钟（主网和测试网均适用）。

### GET /v1/markets/{id} —— 实测响应 Schema

以下 schema 来自 `GET https://api-testnet.predict.fun/v1/markets/72829` 的真实响应（2026-03-26 验证）：

```json
{
  "success": true,
  "data": {
    "id": 72829,
    "title": "First Blood in Game 1?",
    "question": "First Blood in Game 1?",
    "description": "...(规则说明文本)...",
    "imageUrl": "https://static.predict.fail/default-market",
    "categorySlug": "lol-c9-red-2026-03-05",
    "status": "REGISTERED",
    "tradingStatus": "OPEN",
    "resolution": null,
    "isVisible": true,
    "isNegRisk": false,
    "isYieldBearing": false,
    "isBoosted": false,
    "feeRateBps": 200,
    "decimalPrecision": 2,
    "marketVariant": "DEFAULT",
    "variantData": null,
    "spreadThreshold": 0.06,
    "shareThreshold": 100,
    "conditionId": "0xfcdc4b74aa8179cbb51c69ba1a094cfebf99b784510321bdd80c67b93443dc0c",
    "oracleQuestionId": "0x7ce661b0ea0062a722a9fad9833ae275861307926fbf5eff5d282389079c6929",
    "resolverAddress": "0x8403922ad0c5d39B4148e17C86095cAf10B37E50",
    "questionIndex": null,
    "outcomes": [
      {
        "indexSet": 1,
        "name": "Cloud9",
        "onChainId": "12723470295927997005591429032016946047344374045078339206225302506313975527799",
        "status": null
      },
      {
        "indexSet": 2,
        "name": "RED Canids",
        "onChainId": "66100295494026117689691193272997657936075615289731125308266914975031974519236",
        "status": null
      }
    ],
    "polymarketConditionIds": [
      "0x6b25ca8c842525f8122f09d95a39760a7f92a79df009b6bc4269c7142d97dde7"
    ],
    "kalshiMarketTicker": null,
    "createdAt": "2026-03-05T20:25:48.420Z",
    "boostStartsAt": null,
    "boostEndsAt": null
  }
}
```

**关键字段说明**：

- `status` 枚举：`REGISTERED | PRICE_PROPOSED | PRICE_DISPUTED | PAUSED | UNPAUSED | RESOLVED | REMOVED`
- `tradingStatus` 枚举：`OPEN | MATCHING_NOT_ENABLED | CANCEL_ONLY | CLOSED`
- `outcomes[].status`：结算前为 `null`
- `questionIndex`：NegRisk 多问题场景使用，常规市场为 `null`
- `polymarketConditionIds`：某些市场与 Polymarket 有交叉对应关系

### GET /v1/orders/matches —— 实测响应 Schema

以下来自 `GET https://api-testnet.predict.fun/v1/orders/matches?marketId=72829&first=2` 的真实响应：

```json
{
  "success": true,
  "cursor": "eyJjcmVhdGVkQXQiOi4uLn0=",
  "data": [
    {
      "transactionHash": "0x2b06856b775b0918c0c865955dc9a6c8e62f4e03251bd759e70e71482a3614dc",
      "executedAt": "2026-03-23T22:45:22.000Z",
      "amountFilled": "778500000000000000",
      "priceExecuted": "420000000000000000",
      "market": {
        "id": 72829,
        "conditionId": "0xfcdc4b74aa8179cbb51c69ba1a094cfebf99b784510321bdd80c67b93443dc0c",
        "isNegRisk": false,
        "isYieldBearing": false,
        "feeRateBps": 200,
        "decimalPrecision": 2,
        "outcomes": [
          { "indexSet": 1, "name": "Cloud9", "onChainId": "12723...", "status": null },
          { "indexSet": 2, "name": "RED Canids", "onChainId": "66100...", "status": null }
        ]
      },
      "taker": {
        "quoteType": "Bid",
        "amount": "778500000000000000",
        "price": "420000000000000000",
        "outcome": { "indexSet": 1, "name": "Cloud9", "onChainId": "12723...", "status": null },
        "signer": "0x1c557c50aa572E83F88d1F09D49A725DF1f5f9Ed",
        "fee": { "amount": "15570000000000000", "type": "SHARES" }
      },
      "makers": [
        {
          "quoteType": "Bid",
          "amount": "778500000000000000",
          "price": "580000000000000000",
          "outcome": { "indexSet": 2, "name": "RED Canids", "onChainId": "66100...", "status": null },
          "signer": "0x0CAf655451fd526C5C4Cf6E389aAc3FF4f64094F",
          "fee": { "amount": "0", "type": "SHARES" }
        }
      ]
    }
  ]
}
```

**关键字段说明**：

- `amountFilled`：`1e18` 整数字符串，表示 shares 数量（`778500000000000000` = `0.7785` shares）
- `priceExecuted`：`1e18` 整数字符串（`420000000000000000` = `0.42`）——**不是人类可读浮点**
- `taker.price` / `makers[].price`：同样是 `1e18` 整数字符串
- `fee.type`：`"SHARES"` 或 `"COLLATERAL"`——这是链上 `OrderFilled.fee` 缺失的关键元数据
- `fee.amount`：`1e18` 整数字符串
- `taker.outcome` 和 `makers[].outcome`：标明各方买入的是哪个 outcome
- `makers` 是数组：一笔 taker 可能匹配多个 maker

### GET /v1/positions/{address} —— 实测响应 Schema

以下来自 `GET https://api-testnet.predict.fun/v1/positions/0x1c557c50aa572E83F88d1F09D49A725DF1f5f9Ed?first=20` 的真实响应：

```json
{
  "success": true,
  "cursor": "eyJtYXJrZXRJZCI6Li4ufQ==",
  "data": [
    {
      "id": "eyJtYXJrZXRJZCI6NzI4MjksIm91dGNvbWVJZCI6MTQ0NzcyLCJzb3J0Q3Vyc29yIjoiOTc0ODAxNTkifQ==",
      "market": {
        "id": 72829,
        "conditionId": "0xfcdc4b74aa8179cbb51c69ba1a094cfebf99b784510321bdd80c67b93443dc0c",
        "isNegRisk": false,
        "isYieldBearing": false,
        "outcomes": [
          { "indexSet": 1, "name": "Cloud9", "onChainId": "12723...", "status": null },
          { "indexSet": 2, "name": "RED Canids", "onChainId": "66100...", "status": null }
        ]
      },
      "outcome": {
        "indexSet": 1,
        "name": "Cloud9",
        "onChainId": "12723470295927997005591429032016946047344374045078339206225302506313975527799",
        "status": null
      },
      "amount": "9057181090909090910",
      "averageBuyPriceUsd": "0.4498",
      "pnlUsd": "-1.81",
      "valueUsd": "2.26"
    }
  ]
}
```

**关键字段说明**：

- `amount`：`1e18` 整数字符串，表示当前持有的 outcome token 数量
- `averageBuyPriceUsd`：人类可读浮点，表示平均买入价
- `pnlUsd`：人类可读浮点，盈亏
- `valueUsd`：人类可读浮点，当前价值
- `outcome.onChainId`：与 `market.outcomes[].onChainId` 一致

### GET /v1/markets/{id}/orderbook —— 实测响应 Schema

以下来自 `GET https://api-testnet.predict.fun/v1/markets/72829/orderbook` 的真实响应：

```json
{
  "success": true,
  "data": {
    "marketId": 72829,
    "updateTimestampMs": 1774489309742,
    "lastOrderSettled": {
      "id": "300758",
      "kind": "LIMIT",
      "marketId": 72829,
      "outcome": "Yes",
      "price": "0.97",
      "side": "Bid"
    },
    "asks": [
      [0.42, 5.1785],
      [0.55, 18.0892],
      [0.57, 21.907]
    ],
    "bids": [
      [0.25, 21.2392],
      [0.19, 77.09],
      [0.12, 80.347]
    ]
  }
}
```

**关键字段说明**：

- `asks` / `bids` 格式：`[[price, size], ...]`——**都是人类可读浮点数**
- 订单簿基于 **Yes 结果**存储价格
- No 侧价格需要互补计算：

```javascript
const getComplement = (price, decimalPrecision = 2) => {
  const factor = 10 ** decimalPrecision;
  return (factor - Math.round(price * factor)) / factor;
};
// getComplement(0.42) => 0.58
```

- `lastOrderSettled.price` 也是人类可读字符串（`"0.97"`）

### 全部可用 API 端点清单

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/v1/markets` | 市场列表 | 测试网免认证 |
| GET | `/v1/markets/{id}` | 市场详情 | 测试网免认证 |
| GET | `/v1/markets/{id}/orderbook` | 订单簿快照 | 测试网免认证 |
| GET | `/v1/markets/{id}/stats` | 市场统计 | 测试网免认证 |
| GET | `/v1/markets/{id}/last-sale` | 最后成交 | 测试网免认证 |
| GET | `/v1/orders/matches` | 撮合事件 | 测试网免认证 |
| GET | `/v1/positions/{address}` | 地址持仓 | 测试网免认证 |
| GET | `/v1/categories` | 分类列表 | 测试网免认证 |
| GET | `/v1/search` | 全文搜索 | 测试网免认证 |
| POST | `/v1/orders` | 创建订单 | 需要 JWT |
| DELETE | `/v1/orders` | 取消订单 | 需要 JWT |
| GET | `/v1/orders` | 用户订单 | 需要 JWT |
| GET | `/v1/accounts` | 账户信息 | 需要 JWT |

---

## 市场生命周期与证据链

### 1. 市场登记

链上和应用层会留下多种痕迹：

- `ConditionalTokens` 侧的 `ConditionPreparation`
- Exchange 侧的 `TokenRegistered(token0, token1, conditionId)`
- API 的 `GET /v1/markets/{id}`

对 v0 来说，不要求你从"创建交易"开始完整追历史。更务实的做法是：

- 以 API 的 `marketId -> conditionId -> outcomes[].onChainId` 作为入口
- 再用链上函数和日志验证它没有漂移

### 2. 交易撮合

成交发生时，至少要关注三类信息：

- `OrderFilled`
- `OrdersMatched`
- `PositionSplit` / `PositionsMerge`

其中：

- `OrderFilled` 给出每条成交腿的核心数量信息
- `OrdersMatched` 给出一次撮合的聚合匹配痕迹
- `PositionSplit` / `PositionsMerge` 说明这次撮合是否伴随着"拆分铸造"或"合并赎回"

这点很重要，因为 Predict.fun 的真实成交，不一定是"某人把现成 token 卖给另一人"。当 YES 买单和 NO 买单可以互补时，链上更可能表现为：

- 双方 USDT 进入系统
- `PositionSplit` 被触发
- 铸造出一对互补 outcome token
- 再分别分配给不同订单参与者

因此单看一个 `OrderFilled`，有时只能看到"这一条腿成交了"，看不到完整经济事件。

### 3. 结算

结算侧会涉及：

- `ConditionResolution`
- `OutcomeReported`
- `PayoutRedemption`

但 v0 的 decoder 不把"完整结算流水"纳入必须项，只要求：

- 识别市场基础参数
- 识别成交腿
- 能通过 positions / market / match event 交叉验证

---

## 任务 A：交易日志解码（trade_decoder）

### 目标

输入一笔 Predict.fun 真实成交的 `txHash` 或 raw receipt/logs，输出该 tx 内的成交腿结构，而不是只吐一个模糊的"trade 对象"。

这样设计的原因是：一笔 Predict.fun 成交在链上可能包含多条 `OrderFilled`，它们可能分别代表：

- maker 订单腿
- taker 聚合腿
- 互补 outcome 的另一条腿

如果一上来就假设"一笔 tx = 一条 fill"，很容易在真实样例上崩掉。

### 输入

- `txHash`
- 或 `receipt`
- 或已经筛出的 `logs[]`

### 推荐输出结构

```json
{
  "txHash": "0x...",
  "chainId": 97,
  "receiptTo": "0x...",
  "exchangeLogsFound": true,
  "fills": [
    {
      "logIndex": 40,
      "exchange": "0x2A6413639BD3d73a20ed8C95F634Ce198ABbd2d7",
      "orderHash": "0x...",
      "maker": "0x...",
      "taker": "0x...",
      "makerAssetId": "0",
      "takerAssetId": "6610...",
      "makerAmountFilled": "451530000000000000",
      "takerAmountFilled": "778500000000000000",
      "fee": "11274827586206896",
      "tokenId": "6610...",
      "conditionId": "0xfcdc4b74aa8179cbb51c69ba1a094cfebf99b784510321bdd80c67b93443dc0c",
      "complementTokenId": "1272...",
      "side": "BUY",
      "collateralAmount": "0.45153",
      "shareAmount": "0.7785",
      "price": "0.58",
      "roleHint": "maker_leg"
    }
  ],
  "matchedEvents": [
    {
      "logIndex": 44,
      "takerOrderHash": "0x...",
      "takerOrderMaker": "0x...",
      "makerAssetId": "0",
      "takerAssetId": "1272...",
      "makerAmountFilled": "326970000000000000",
      "takerAmountFilled": "778500000000000000"
    }
  ],
  "ctfEvents": [
    {
      "event": "PositionSplit",
      "logIndex": 38,
      "conditionId": "0xfcdc...",
      "amount": "778500000000000000"
    }
  ],
  "matchType": "MINT",
  "notes": [
    "receipt.to 不是 exchange，按 log.address 识别"
  ]
}
```

### 为什么输出要以 `fills[]` 为中心

因为 Predict.fun 的一笔真实撮合，可能在链上拆成多条成交腿。v0 最稳妥的输出口径是：

- 先完整保留所有 `OrderFilled`
- 再在上一层做 `matchType` 和"聚合成交"的推断

而不是在最底层 decoder 就强行压平成单条 trade。

### 解码步骤

#### 1. 先取 receipt，不要先看 `tx.to`

第一个坑就是：**Predict.fun 成交 tx 的 `receipt.to` 可能不是 exchange 本体。**

测试网真实样例里：

- 交易哈希：`0x2b06856b775b0918c0c865955dc9a6c8e62f4e03251bd759e70e71482a3614dc`
- `receipt.to`：`0xD479C5c6A3B98C6db8503cb6530519Bb19249CC2`（可能是 Kernel 智能账户入口或 Operator 合约）
- 但真正发出 `OrderFilled` / `OrdersMatched` 的地址是：
  `0x2A6413639BD3d73a20ed8C95F634Ce198ABbd2d7`（CTF_EXCHANGE）

所以 trade decoder 的筛选规则必须是：

- 按 `log.address` 过滤已知 exchange 地址（所有四种变体都要涵盖）
- 不要按 `receipt.to == exchange` 做判断

```javascript
const KNOWN_EXCHANGES = new Set([
  addrs.CTF_EXCHANGE.toLowerCase(),
  addrs.NEG_RISK_CTF_EXCHANGE.toLowerCase(),
  addrs.YIELD_BEARING_CTF_EXCHANGE?.toLowerCase(),
  addrs.YIELD_BEARING_NEG_RISK_CTF_EXCHANGE?.toLowerCase(),
].filter(Boolean));

const exchangeLogs = receipt.logs.filter(
  log => KNOWN_EXCHANGES.has(log.address.toLowerCase())
);
```

#### 2. 识别 `OrderFilled`

按 `topic[0] == TOPICS.OrderFilled` 过滤，然后解码：

常规解码逻辑：

- `makerAssetId == 0n`
  - 说明 maker 付出的是抵押品（USDT）
  - 该腿可以视为 **BUY**
  - `tokenId = takerAssetId`
  - `collateral = makerAmountFilled`
  - `shares = takerAmountFilled`
- `takerAssetId == 0n`
  - 说明 maker 付出的是 outcome token
  - 该腿可以视为 **SELL**
  - `tokenId = makerAssetId`
  - `shares = makerAmountFilled`
  - `collateral = takerAmountFilled`

价格统一定义为：

```text
price = collateralAmount / shareAmount
```

### 数量归一化

这里必须统一使用 `1e18`：

- USDT：18 位
- outcome token 数量：在 API 和链上样例里也按 18 位口径表达

因此：

```javascript
// 用 BigInt 精确计算，避免浮点误差
const DECIMALS = 18n;
const UNIT = 10n ** DECIMALS;

function normalize(raw) {
  // raw 是 BigInt
  const integer = raw / UNIT;
  const fraction = raw % UNIT;
  return `${integer}.${fraction.toString().padStart(Number(DECIMALS), '0')}`;
}

// 价格计算建议用字符串或 Decimal 库
function calcPrice(collateralRaw, sharesRaw) {
  // 返回人类可读小数，保留足够精度
  return Number(collateralRaw) / Number(sharesRaw);
}
```

### 3. 反查 `conditionId`

从 fill 得到 `tokenId` 后，使用 exchange 侧的只读函数：

```javascript
const exchange = new Contract(exchangeAddr, EXCHANGE_ABI, provider);

const conditionId = await exchange.getConditionId(tokenId);
const complement  = await exchange.getComplement(tokenId);
// validateTokenId 在某些部署上可能不可用，可 try-catch
```

这样可以得到：

- 当前 token 所属 `conditionId`
- 互补 outcome 的 `tokenId`

### 4. 不要用"过滤 taker == exchange"做默认去重

这是实现时最容易照搬旧经验、但在 Predict.fun 上踩坑的地方。

很多人会把 `taker == exchange` 的 `OrderFilled` 当成"汇总腿"直接丢掉。但在 Predict.fun 的真实互补撮合里，这条日志**可能正好承载了 taker 侧 outcome 的成交信息**，丢掉以后你会损失一半交易语义。

更稳妥的处理方式是：

- 底层 decoder：保留所有 `OrderFilled`，命名为 `raw fills`
- 上层归一化：再按 `OrdersMatched`、互补 token、`PositionSplit` / `PositionsMerge` 去归并

换句话说：

- **不要在日志层去重**
- **要在语义层聚合**

### 5. 用 `OrdersMatched` 和 CTF 日志判断撮合类型

常见的语义归类可以先做这三种：

- `DIRECT`
  - 只看到单侧 outcome token 交换，没有明显的 `PositionSplit` / `PositionsMerge`
- `MINT`
  - 看到了互补 token 的 BUY 腿
  - 且同 tx 中存在 `PositionSplit`
- `MERGE`
  - 看到了互补 token 的 SELL 腿
  - 且同 tx 中存在 `PositionsMerge`

这是 v0 足够实用的归类，不需要一开始就做到全协议完美覆盖。

### 6. fee 的处理方式

`OrderFilled` 中的 `fee` 字段要先按 **raw value 原样保留**，不要先验地认为它一定是 USDT。

根据 API 实测数据确认：

- API `orders/matches` 里的 fee 明确带有 `type` 字段
- 实测到的两种类型：`"SHARES"` 和 `"COLLATERAL"`
- 链上 `OrderFilled.fee` 只有一个 `uint256`，没有 fee type 字段

实测样例中的 fee 对应关系：

| 来源 | fee amount | fee type |
|------|-----------|----------|
| API taker | `15570000000000000` | `SHARES` |
| API maker | `0` | `SHARES` |
| 链上 fill A (NO BUY) | `11274827586206896` | 未知（需要 API 补充） |
| 链上 fill B (YES BUY) | `15570000000000000` | 未知（需要 API 补充） |

因此 v0 建议：

- 底层输出 `feeRaw`：链上原始值
- 如果同时有 API `orders/matches` 可关联，再补 `feeType`

### 真实样例：测试网市场 `72829`

这个样例是 v0 的推荐主样例，因为它满足：

- `isNegRisk = false`
- `isYieldBearing = false`
- API 可公开访问
- 可以链上重建 condition 与 tokenId

#### 样例市场

- `marketId`: `72829`
- `question`: `First Blood in Game 1?`
- `conditionId`: `0xfcdc4b74aa8179cbb51c69ba1a094cfebf99b784510321bdd80c67b93443dc0c`
- `oracleQuestionId`: `0x7ce661b0ea0062a722a9fad9833ae275861307926fbf5eff5d282389079c6929`
- `resolverAddress`: `0x8403922ad0c5d39B4148e17C86095cAf10B37E50`
- `yes tokenId (Cloud9)`:
  `12723470295927997005591429032016946047344374045078339206225302506313975527799`
- `no tokenId (RED Canids)`:
  `66100295494026117689691193272997657936075615289731125308266914975031974519236`

#### 样例成交

- `txHash`: `0x2b06856b775b0918c0c865955dc9a6c8e62f4e03251bd759e70e71482a3614dc`

对应 API `GET /v1/orders/matches?marketId=72829&first=2` 中的第一条记录：

- `amountFilled = 778500000000000000`，即 `0.7785` shares
- maker outcome：`RED Canids`，价格 `580000000000000000`（= `0.58`）
- taker outcome：`Cloud9`，价格 `420000000000000000`（= `0.42`）
- `priceExecuted = 420000000000000000`（= `0.42`）

链上 receipt 中可以解出两条关键腿：

#### fill A：NO 侧 BUY 腿

- `makerAssetId = 0`
- `takerAssetId = 66100295494026117689691193272997657936075615289731125308266914975031974519236`
- `makerAmountFilled = 451530000000000000`
- `takerAmountFilled = 778500000000000000`
- `fee = 11274827586206896`
- 归一化后：
  - `collateral = 0.45153`
  - `shares = 0.7785`
  - `price = 0.58`

#### fill B：YES 侧 BUY 腿

- `makerAssetId = 0`
- `takerAssetId = 12723470295927997005591429032016946047344374045078339206225302506313975527799`
- `makerAmountFilled = 326970000000000000`
- `takerAmountFilled = 778500000000000000`
- `fee = 15570000000000000`
- 归一化后：
  - `collateral = 0.32697`
  - `shares = 0.7785`
  - `price = 0.42`

**价格互补验证**：`0.58 + 0.42 = 1.00`。这是互补撮合的典型特征——两个互补 outcome 的价格之和等于 1。

同一 tx 中还能看到：

- `PositionSplit`
- `OrdersMatched`

这说明这不是一个简单的"现货 token 对倒"，而是一个**互补 outcome 被一起铸造并分发**的撮合事件，因此 `matchType` 可以标成 `MINT`。

---

## 任务 B：市场参数解码（market_decoder）

### 目标

给定 market 上下文，输出对 decoder 有意义的"链上参数视图"，而不是只返回原始 API JSON。

### 推荐输入优先级

建议把 `market_decoder` 的入口按下面顺序设计：

1. `marketId`
2. `tokenId`
3. `conditionId + 补充上下文`

原因很简单：

- `marketId` 最容易从 API 直接拿到完整上下文
- `tokenId` 可以直接走 exchange 查询
- 只有 `conditionId` 时，特别是 NegRisk 场景，信息不一定足够完整

### 推荐输出结构

```json
{
  "marketId": 72829,
  "chainId": 97,
  "conditionId": "0xfcdc4b74aa8179cbb51c69ba1a094cfebf99b784510321bdd80c67b93443dc0c",
  "oracleQuestionId": "0x7ce661b0ea0062a722a9fad9833ae275861307926fbf5eff5d282389079c6929",
  "resolverAddress": "0x8403922ad0c5d39B4148e17C86095cAf10B37E50",
  "collateralToken": "0xB32171ecD878607FFc4F8FC0bCcE6852BB3149E0",
  "ctf": "0x2827AAef52D71910E8FBad2FfeBC1B6C2DA37743",
  "exchange": "0x2A6413639BD3d73a20ed8C95F634Ce198ABbd2d7",
  "isNegRisk": false,
  "isYieldBearing": false,
  "feeRateBps": 200,
  "decimalPrecision": 2,
  "outcomeSlotCount": 2,
  "outcomes": [
    {
      "indexSet": 1,
      "name": "Cloud9",
      "tokenId": "12723470295927997005591429032016946047344374045078339206225302506313975527799"
    },
    {
      "indexSet": 2,
      "name": "RED Canids",
      "tokenId": "66100295494026117689691193272997657936075615289731125308266914975031974519236"
    }
  ],
  "derivation": {
    "conditionIdRecomputed": true,
    "tokenIdsRecomputed": true,
    "exchangeConditionCheck": true,
    "exchangeComplementCheck": true
  }
}
```

### 解码路径 A：输入 `marketId`

这是 v0 的主路径。

#### 第一步：读 API

调用：

```text
GET /v1/markets/{marketId}
```

关注字段：

- `conditionId`
- `oracleQuestionId`
- `resolverAddress`
- `isNegRisk`
- `isYieldBearing`
- `feeRateBps`
- `decimalPrecision`
- `outcomes[].indexSet`
- `outcomes[].onChainId`

#### 第二步：选择正确的 exchange / ctf / collateral

根据合约路由逻辑选择。常规非 NegRisk、非 YieldBearing 市场：

- exchange: `CTF_EXCHANGE`
- ctf: `CONDITIONAL_TOKENS`
- collateral: `USDT`

#### 第三步：常规市场下重建 `conditionId`

对于 `isNegRisk = false` 的市场，使用：

```javascript
const ctf = new Contract(ctfAddr, CTF_ABI, provider);
const recomputed = await ctf.getConditionId(
  resolverAddress,
  oracleQuestionId,
  2   // outcomeSlotCount
);
assert(recomputed === market.conditionId);
```

#### 第四步：重建 tokenIds

常规市场使用：

```javascript
const yesCollectionId = await ctf.getCollectionId(
  '0x' + '0'.repeat(64),  // parentCollectionId = bytes32(0)
  conditionId,
  1   // indexSet for YES
);
const noCollectionId = await ctf.getCollectionId(
  '0x' + '0'.repeat(64),
  conditionId,
  2   // indexSet for NO
);

const yesTokenId = await ctf.getPositionId(usdtAddress, yesCollectionId);
const noTokenId  = await ctf.getPositionId(usdtAddress, noCollectionId);
```

应满足：

- `yesTokenId == outcomes[indexSet=1].onChainId`
- `noTokenId == outcomes[indexSet=2].onChainId`

#### 第五步：用 exchange 再做一层反查

对每个 outcome tokenId：

```javascript
const exchange = new Contract(exchangeAddr, EXCHANGE_ABI, provider);

// 验证 conditionId
assert(await exchange.getConditionId(yesTokenId) === conditionId);
assert(await exchange.getConditionId(noTokenId) === conditionId);

// 验证互补关系
assert(await exchange.getComplement(yesTokenId) === noTokenId);
assert(await exchange.getComplement(noTokenId) === yesTokenId);
```

这样 `market_decoder` 就不只是"相信 API"，而是把 API 和链上真正绑起来了。

### 解码路径 B：输入 `tokenId`

如果用户只有 `tokenId`，先走 exchange 侧：

```javascript
const conditionId = await exchange.getConditionId(tokenId);
const complement  = await exchange.getComplement(tokenId);
```

拿到 `conditionId` 后，再回到 API 查 market。实现上可以选择：

- 通过已有市场索引缓存做反查
- 或 API 支持时按 `conditionId` 过滤

v0 不强求"全局 market 搜索器"，但至少要把这个路径写成可扩展接口。

### 解码路径 C：输入 `conditionId`

这是最不稳的一条路径，因为：

- 对常规市场来说，可以在知道 `resolverAddress + oracleQuestionId` 的前提下反推 tokenIds
- 对 NegRisk 市场来说，不应默认用这套规则

因此 v0 建议：

- 如果仅有 `conditionId`，优先要求附带 `market` 上下文
- 如果没有上文，只做"部分解码"

---

## NegRisk：要单独看待

Predict.fun 的 NegRisk 不是"常规市场 + 一个标记位"这么简单。它在 decoder 里至少带来两个关键差异。

### 差异 1：`conditionId` 不应默认按常规公式重建

在测试网 NegRisk 样例市场 `393` 上，实测发现：

- API 给出的 `conditionId`
- 并不能稳定通过 `getConditionId(resolverAddress, oracleQuestionId, 2)` 重建出来

这意味着：

- 对 NegRisk 市场，不要把 `resolverAddress + oracleQuestionId + 2` 当作 `conditionId` 的权威来源
- 权威来源应优先使用：
  - `market.conditionId`
  - `exchange.getConditionId(tokenId)`
  - `TokenRegistered`

### 差异 2：tokenId 计算时可能用 WrappedCollateral，而不是裸 USDT

对于测试网 NegRisk 样例，实测得到：

- `NEG_RISK_CTF_EXCHANGE.getCollateral()` 返回的仍是 USDT
- 但要用 `ConditionalTokens.getPositionId(...)` 重建出 API 中的 `outcomes[].onChainId`，底层使用的却是 **WrappedCollateral**，而不是裸 USDT

这说明：

- "交易使用的 collateral"
- 和 "CTF tokenId 身份计算时使用的 collateral 地址"

在 NegRisk 场景里可能不是同一个地址。

因此 v0 的策略应该是：

- **先不把 NegRisk 纳入主闭环**
- 只在文档里明确这是一条后续扩展路径

### NegRisk 的后续扩展建议

后续如果要补 NegRisk：

- 先从 API `market.isNegRisk` 分流
- 再选择 `NEG_RISK_CTF_EXCHANGE`
- `conditionId` 以 API / exchange 查询为准
- tokenId 身份计算时引入 WrappedCollateral 配置
- 必要时结合 `NEG_RISK_ADAPTER` 的 `MarketPrepared` / `QuestionPrepared` / `OutcomeReported`

---

## 任务 C：validate/demo（最小闭环）

### 目标

用一个真实测试网市场，串起：

- `market_decoder`
- `trade_decoder`
- `positions`
- `orders/matches`

只做**轻量一致性验证**，不追求历史全量对账。

### 推荐主样例

- 链：`BNB Testnet (97)`
- 市场：`72829`
- 交易：`0x2b06856b775b0918c0c865955dc9a6c8e62f4e03251bd759e70e71482a3614dc`
- 地址：`0x1c557c50aa572E83F88d1F09D49A725DF1f5f9Ed`

### Demo 步骤

#### 1. 读取市场

请求：

```text
GET https://api-testnet.predict.fun/v1/markets/72829
```

预期得到：

- `conditionId = 0xfcdc4b74aa8179cbb51c69ba1a094cfebf99b784510321bdd80c67b93443dc0c`
- `isNegRisk = false`
- `isYieldBearing = false`
- `feeRateBps = 200`
- `outcomes[0] = { indexSet: 1, name: "Cloud9", onChainId: "12723..." }`
- `outcomes[1] = { indexSet: 2, name: "RED Canids", onChainId: "66100..." }`

#### 2. 用 market_decoder 重建链上参数

验证：

- `getConditionId(resolverAddress, oracleQuestionId, 2) == market.conditionId`
- `getPositionId(USDT, getCollectionId(0, conditionId, 1)) == yesTokenId`
- `getPositionId(USDT, getCollectionId(0, conditionId, 2)) == noTokenId`
- `exchange.getConditionId(yesTokenId) == conditionId`
- `exchange.getConditionId(noTokenId) == conditionId`
- `exchange.getComplement(yesTokenId) == noTokenId`

#### 3. 读取撮合事件

请求：

```text
GET https://api-testnet.predict.fun/v1/orders/matches?marketId=72829&first=2
```

选择 `transactionHash = 0x2b06856b...14dc` 的那条记录，提取：

- `amountFilled = 778500000000000000`（= 0.7785 shares）
- `priceExecuted = 420000000000000000`（= 0.42）
- maker: RED Canids 侧，price = `580000000000000000`（= 0.58）
- taker: Cloud9 侧，price = `420000000000000000`（= 0.42）
- taker fee: `15570000000000000`（= 0.01557），type = `SHARES`

#### 4. 读取链上 receipt

用 `txHash` 取 BNB Testnet receipt（RPC: `https://data-seed-prebsc-1-s1.binance.org:8545/`），过滤出：

- `OrderFilled`（按 topic[0] 和 log.address 过滤）
- `OrdersMatched`
- `PositionSplit`

#### 5. 用 trade_decoder 解析 fills

预期至少能解出两条 outcome 腿：

- 一条 `RED Canids`，价格 `0.58`
- 一条 `Cloud9`，价格 `0.42`

并能识别：

- `matchType = MINT`
- `conditionId` 与步骤 2 的 market decoder 输出一致
- 两条腿的 `tokenId` 互为 complement

#### 6. 读取 positions 做轻量校验

请求：

```text
GET https://api-testnet.predict.fun/v1/positions/0x1c557c50aa572E83F88d1F09D49A725DF1f5f9Ed?first=20
```

这里不要求"单笔成交金额"和当前持仓余额完全相等，因为这个地址可能后续还有别的成交。但至少应验证：

- positions 中存在 `market.id = 72829`
- 对应 outcome 的 `onChainId` 与 market decoder 结果一致
- 数据口径能对上"该地址确实在这个市场持有对应 outcome"
- 实测确认该地址持有 `Cloud9` outcome，`amount = 9057181090909090910`（约 9.057 shares）

#### 7. 可选读取 orderbook

请求：

```text
GET https://api-testnet.predict.fun/v1/markets/72829/orderbook
```

这个接口主要用于验证"价格展示口径"。实测确认：

- `asks` / `bids` 使用人类可读浮点数：`[[0.42, 5.1785], ...]`
- `lastOrderSettled.price` 也是浮点字符串：`"0.97"`
- 与 `orders/matches` 的 `1e18` 整数字符串口径完全不同

---

## SDK 参考（@predictdotfun/sdk）

### 安装

```bash
npm install @predictdotfun/sdk ethers  # 需要 ethers v6 作为 peer dependency
```

### 关键常量

```javascript
// 链 ID
const ChainId = { BnbMainnet: 56, BnbTestnet: 97 };

// 交易方向（用于订单构造，不是 OrderFilled 解码）
const Side = { BUY: 0, SELL: 1 };

// 签名类型
const SignatureType = { EOA: 0, POLY_PROXY: 1, POLY_GNOSIS_SAFE: 2 };

// EIP-712 域
const PROTOCOL_NAME = "predict.fun CTF Exchange";
const PROTOCOL_VERSION = "1";
```

### EIP-712 订单结构

```javascript
const ORDER_STRUCTURE = [
  { name: "salt", type: "uint256" },
  { name: "maker", type: "address" },
  { name: "signer", type: "address" },
  { name: "taker", type: "address" },
  { name: "tokenId", type: "uint256" },
  { name: "makerAmount", type: "uint256" },
  { name: "takerAmount", type: "uint256" },
  { name: "expiration", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "feeRateBps", type: "uint256" },
  { name: "side", type: "uint8" },
  { name: "signatureType", type: "uint8" },
];
```

### SDK 导出的 ABI

SDK 从 `@predictdotfun/sdk` 直接导出以下 ABI（可直接用于 ethers.js）：

- `CTFExchangeAbi`
- `NegRiskCtfExchangeAbi`
- `NegRiskAdapterAbi`
- `ConditionalTokensAbi`
- `ERC20Abi`
- `YieldBearingConditionalTokensAbi`（Predict.fun 独有）
- `KernelAbi`（智能账户）
- `ECDSAValidatorAbi`

v0 如果不想引入完整 SDK，可以只使用上面"Exchange 合约 ABI"和"ConditionalTokens 合约 ABI"章节中的最小 ABI 片段。

---

## API 口径与归一化

### 三个口径的精确对比

| 数据来源 | 金额字段 | 价格字段 | 单位 |
|---------|---------|---------|------|
| `orders/matches` | `"778500000000000000"` | `"580000000000000000"` | `1e18` 整数字符串 |
| `positions` | `"9057181090909090910"` | `"0.4498"` (averageBuyPriceUsd) | 金额 `1e18`，价格浮点 |
| `orderbook` | `5.1785` | `0.42` | 人类可读浮点 |
| 链上 `OrderFilled` | `451530000000000000` (uint256) | 需要计算 | `1e18` 原始整数 |

### 统一归一化层建议

```javascript
// 内部表示：BigInt 保持精度
function fromWeiString(s) { return BigInt(s); }
function fromFloat(f) { return BigInt(Math.round(f * 1e18)); }
function toHuman(raw) { return Number(raw) / 1e18; }

// 价格展示
function formatPrice(raw, decimalPrecision = 2) {
  return toHuman(raw).toFixed(decimalPrecision);
}
```

### 不建议继续沿用的旧命名

旧文档或旧思路里可能会写 `/order-match-events`，但当前测试网真实可用的路径是 `/v1/orders/matches`。实现时不要把旧路径写死。

---

## 推荐实现规格

### 1. trade_decoder 最小输入输出

输入：

- `txHash`
- `chainId`

输出：

- `fills[]`
- `matchedEvents[]`
- `ctfEvents[]`
- `matchType`
- `notes[]`

### 2. market_decoder 最小输入输出

输入：

- `marketId`
- `chainId`

输出：

- `conditionId`
- `oracleQuestionId`
- `resolverAddress`
- `exchange`
- `ctf`
- `collateralToken`
- `feeRateBps`
- `decimalPrecision`
- `outcomes[].tokenId`
- `isNegRisk`
- `isYieldBearing`
- `derivation checks`

### 3. validate/demo 最小输入输出

输入：

- `marketId`
- `txHash`
- `address`

输出：

- market 参数校验结果
- trade 填单校验结果
- positions 轻量一致性结果
- API / 链上是否一致的结论

---

## 样例输出口径建议

### trade_decoder 结果

```json
{
  "txHash": "0x2b06856b775b0918c0c865955dc9a6c8e62f4e03251bd759e70e71482a3614dc",
  "chainId": 97,
  "fills": [
    {
      "outcomeName": "RED Canids",
      "tokenId": "66100295494026117689691193272997657936075615289731125308266914975031974519236",
      "side": "BUY",
      "shareAmount": "0.7785",
      "collateralAmount": "0.45153",
      "price": "0.58",
      "feeRaw": "11274827586206896"
    },
    {
      "outcomeName": "Cloud9",
      "tokenId": "12723470295927997005591429032016946047344374045078339206225302506313975527799",
      "side": "BUY",
      "shareAmount": "0.7785",
      "collateralAmount": "0.32697",
      "price": "0.42",
      "feeRaw": "15570000000000000"
    }
  ],
  "matchType": "MINT"
}
```

### market_decoder 结果

```json
{
  "marketId": 72829,
  "chainId": 97,
  "conditionId": "0xfcdc4b74aa8179cbb51c69ba1a094cfebf99b784510321bdd80c67b93443dc0c",
  "isNegRisk": false,
  "isYieldBearing": false,
  "feeRateBps": 200,
  "decimalPrecision": 2,
  "outcomes": [
    {
      "indexSet": 1,
      "name": "Cloud9",
      "tokenId": "12723470295927997005591429032016946047344374045078339206225302506313975527799"
    },
    {
      "indexSet": 2,
      "name": "RED Canids",
      "tokenId": "66100295494026117689691193272997657936075615289731125308266914975031974519236"
    }
  ],
  "checks": {
    "conditionIdRecomputed": true,
    "yesTokenMatchesApi": true,
    "noTokenMatchesApi": true,
    "exchangeComplementMatches": true
  }
}
```

---

## 数据固化（Fixtures）

在开发和测试过程中，建议将以下数据保存为 JSON 文件，方便离线测试：

### 建议目录结构

```
predict-fun/
├── fixtures/
│   ├── market_72829.json          # GET /v1/markets/72829 响应
│   ├── matches_72829.json         # GET /v1/orders/matches?marketId=72829 响应
│   ├── positions_0x1c557c50.json  # GET /v1/positions/0x1c557c50... 响应
│   ├── orderbook_72829.json       # GET /v1/markets/72829/orderbook 响应
│   └── receipt_0x2b0685.json      # eth_getTransactionReceipt 响应
├── src/
│   ├── trade_decoder.js
│   ├── market_decoder.js
│   ├── demo_validate.js
│   ├── constants.js               # 合约地址、ABI、Topic Hash
│   └── normalize.js               # 归一化工具函数
├── package.json
└── .env
```

### 保存 receipt 的注意事项

- BNB Testnet 的 receipt 中 `logs` 数组可能很长（包含 ERC-20 Transfer、ERC-1155 TransferSingle 等）
- 建议原样保存完整 receipt，不要提前过滤——离线测试时需要验证过滤逻辑本身
- `logs[].topics` 是 hex 字符串数组，`logs[].data` 是 hex 字符串

---

## 验证命令规范

完成任务后，请使用以下统一命令进行验证。所有命令均在 `predict-fun/` 目录下执行。

### 前置检查

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入：
# RPC_URL=https://data-seed-prebsc-1-s1.binance.org:8545/
# CHAIN_ID=97
# API_BASE_URL=https://api-testnet.predict.fun
```

### 任务 A：交易解码器验证

```bash
# 基础用法：解析指定交易的 OrderFilled 事件
node src/trade_decoder.js \
  --tx-hash 0x2b06856b775b0918c0c865955dc9a6c8e62f4e03251bd759e70e71482a3614dc

# 输出到文件
node src/trade_decoder.js \
  --tx-hash 0x2b06856b775b0918c0c865955dc9a6c8e62f4e03251bd759e70e71482a3614dc \
  --output ./data/trades.json
```

### 任务 B：市场解码器验证

```bash
# 通过 marketId 获取市场信息并计算 TokenId
node src/market_decoder.js --market-id 72829

# 输出到文件
node src/market_decoder.js --market-id 72829 --output ./data/market.json
```

### 综合演示

```bash
# 运行完整 demo
node src/demo_validate.js \
  --market-id 72829 \
  --tx-hash 0x2b06856b775b0918c0c865955dc9a6c8e62f4e03251bd759e70e71482a3614dc \
  --address 0x1c557c50aa572E83F88d1F09D49A725DF1f5f9Ed \
  --output ./data/demo_output.json
```

### 验证清单（必须全部通过）

- [ ] `trade_decoder` 能正确解析 `OrderFilled` 事件并输出 fills 结构
- [ ] `trade_decoder` 正确计算 `price`、`side`、`tokenId`
- [ ] `trade_decoder` 能识别 `matchType`（MINT/MERGE/DIRECT）
- [ ] `trade_decoder` 不过早丢弃 `taker == exchange` 的 `OrderFilled`
- [ ] `market_decoder` 能从 API 获取市场信息
- [ ] `market_decoder` 能通过链上函数重建 `conditionId`
- [ ] `market_decoder` 能正确计算 `yesTokenId` 和 `noTokenId`
- [ ] 计算得到的 TokenId 与 API 返回的 `outcomes[].onChainId` 一致
- [ ] `market_decoder` 能通过 `exchange.getComplement()` 验证互补关系
- [ ] `demo_validate` 能整合两个任务并输出完整结果
- [ ] `demo_validate` 能与 positions API 做轻量一致性校验

---

## 已知风险与踩坑

### 1. 文档版本漂移

Predict.fun 官方资料中仍存在旧链、旧抵押品、旧环境描述。实现时以以下顺序取信：

1. 当前 SDK 常量（`@predictdotfun/sdk` 的 `Constants.ts`）
2. 当前部署合约页（BscScan 验证的 ABI）
3. live API 响应
4. 合约 ABI / receipt 实测
5. 文档叙述文本

### 2. 主网 API 鉴权

最小闭环不要依赖主网 API。v0 demo 用测试网。主网需要 `x-api-key` header。

### 3. 稳定币不是 6 位，是 18 位

这是价格计算最容易算错的地方。BNB 链上的 USDT 是 `18 decimals`，不是 Polygon USDC 的 `6 decimals`。

### 4. `receipt.to` 不是 exchange

必须按 `log.address` 识别真正的撮合合约。`receipt.to` 可能是 Kernel 智能账户入口或 Operator 合约。

### 5. 不要默认丢弃 `taker == exchange` 的 `OrderFilled`

这条日志可能正好承载了 taker outcome 的成交腿。

### 6. `orderbook` 不是 `orders/matches`

一个是当前快照（浮点数），一个是历史成交（`1e18` 整数）；而且字段精度口径不同。

### 7. NegRisk tokenId 身份计算可能依赖 WrappedCollateral

不能把常规市场的 `getPositionId(USDT, ...)` 逻辑无脑复用到 NegRisk。

### 8. `orders/matches` 的 price 是 `1e18` 整数字符串

不是人类可读浮点！`"580000000000000000"` 表示 `0.58`，不是 `580000000000000000 USDT`。

### 9. fee.type 在链上和 API 之间不对齐

链上 `OrderFilled.fee` 只是一个 `uint256`，没有类型信息。API `orders/matches` 的 `fee.type` 可以是 `"SHARES"` 或 `"COLLATERAL"`。如果 fee 是 `SHARES` 类型，不能简单地把它当 USDT 金额来做成本计算。

### 10. Yield-bearing 市场使用完全不同的合约集

`isYieldBearing = true` 的市场使用 `YIELD_BEARING_*` 前缀的合约。如果用错合约，所有链上查询都会失败或返回错误数据。v0 应在入口处做 `isYieldBearing` 校验并拒绝不支持的市场类型。

---

## 后续代码实现建议

如果下一步开始写 JavaScript，建议按下面模块拆分：

```
predict-fun/
├── src/
│   ├── constants.js         # 合约地址、ABI、Topic Hash、已知 exchange 集合
│   ├── normalize.js         # 归一化工具（1e18 <-> 人类可读、BigInt 工具）
│   ├── trade_decoder.js     # receipt 解码、OrderFilled 归一化、matchType 判断
│   ├── market_decoder.js    # market API、condition/token 推导与校验
│   └── demo_validate.js     # 把 market -> match -> receipt -> positions 串起来
├── fixtures/                # 离线测试数据
├── .env.example
└── package.json
```

测试样例先固定为：

- `marketId = 72829`
- `txHash = 0x2b06856b775b0918c0c865955dc9a6c8e62f4e03251bd759e70e71482a3614dc`
- `address = 0x1c557c50aa572E83F88d1F09D49A725DF1f5f9Ed`

这样可以先把最小闭环跑通，再决定是否扩展：

- NegRisk
- Yield-bearing
- 主网
- 更复杂的多 maker 撮合归并

---

## 参考基线

这份实现文档的事实基线来自以下几类来源的交叉确认：

- Predict.fun 官方开发文档（`https://dev.predict.fun/`）
- `@predictdotfun/sdk` GitHub 仓库（`https://github.com/PredictDotFun/sdk`）的 `Constants.ts` 和 ABI 文件
- BNB 主网 / 测试网已验证合约 ABI 与只读函数
- `api-testnet.predict.fun` 的 live response（2026-03-26 验证）
- 真实测试网成交 receipt
- Sherlock 安全审计仓库（`https://github.com/sherlock-audit/2024-09-predict-fun`）

结论上，v0 最稳妥的落地路线已经明确：

- **先以测试网常规市场做闭环**
- **先做 `fills[]` 级别解码，不要过早压扁**
- **market 侧以 API 为入口、以链上函数为校验**

这就是 Predict.fun 版 decoder 的第一阶段实现说明。
