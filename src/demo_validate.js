/**
 * demo_validate.js — 任务 C：最小闭环验证
 *
 * 用一个真实测试网市场，串起:
 * 1. market_decoder — 验证市场参数
 * 2. trade_decoder — 验证交易成交
 * 3. positions API — 轻量持仓校验
 * 4. orders/matches API — 撮合事件校验
 *
 * 样例:
 * - marketId: 72829
 * - txHash: 0x2b06856b775b0918c0c865955dc9a6c8e62f4e03251bd759e70e71482a3614dc
 * - address: 0x1c557c50aa572E83F88d1F09D49A725DF1f5f9Ed
 */

import { ethers } from 'ethers';
import { Command } from 'commander';
import { decodeMarket } from './market_decoder.js';
import { decodeTrade, enrichWithChainData } from './trade_decoder.js';
import { createProvider } from './provider.js';

// ============================================================
// API 调用
// ============================================================

function getApiBaseUrl() {
  return process.env.API_BASE_URL || 'https://api-testnet.predict.fun';
}

function getApiHeaders() {
  const headers = {};
  if (process.env.API_KEY) {
    headers['x-api-key'] = process.env.API_KEY;
  }
  return headers;
}

/**
 * 获取撮合事件
 * @param {number|string} marketId
 * @param {number} first
 * @returns {Promise<object[]>}
 */
async function fetchMatches(marketId, first = 10) {
  const url = `${getApiBaseUrl()}/v1/orders/matches?marketId=${marketId}&first=${first}`;
  const resp = await fetch(url, { headers: getApiHeaders() });
  if (!resp.ok) throw new Error(`Failed to fetch matches: ${resp.status}`);
  const json = await resp.json();
  return json.data || [];
}

/**
 * 获取地址持仓
 * @param {string} address
 * @param {number} first
 * @returns {Promise<object[]>}
 */
async function fetchPositions(address, first = 20) {
  const url = `${getApiBaseUrl()}/v1/positions/${address}?first=${first}`;
  const resp = await fetch(url, { headers: getApiHeaders() });
  if (!resp.ok) throw new Error(`Failed to fetch positions: ${resp.status}`);
  const json = await resp.json();
  return json.data || [];
}

// ============================================================
// 校验逻辑
// ============================================================

/**
 * 验证撮合事件与链上 fills 的一致性
 */
function validateMatchesWithFills(matches, tradeResult) {
  const results = [];
  const fills = tradeResult.fills || [];
  const tradeTxHash = tradeResult.txHash?.toLowerCase();
  const relevantMatches = matches.filter(
    match => match.transactionHash?.toLowerCase() === tradeTxHash
  );

  for (const match of relevantMatches) {
    const matchTxHash = match.transactionHash?.toLowerCase();
    const takerTokenId = match.taker?.outcome?.onChainId?.toString() || null;
    const matchFill = matchTxHash === tradeTxHash
      ? fills.find(fill => fill.tokenId === takerTokenId)
        || fills.find(fill => fill.priceRaw === match.priceExecuted)
        || null
      : null;

    const validation = {
      txHash: matchTxHash,
      amountFilled: match.amountFilled,
      priceExecuted: match.priceExecuted,
      takerOutcome: match.taker?.outcome?.name,
      makerOutcome: match.makers?.[0]?.outcome?.name,
      matchedToFill: !!matchFill,
      matchedFillTokenId: matchFill?.tokenId || null,
    };

    if (matchFill) {
      const fillSharesRaw = BigInt(matchFill.shareAmountRaw);
      const matchSharesRaw = BigInt(match.amountFilled);
      validation.sharesMatch = fillSharesRaw === matchSharesRaw;

      const fillPriceRaw = BigInt(matchFill.priceRaw);
      const matchPriceRaw = BigInt(match.priceExecuted);
      validation.priceMatch = fillPriceRaw === matchPriceRaw;
    } else {
      validation.sharesMatch = false;
      validation.priceMatch = false;
    }

    results.push(validation);
  }

  return results;
}

/**
 * 验证持仓数据与市场的一致性
 */
