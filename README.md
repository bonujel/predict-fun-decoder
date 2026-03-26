# Predict.fun Decoder

基于 JavaScript 的 Predict.fun 链上数据解码工具，包含交易解码器（trade_decoder）、市场解码器（market_decoder）和最小闭环验证（demo_validate）。

## 功能概览

| 模块 | 用途 |
|------|------|
| `trade_decoder` | 输入 `txHash` / `receipt` / `logs`，输出该交易中的 `OrderFilled` / `OrdersMatched` / `PositionSplit` 等链上事件 |
| `market_decoder` | 输入 `marketId` / `tokenId`，输出 `conditionId`、TokenId、互补关系等市场参数（API + 链上双重来源） |
| `demo_validate` | 用真实测试网市场串起三个数据源，完成最小闭环验证 |

## 快速开始

### 安装依赖

```bash
npm install
```

### 配置环境

```bash
cp .env.example .env
# 默认使用更稳定的 BNB Testnet Public RPC + 测试网 API
```

### 运行示例

```bash
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
# 指定 RPC（当默认节点不可用时）
node src/trade_decoder.js --tx-hash <hash> --rpc-url https://bsc-testnet.publicnode.com

# 补充链上 conditionId / complementTokenId
node src/trade_decoder.js --tx-hash <hash> --enrich

# 自定义 tokenId -> market 反查用的本地 cache
node src/market_decoder.js --token-id <tokenId> --market-cache-file ./fixtures/market_index.json

# 输出到文件
node src/trade_decoder.js --tx-hash <hash> --output ./data/trade.json
node src/market_decoder.js --market-id 72829 --output ./data/market.json
```

### RPC 现象说明（重要）

BNB Testnet 上有一个容易误判的问题：

- `https://data-seed-prebsc-1-s1.binance.org:8545/` 这类官方 prebsc 节点，直接用 `curl` 调 `eth_chainId` / `eth_blockNumber` 往往是通的。
- 但在 `ethers v6` 的默认 `JsonRpcProvider` 启动流程里，可能出现 `failed to detect network` 或 `request timeout`。
- 即使加了稳定化初始化，真实合约读调用阶段仍可能间歇性出现 `ECONNRESET`，所以它不适合作为本项目的默认测试网 RPC。

本项目为此做了两层处理：

1. 默认 RPC 改为 `https://bsc-testnet.publicnode.com`
2. 创建 provider 时统一启用 `staticNetwork + batchMaxCount: 1`

如果你仍想使用官方 prebsc RPC，可以临时尝试，但不建议把它作为默认值；项目当前仅保证默认的 PublicNode 路径稳定。

## 项目结构

```
src/
├── constants.js       # 合约地址、ABI、Topic Hash、路由函数
├── index.js           # 包入口导出
├── normalize.js       # 18 decimals 归一化、BigInt 工具
├── trade_decoder.js   # 任务 A：交易日志解码
├── market_decoder.js  # 任务 B：市场参数解码
└── demo_validate.js   # 任务 C：最小闭环验证
fixtures/              # 样例 market / receipt / matches / positions / market index
test/                  # node:test 离线回归测试
data/                  # 输出目录
```

## 技术细节

### Predict.fun vs Polymarket 的关键差异

| 维度 | Polymarket | Predict.fun（本项目） |
|------|-----------|---------------------|
| 区块链 | Polygon | **BNB Chain** |
| 抵押品精度 | USDC **6 decimals** | USDT **18 decimals** |
| 合约集 | 单套 | **四套**（标准 / NegRisk / Yield-bearing / 组合） |
| 撮合入口 | Exchange 地址 | **Kernel 智能账户**（receipt.to ≠ exchange） |
| fee 类型 | 无类型 | **SHARES / COLLATERAL** |

### 核心设计决策

1. **不丢弃 `taker == exchange` 的 OrderFilled**
   Predict.fun 的 MINT 类型撮合中，taker 侧汇总腿的 taker 地址恰好是 exchange 地址，这条日志**不应丢弃**。它可能承载了一半的交易语义（互补 outcome 的成交信息）。

