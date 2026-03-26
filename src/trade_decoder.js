/**
 * trade_decoder.js — 任务 A：交易日志解码
 *
 * 输入: txHash + chainId
 * 输出: fills[], matchedEvents[], ctfEvents[], matchType
 *
 * 核心职责:
 * 1. 获取链上 receipt，过滤出 Predict.fun Exchange 相关日志
 * 2. 解析 OrderFilled / OrdersMatched / PositionSplit / PositionsMerge
 * 3. 计算 price、side、tokenId、conditionId
 * 4. 判断撮合类型 (MINT/MERGE/DIRECT)
 */

import { ethers } from 'ethers';
import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import { ADDRESSES, TOPICS, EXCHANGE_ABI, CTF_ABI, getKnownExchanges } from './constants.js';
import { createProvider } from './provider.js';
import {
  toDecimalString, calcPrice,
  toHex, decodeUint256,
} from './normalize.js';

// ============================================================
// 日志解码
// ============================================================

function getLogIndex(log) {
  if (log.logIndex !== undefined && log.logIndex !== null) {
    return log.logIndex;
  }
  if (log.index !== undefined && log.index !== null) {
    const index = typeof log.index === 'bigint'
      ? log.index
      : BigInt(log.index);
    return `0x${index.toString(16)}`;
  }
  return null;
}

/**
 * 解析 OrderFilled 事件日志
 * @param {object} log - 原始 log 对象
 * @param {string} exchangeAddr - 发出该日志的 exchange 地址
 * @returns {object} 解码后的 fill 对象
 */
function parseOrderFilled(log, exchangeAddr) {
  // topics
  // topic[0]: 事件签名
  // topic[1]: orderHash (bytes32 indexed)
  // topic[2]: maker (address indexed)
  // topic[3]: taker (address indexed)
  const orderHash = log.topics[1];
  const maker = '0x' + log.topics[2].slice(26);
  const taker = '0x' + log.topics[3].slice(26);

  // data: makerAssetId, takerAssetId, makerAmountFilled, takerAmountFilled, fee
  const makerAssetId = decodeUint256(log.data, 0);
  const takerAssetId = decodeUint256(log.data, 1);
  const makerAmountFilled = decodeUint256(log.data, 2);
  const takerAmountFilled = decodeUint256(log.data, 3);
  const fee = decodeUint256(log.data, 4);

  // 判断方向
  // makerAssetId == 0: maker 付出抵押品 (USDT)，买入 outcome token -> BUY
  // takerAssetId == 0: maker 付出 outcome token，卖出 -> SELL
  const isMakerBuy = makerAssetId === 0n;
  const side = isMakerBuy ? 'BUY' : 'SELL';

  // tokenId = 非零的 assetId
  const tokenId = isMakerBuy ? takerAssetId : makerAssetId;
  const collateralAmount = isMakerBuy ? makerAmountFilled : takerAmountFilled;
  const shareAmount = isMakerBuy ? takerAmountFilled : makerAmountFilled;

  // 价格
  const price = calcPrice(collateralAmount, shareAmount);
  const priceRaw = shareAmount === 0n
    ? 0n
    : (collateralAmount * (10n ** 18n)) / shareAmount;

  return {
    logIndex: getLogIndex(log),
    exchange: exchangeAddr.toLowerCase(),
    orderHash,
    maker: maker.toLowerCase(),
    taker: taker.toLowerCase(),
    makerAssetId: toHex(makerAssetId),
    takerAssetId: toHex(takerAssetId),
    makerAmountFilled: toDecimalString(makerAmountFilled),
    takerAmountFilled: toDecimalString(takerAmountFilled),
    fee: toDecimalString(fee),
    feeRaw: toHex(fee),
    tokenId: tokenId.toString(),
    collateralAmountRaw: collateralAmount.toString(),
    shareAmountRaw: shareAmount.toString(),
    priceRaw: priceRaw.toString(),
    collateralAmount: toDecimalString(collateralAmount),
    shareAmount: toDecimalString(shareAmount),
    price: price.toFixed(6),
    side,
    // 补充信息（需要后续查询 chain 获取）
    conditionId: null,
    complementTokenId: null,
    roleHint: null,
  };
}