function validatePositions(positions, marketId, outcomes) {
  const relevantPositions = positions.filter(
    p => p.market?.id === Number(marketId)
  );

  const results = relevantPositions.map(pos => {
    const outcome = outcomes.find(
      o => o.derivedTokenId === pos.outcome?.onChainId?.toString()
    );

    return {
      outcomeName: pos.outcome?.name,
      outcomeTokenId: pos.outcome?.onChainId,
      amount: pos.amount,
      averageBuyPriceUsd: pos.averageBuyPriceUsd,
      valueUsd: pos.valueUsd,
      pnlUsd: pos.pnlUsd,
      derivedOutcomeMatches: !!outcome,
      derivedTokenId: outcome?.derivedTokenId,
    };
  });

  return {
    positionCount: relevantPositions.length,
    positions: results,
    hasPositionInMarket: relevantPositions.length > 0,
  };
}

// ============================================================
// 核心 demo 函数
// ============================================================

/**
 * 运行完整 demo 验证
 * @param {ethers.JsonRpcProvider} provider
 * @param {number} marketId
 * @param {string} txHash
 * @param {string} address
 * @param {number} chainId
 * @returns {Promise<object>}
 */
export async function runDemo(provider, marketId, txHash, address, chainId) {
  const steps = [];
  const errors = [];

  // 步骤 1: 解码市场
  steps.push({ step: 'market_decode', status: 'running', message: 'Fetching and decoding market...' });
  let marketResult;
  try {
    marketResult = await decodeMarket(provider, marketId, chainId);
    steps[0].status = 'done';
    steps[0].result = {
      conditionId: marketResult.conditionId,
      isNegRisk: marketResult.isNegRisk,
      isYieldBearing: marketResult.isYieldBearing,
      feeRateBps: marketResult.feeRateBps,
      decimalPrecision: marketResult.decimalPrecision,
      derivation: marketResult.derivation,
      errors: marketResult.errors,
    };
  } catch (err) {
    steps[0].status = 'error';
    steps[0].error = err.message;
    errors.push(err.message);
    return { steps, errors, market: null, trade: null, positions: null };
  }

  // 步骤 2: 解码交易
  steps.push({ step: 'trade_decode', status: 'running', message: 'Fetching and decoding trade...' });
  let tradeResult;
  try {
    tradeResult = await decodeTrade(provider, txHash, chainId);
    // 补充链上数据
    await enrichWithChainData(provider, tradeResult, chainId);
    steps[1].status = 'done';
    steps[1].result = {
      matchType: tradeResult.matchType,
      fillsCount: tradeResult.fills.length,
      matchedEventsCount: tradeResult.matchedEvents.length,
      ctfEventsCount: tradeResult.ctfEvents.length,
      notes: tradeResult.notes,
    };
  } catch (err) {
    steps[1].status = 'error';
    steps[1].error = err.message;
    errors.push(err.message);
  }

  // 步骤 3: 获取撮合事件
  steps.push({ step: 'api_matches', status: 'running', message: 'Fetching matches from API...' });
  let matches = [];
  try {
    matches = await fetchMatches(marketId, 10);
    steps[2].status = 'done';
    steps[2].result = { count: matches.length };
  } catch (err) {
    steps[2].status = 'error';
    steps[2].error = err.message;
    errors.push(err.message);
  }

  // 步骤 4: 获取持仓
  steps.push({ step: 'api_positions', status: 'running', message: 'Fetching positions from API...' });
  let positions = [];
  try {
    positions = await fetchPositions(address, 20);
    steps[3].status = 'done';
    steps[3].result = { totalCount: positions.length };
  } catch (err) {
    steps[3].status = 'error';
    steps[3].error = err.message;
    errors.push(err.message);
  }

  // 步骤 5: 交叉验证
  steps.push({ step: 'validate', status: 'running', message: 'Running cross-validation...' });
  const validation = {
    marketConditionMatchesChain: marketResult?.derivation?.conditionIdRecomputed === true,
    marketTokensMatchApi: marketResult?.derivation?.tokenIdsDerived === true,
    tradeConditionMatchesMarket: false,
    tradeFillsMatchCondition: false,
    tradeMatchesApi: false,
    positionsExist: false,
  };

  // 检查 trade 的 conditionId 是否与 market 一致
  if (tradeResult && tradeResult.fills?.length > 0) {
    const tradeConditionIds = new Set(
      tradeResult.fills
        .filter(f => f.conditionId)
        .map(f => f.conditionId.toLowerCase())
    );
    if (tradeConditionIds.size === 1 && tradeConditionIds.has(marketResult.conditionId?.toLowerCase())) {
      validation.tradeConditionMatchesMarket = true;
    }
    validation.tradeFillsMatchCondition = tradeConditionIds.size > 0;
  }

  // 检查持仓
  if (positions.length > 0 && marketResult) {
    const hasMarketPosition = positions.some(
      p => p.market?.id === Number(marketId)
    );
    validation.positionsExist = hasMarketPosition;
  }

  // 撮合验证（tradeResult 包含 fills[] 和 txHash）
  let matchValidation = [];
  if (matches.length > 0 && tradeResult) {
    matchValidation = validateMatchesWithFills(matches, tradeResult);
    const targetTxValidation = matchValidation.find(
      item => item.txHash === txHash.toLowerCase()
    );
    validation.tradeMatchesApi = !!targetTxValidation
      && targetTxValidation.sharesMatch === true
      && targetTxValidation.priceMatch === true;
  }

  // 持仓验证
  let positionValidation = null;
  if (positions.length > 0 && marketResult) {
    positionValidation = validatePositions(
      positions,
      marketId,
      marketResult.outcomes || []
    );
  }

  steps[4].status = 'done';
  steps[4].result = validation;

  // 汇总
  const summary = {
    allChecksPass: validation.marketConditionMatchesChain
      && validation.marketTokensMatchApi
      && validation.tradeConditionMatchesMarket
      && validation.tradeFillsMatchCondition
      && validation.tradeMatchesApi
      && validation.positionsExist,
    checks: validation,
    matchValidation,
    positionValidation,
  };

  steps.push({ step: 'summary', status: 'done', result: summary });

  return {
    meta: {
      marketId,
      txHash,
      address,
      chainId,
      timestamp: new Date().toISOString(),
    },
    steps,
    errors,
    summary,
    // 详细数据
    market: marketResult,
    trade: tradeResult,
  };
}

