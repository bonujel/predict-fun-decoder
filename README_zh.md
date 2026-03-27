# Predict.fun Decoder

基于 JavaScript 的 Predict.fun 链上数据解码工具，包含交易解码器（trade_decoder）、市场解码器（market_decoder）和最小闭环验证（demo_validate）。

## 功能概览

| 模块 | 用途 |
|------|------|
| `trade_decoder` | 输入 `txHash` / `receipt` / `logs`，输出该交易中的 `OrderFilled` / `OrdersMatched` / `PositionSplit` 等链上事件 |
| `market_decoder` | 输入 `marketId` / `tokenId`，输出 `conditionId`、TokenId、互补关系等市场参数（API + 链上双重来源） |
| `demo_validate` | 用真实测试网市场串起三个数据源，完成最小闭环验证 |

## 快速开始

```bash
npm install

# 复制环境配置（默认使用 BNB Testnet + Public RPC）
cp .env.example .env

# 任务 A：解码一笔真实成交
node src/trade_decoder.js --tx-hash 0x2b06856b775b0918c0c865955dc9a6c8e62f4e03251bd759e70e71482a3614dc

# 任务 A（离线）：直接解码 receipt / logs fixture
node src/trade_decoder.js --receipt-file ./fixtures/receipt_0x2b06856b775b0918c0c865955dc9a6c8e62f4e03251bd759e70e71482a3614dc.json
node src/trade_decoder.js --logs-file ./fixtures/logs_0x2b06856b775b0918c0c865955dc9a6c8e62f4e03251bd759e70e71482a3614dc.json

# 任务 B：解码一个市场
node src/market_decoder.js --market-id 72829
node src/market_decoder.js --token-id 12723470295927997005591429032016946047344374045078339206225302506313975527799

# 任务 C：完整闭环验证
node src/demo_validate.js --market-id 72829

# 离线回归测试
npm test
```

### 更多选项

```bash
# 指定 RPC
node src/trade_decoder.js --tx-hash <hash> --rpc-url https://bsc-testnet.publicnode.com

# 补充链上 conditionId / complementTokenId
node src/trade_decoder.js --tx-hash <hash> --enrich

# 自定义 tokenId -> market 反查用的本地 cache
node src/market_decoder.js --token-id <tokenId> --market-cache-file ./fixtures/market_index.json

# 输出到文件
node src/trade_decoder.js --tx-hash <hash> --output ./data/trade.json
node src/market_decoder.js --market-id 72829 --output ./data/market.json
```

### RPC 现象说明

BNB Testnet 的官方 `data-seed-prebsc-*` 节点直接用 `curl` 调 RPC 通常正常，但在 ethers v6 的默认网络探测阶段可能失败（`failed to detect network`、`request timeout` 或间歇性 `ECONNRESET`）。项目默认使用 PublicNode 并在内部统一启用 `staticNetwork + batchMaxCount: 1`。

## 项目结构

```
src/
├── constants.js        # 合约地址、ABI、Topic Hash、路由函数
├── index.js           # 包入口导出
├── normalize.js       # 18 decimals 归一化、BigInt 工具
├── provider.js        # RPC provider 工厂
├── trade_decoder.js   # 任务 A：交易日志解码
├── market_decoder.js  # 任务 B：市场参数解码
└── demo_validate.js  # 任务 C：最小闭环验证
fixtures/              # 样例 market / receipt / matches / positions / market index
test/                  # node:test 离线回归测试
data/                  # 输出目录
```

## 核心设计决策

### 1. 不丢弃 `taker == exchange` 的 OrderFilled

Predict.fun 的 MINT 类型撮合中，taker 侧汇总腿的 taker 地址恰好是 exchange 地址，这条日志**不应丢弃**。它可能承载了一半的交易语义（互补 outcome 的成交信息）。

### 2. 按 `log.address` 而非 `receipt.to` 识别 Exchange

Predict.fun 使用 Kernel 智能账户，tx 的 `receipt.to` 通常是账户入口而非合约本体。正确的过滤方式是扫描所有已知 Exchange/CTF 合约地址。

### 3. CTF 事件同时来自 Exchange 和 ConditionalTokens 合约

`PositionSplit` / `PositionsMerge` 事件出现在 ConditionalTokens 合约上，不在 Exchange 上。解码时需要同时监听两套合约。

### 4. ethers v6 兼容的 RPC 初始化

BNB Testnet 官方 RPC 在 ethers v6 的网络探测阶段可能超时。项目默认使用 PublicNode 并启用 `staticNetwork + batchMaxCount: 1`。

### 5. 三层金额口径统一为 BigInt

| 数据来源 | 格式 |
|---------|------|
| 链上 `OrderFilled` | `uint256`，1e18 精度 |
| API `orders/matches` | `"1e18"` 整数字符串 |
| API `orderbook` | `[0.42, 5.1785]` 人类可读浮点数 |

内部统一转为 BigInt，对外输出时按需格式化。

### 6. `tokenId -> market` 优先走 cache 回退

Predict.fun 测试网 API 当前不能稳定按 `conditionId` 精确过滤 market。实现采用两段式反查：先用 exchange 的 `getConditionId(tokenId)` / `getComplement(tokenId)` 拿到链上身份，再优先尝试 API 精确过滤；若失败则回退到本地 `fixtures/market_index.json`。

## Predict.fun vs Polymarket

| 维度 | Polymarket | Predict.fun |
|------|-----------|-------------|
| 区块链 | Polygon | **BNB Chain** |
| 抵押品精度 | USDC **6 decimals** | USDT **18 decimals** |
| 合约集 | 单套 | **四套**（标准 / NegRisk / Yield-bearing / 组合） |
| 撮合入口 | Exchange 地址 | **Kernel 智能账户**（`receipt.to ≠ exchange`） |
| fee 类型 | 无类型 | **SHARES / COLLATERAL** |

## 支持的市场类型

| 类型 | 状态 |
|------|------|
| 常规二元市场（`isNegRisk=false, isYieldBearing=false`） | ✅ 支持 |
| NegRisk 市场 | ⚠️ v0 读取 API 数据但不重建 tokenId |
| Yield-bearing 市场 | ⚠️ v0 读取 API 数据但不使用对应合约集 |
| 主网（chainId=56） | ⚠️ 需要配置 `RPC_URL` + API key |

## 离线回归测试

`npm test` 不依赖外部 RPC / API，验证三条核心能力：

- `trade_decoder` 能从真实 receipt / logs 解出两条成交腿，价格分别为 `0.58` / `0.42`
- `market_decoder` 能重建 `conditionId`、`tokenId` 并完成 `tokenId -> market` 反查
- `demo_validate` 能对样例 market `72829` 完成闭环校验并返回 `allChecksPass = true`

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RPC_URL` | `https://bsc-testnet.publicnode.com` | 推荐的 BNB Testnet RPC |
| `CHAIN_ID` | `97` | 链 ID |
| `API_BASE_URL` | `https://api-testnet.predict.fun` | Predict.fun 测试网 API |
| `API_KEY` | 空 | 主网 API Key；设置后自动作为 `x-api-key` 请求头发送 |
| `MARKET_CACHE_FILE` | `./fixtures/market_index.json` | `tokenId -> market` 反查的本地 market 索引文件 |

主网使用：设置 `CHAIN_ID=56`、`API_BASE_URL=https://api.predict.fun`，并配置 API key。