/**
 * 解析 OrdersMatched 事件
 * @param {object} log
 * @param {string} exchangeAddr
 * @returns {object}
 */
function parseOrdersMatched(log, exchangeAddr) {
  const takerOrderHash = log.topics[1];
  const takerOrderMaker = '0x' + log.topics[2].slice(26);

  const makerAssetId = decodeUint256(log.data, 0);
  const takerAssetId = decodeUint256(log.data, 1);
  const makerAmountFilled = decodeUint256(log.data, 2);
  const takerAmountFilled = decodeUint256(log.data, 3);

  return {
    logIndex: getLogIndex(log),
    exchange: exchangeAddr.toLowerCase(),
    takerOrderHash,
    takerOrderMaker: takerOrderMaker.toLowerCase(),
    makerAssetId: toHex(makerAssetId),
    takerAssetId: toHex(takerAssetId),
    makerAmountFilled: toDecimalString(makerAmountFilled),
    takerAmountFilled: toDecimalString(takerAmountFilled),
  };
}

/**
 * 解析 PositionSplit / PositionsMerge 事件
 * @param {object} log
 * @param {string} topic0 - 事件 topic[0]
 * @returns {object}
 */
function parseCtfEvent(log, topic0) {
  const eventName = topic0 === TOPICS.PositionSplit
    ? 'PositionSplit'
    : topic0 === TOPICS.PositionsMerge
      ? 'PositionsMerge'
      : 'Unknown';

  // PositionSplit topics:
  // topic[0]: 事件签名
  // topic[1]: stakeholder (address indexed)
  // topic[2]: parentCollectionId (bytes32 indexed)
  // topic[3]: conditionId (bytes32 indexed)
  const stakeholder = '0x' + log.topics[1].slice(26);
  const parentCollectionId = log.topics[2];
  const conditionId = log.topics[3];

  // 用 ethers Interface 解析 data 部分（正确处理动态数组）
  let collateralToken = null;
  let partition = [];
  let amount = 0n;

  try {
    const iface = new ethers.Interface(CTF_ABI);
    const parsed = iface.parseLog({ topics: log.topics, data: log.data });
    if (parsed) {
      collateralToken = parsed.args.collateralToken;
      partition = parsed.args.partition.map(BigInt);
      amount = parsed.args.amount;
    }
  } catch {
    // 备用：从 data 末尾直接取 amount
    const data = log.data.slice(2);
    amount = BigInt('0x' + data.slice(-64));
  }

  return {
    event: eventName,
    logIndex: getLogIndex(log),
    stakeholder: stakeholder.toLowerCase(),
    parentCollectionId,
    conditionId,
    collateralToken: collateralToken?.toLowerCase() || null,
    partition: partition.map(n => n.toString()),
    amount: toDecimalString(amount),
    amountRaw: toHex(amount),
  };
}

// ============================================================
// 撮合类型判断
// ============================================================

/**
 * 判断撮合类型
 * - DIRECT: 只有单侧 outcome token 交换，无明显 PositionSplit/Merge
 * - MINT: 有互补 token 的 BUY 腿 + PositionSplit
 * - MERGE: 有互补 token 的 SELL 腿 + PositionsMerge
 *
 * @param {object[]} fills
 * @param {object[]} ctfEvents
 * @returns {string}
 */
function inferMatchType(fills, ctfEvents) {
  const hasSplit = ctfEvents.some(e => e.event === 'PositionSplit');
  const hasMerge = ctfEvents.some(e => e.event === 'PositionsMerge');

  // 检查是否有 BUY 方向的 fill
  const buyFills = fills.filter(f => f.side === 'BUY');
  const sellFills = fills.filter(f => f.side === 'SELL');

  if (hasSplit) return 'MINT';
  if (hasMerge) return 'MERGE';

  // 只有单侧成交，无 CTF 事件 -> DIRECT
  if (buyFills.length > 0 && sellFills.length === 0) return 'DIRECT';
  if (sellFills.length > 0 && buyFills.length === 0) return 'DIRECT';

  return 'UNKNOWN';
}