// ============================================================
// CLI 入口
// ============================================================

async function main() {
  const program = new Command();

  program
    .name('demo_validate')
    .description('Run full demo: market + trade + positions validation')
    .requiredOption('--market-id <id>', 'Market ID')
    .option('--tx-hash <hash>', 'Transaction hash to decode')
    .option('--address <address>', 'Address for positions check')
    .option('--chain-id <id>', 'Chain ID', '97')
    .option('--rpc-url <url>', 'RPC URL')
    .option('--api-base-url <url>', 'API base URL')
    .option('--output <file>', 'Output file path')
    .option('--verbose', 'Include full detail in output', false);

  program.parse();
  const opts = program.opts();

  const chainId = parseInt(opts.chainId, 10);
  const { provider, rpcUrl } = createProvider(chainId, opts.rpcUrl);

  if (opts.apiBaseUrl) {
    process.env.API_BASE_URL = opts.apiBaseUrl;
  }

  // 默认样例
  const txHash = opts.txHash || '0x2b06856b775b0918c0c865955dc9a6c8e62f4e03251bd759e70e71482a3614dc';
  const address = opts.address || '0x1c557c50aa572E83F88d1F09D49A725DF1f5f9Ed';

  console.error(`Running demo for market ${opts.marketId} on chain ${chainId}`);

  const result = await runDemo(provider, opts.marketId, txHash, address, chainId);

  // 控制台友好输出
  console.log(JSON.stringify(result, null, 2));

  if (opts.output) {
    const fs = await import('fs');
    fs.writeFileSync(opts.output, JSON.stringify(result, null, 2));
    console.error(`Output written to: ${opts.output}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