2. **按 `log.address` 而非 `receipt.to` 识别 Exchange**
   Predict.fun 使用 Kernel 智能账户，tx 的 `receipt.to` 通常是账户入口而非合约本体。正确的过滤方式是扫描所有已知 Exchange/CTF 合约地址。

3. **CTF 事件同时来自 Exchange 和 ConditionalTokens 合约**
   `PositionSplit` / `PositionsMerge` 事件出现在 ConditionalTokens 合约上，不在 Exchange 上。解码时需要同时监听两套合约。

4. **RPC 要按 ethers v6 的兼容方式初始化**
   测试网官方 prebsc RPC 对 raw JSON-RPC 请求通常没问题，但在 ethers v6 的默认网络探测阶段可能超时。项目默认使用 PublicNode，并在内部统一启用 `staticNetwork + batchMaxCount: 1`。

5. **三层金额口径统一为 BigInt**
   - 链上 OrderFilled：`uint256`，1e18 精度
   - API orders/matches：`"1e18"` 整数字符串
   - API orderbook：`[0.42, 5.1785]` 人类可读浮点数
   内部统一转为 BigInt，对外输出时按需格式化。

6. **`tokenId -> market` 在 v0 里优先走 cache 回退**
   Predict.fun 测试网 API 当前不能稳定按 `conditionId` 精确过滤 market。项目实现因此采用两段式反查：
   - 先用 exchange 的 `getConditionId(tokenId)` / `getComplement(tokenId)` 拿到链上身份
   - 再优先尝试 API 精确过滤；若失败，则回退到本地 `fixtures/market_index.json`

   这保证了 v0 样例 market 的 `tokenId` 输入面是完整可用的，同时也保留了后续替换成正式 market 索引器的扩展点。

## 离线回归测试

项目附带了最小 fixture 集，`npm test` 不依赖外部 RPC / API，可直接验证三条核心能力：

- `trade_decoder` 能从真实 receipt / logs 解出两条成交腿，价格分别为 `0.58` / `0.42`
- `market_decoder` 能重建 `conditionId`、`tokenId` 并完成 `tokenId -> market` 反查
- `demo_validate` 能对样例 market `72829` 完成闭环校验并返回 `allChecksPass = true`

## 支持的市场类型

| 类型 | 状态 |
|------|------|
| 常规二元市场（`isNegRisk=false, isYieldBearing=false`） | ✅ 支持 |
| NegRisk 市场 | ⚠️ v0 读取 API 数据但不重建 tokenId |
| Yield-bearing 市场 | ⚠️ v0 读取 API 数据但不使用对应合约集 |
| 主网（chainId=56） | ⚠️ 需要配置 `RPC_URL` + API key |

## 验证结果

全部 11 项验收标准通过（基于 BNB Testnet 市场 `72829` + 交易 `0x2b0685...`）：

```
trade_decoder:
  ✅ OrderFilled 解析完整
  ✅ price / side / tokenId 计算正确
  ✅ matchType 识别（MINT）
  ✅ 保留 taker==exchange 腿

market_decoder:
  ✅ API 市场信息获取
  ✅ 链上 conditionId 重建
  ✅ 链上 TokenId 推导
  ✅ TokenId 与 API onChainId 一致
  ✅ exchange.getComplement() 互补验证
  ✅ tokenId -> market 反查（API 过滤 + 本地 cache 回退）

demo_validate:
  ✅ 整合两个 decoder 输出完整结果
  ✅ positions API 轻量一致性校验
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RPC_URL` | `https://bsc-testnet.publicnode.com` | 推荐的 BNB Testnet RPC |
| `CHAIN_ID` | `97` | 链 ID |
| `API_BASE_URL` | `https://api-testnet.predict.fun` | Predict.fun 测试网 API |
| `API_KEY` | 空 | 主网 API Key；设置后会自动作为 `x-api-key` 请求头发送 |
| `MARKET_CACHE_FILE` | `./fixtures/market_index.json` | `tokenId -> market` 反查的本地 market 索引文件 |

主网使用：设置 `CHAIN_ID=56`、`API_BASE_URL=https://api.predict.fun`，并配置 API key。