function getDecoderContext(chainId) {
  const knownExchanges = getKnownExchanges(chainId);
  const { CONDITIONAL_TOKENS, NEG_RISK_CONDITIONAL_TOKENS } = ADDRESSES[chainId] || {};
  const ctfAddrs = new Set([
    CONDITIONAL_TOKENS?.toLowerCase(),
    NEG_RISK_CONDITIONAL_TOKENS?.toLowerCase(),
  ].filter(Boolean));
  const ctfTopics = new Set([
    TOPICS.PositionSplit,
    TOPICS.PositionsMerge,
    TOPICS.ConditionPreparation,
    TOPICS.ConditionResolution,
    TOPICS.PayoutRedemption,
  ]);

  return { knownExchanges, ctfAddrs, ctfTopics };
}

function normalizeReceiptLike(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Receipt/log payload must be a JSON object');
  }
  return input.result && typeof input.result === 'object'
    ? input.result
    : input;
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/**
 * 直接从 logs 数组解码
 * @param {object[]} logs
 * @param {number} chainId
 * @param {{txHash?: string|null, receiptTo?: string|null}} meta
 * @returns {object}
 */
export function decodeTradeFromLogs(logs, chainId, meta = {}) {
  const { knownExchanges, ctfAddrs, ctfTopics } = getDecoderContext(chainId);
  const notes = [];
  const exchangeLogs = (logs || []).filter(
    log => log?.address && knownExchanges.has(log.address.toLowerCase())
  );
  const ctfLogs = (logs || []).filter(
    log => log?.address && ctfAddrs.has(log.address.toLowerCase())
  );

  if (exchangeLogs.length === 0 && ctfLogs.length === 0) {
    return {
      txHash: meta.txHash || null,
      chainId,
      receiptTo: meta.receiptTo?.toLowerCase() || null,
      exchangeLogsFound: false,
      fills: [],
      matchedEvents: [],
      ctfEvents: [],
      matchType: 'NONE',
      notes: ['No exchange or CTF logs found for known addresses'],
    };
  }

  const fills = [];
  const matchedEvents = [];
  const ctfEvents = [];

  for (const log of exchangeLogs) {
    const topic0 = log.topics?.[0];
    const exchangeAddr = log.address.toLowerCase();

    if (topic0 === TOPICS.OrderFilled) {
      fills.push(parseOrderFilled(log, exchangeAddr));
    } else if (topic0 === TOPICS.OrdersMatched) {
      matchedEvents.push(parseOrdersMatched(log, exchangeAddr));
    } else if (ctfTopics.has(topic0)) {
      ctfEvents.push(parseCtfEvent(log, topic0));
    }
  }

  for (const log of ctfLogs) {
    const topic0 = log.topics?.[0];
    if (ctfTopics.has(topic0)) {
      ctfEvents.push(parseCtfEvent(log, topic0));
    }
  }

  const matchType = inferMatchType(fills, ctfEvents);

  if (meta.receiptTo && !knownExchanges.has(meta.receiptTo.toLowerCase())) {
    notes.push(`receipt.to (${meta.receiptTo}) is not an exchange address (likely a Kernel smart account)`);
  }

  if (fills.length > 1) {
    notes.push(`Multiple fills detected: ${fills.length} OrderFilled events in this tx`);
  }

  return {
    txHash: meta.txHash || null,
    chainId,
    receiptTo: meta.receiptTo?.toLowerCase() || null,
    exchangeLogsFound: true,
    fills,
    matchedEvents,
    ctfEvents,
    matchType,
    notes,
  };
}

/**
 * 从 receipt 对象直接解码
 * @param {object} receiptLike
 * @param {number} chainId
 * @returns {object}
 */
export function decodeTradeFromReceiptObject(receiptLike, chainId) {
  const receipt = normalizeReceiptLike(receiptLike);
  return decodeTradeFromLogs(receipt.logs || [], chainId, {
    txHash: receipt.transactionHash || receipt.hash || null,
    receiptTo: receipt.to || null,
  });
}

// ============================================================
// 核心解码函数
// ============================================================

/**
 * 解码一笔交易
 * @param {ethers.JsonRpcProvider} provider
 * @param {string} txHash
 * @param {number} chainId
 * @returns {Promise<object>}
 */
export async function decodeTrade(provider, txHash, chainId) {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    throw new Error(`Transaction not found: ${txHash}`);
  }
  return decodeTradeFromReceiptObject({
    transactionHash: receipt.hash || txHash,
    to: receipt.to,
    logs: receipt.logs,
  }, chainId);
}

/**
 * 补充 conditionId 和 complementTokenId（需要额外的链上查询）
 * @param {ethers.JsonRpcProvider} provider
 * @param {object} decodedTrade - decodeTrade 的返回值
 * @param {number} chainId
 */
export async function enrichWithChainData(provider, decodedTrade, chainId) {
  const { Contract } = await import('ethers');
  const { getContracts, getKnownExchanges } = await import('./constants.js');

  for (const fill of decodedTrade.fills) {
    try {
      const tokenId = BigInt(fill.tokenId);

      // 找到该 fill 对应的 exchange 地址
      const exchangeAddr = fill.exchange;
      const exchange = new Contract(exchangeAddr, EXCHANGE_ABI, provider);

      const [conditionId, complementTokenId] = await Promise.all([
        exchange.getConditionId(tokenId),
        exchange.getComplement(tokenId),
      ]);

      fill.conditionId = conditionId;
      fill.complementTokenId = complementTokenId.toString();
    } catch (err) {
      fill.conditionId = null;
      fill.complementTokenId = null;
      fill.chainError = err.message;
    }
  }
}

// ============================================================
// CLI 入口
// ============================================================

async function main() {
  const program = new Command();

  program
    .name('trade_decoder')
    .description('Decode Predict.fun trade transaction logs')
    .option('--tx-hash <hash>', 'Transaction hash')
    .option('--receipt-file <file>', 'JSON file containing a transaction receipt')
    .option('--logs-file <file>', 'JSON file containing raw logs[] or { logs, txHash, receiptTo }')
    .option('--chain-id <id>', 'Chain ID', '97')
    .option('--rpc-url <url>', 'RPC URL')
    .option('--output <file>', 'Output file path')
    .option('--enrich', 'Enrich fills with chain data (conditionId, complement)', false);

  program.parse();
  const opts = program.opts();
  const inputCount = [opts.txHash, opts.receiptFile, opts.logsFile].filter(Boolean).length;

  if (inputCount !== 1) {
    console.error('Error: exactly one of --tx-hash, --receipt-file or --logs-file is required');
    process.exit(1);
  }

  const chainId = parseInt(opts.chainId, 10);
  let provider = null;
  let rpcUrl = null;
  let result;

  if (opts.txHash) {
    ({ provider, rpcUrl } = createProvider(chainId, opts.rpcUrl));
    console.error(`Decoding tx: ${opts.txHash} on chain ${chainId} via ${rpcUrl}`);
    result = await decodeTrade(provider, opts.txHash, chainId);
  } else if (opts.receiptFile) {
    const receipt = normalizeReceiptLike(readJsonFile(opts.receiptFile));
    console.error(`Decoding receipt file: ${opts.receiptFile} on chain ${chainId}`);
    result = decodeTradeFromReceiptObject(receipt, chainId);
  } else {
    const payload = normalizeReceiptLike(readJsonFile(opts.logsFile));
    const logs = Array.isArray(payload) ? payload : payload.logs;
    if (!Array.isArray(logs)) {
      throw new Error('logs file must be an array or an object with a logs[] field');
    }
    console.error(`Decoding logs file: ${opts.logsFile} on chain ${chainId}`);
    result = decodeTradeFromLogs(logs, chainId, {
      txHash: payload.transactionHash || payload.txHash || null,
      receiptTo: payload.to || payload.receiptTo || null,
    });
  }

  if (opts.enrich) {
    if (!provider) {
      ({ provider, rpcUrl } = createProvider(chainId, opts.rpcUrl));
      console.error(`Enriching decoded fills via ${rpcUrl}`);
    }
    await enrichWithChainData(provider, result, chainId);
  }

  // 控制台友好输出
  console.log(JSON.stringify(result, null, 2));

  if (opts.output) {
    writeFileSync(opts.output, JSON.stringify(result, null, 2));
    console.error(`Output written to: ${opts.output}`);
  }
}

// 只在直接运行时执行 CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
