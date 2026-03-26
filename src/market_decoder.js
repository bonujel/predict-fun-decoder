/**
 * market_decoder.js — 任务 B：市场参数解码
 *
 * 输入: marketId 或 tokenId
 * 输出: conditionId, oracle, resolver, tokenIds, outcomes 等市场参数
 *
 * 核心职责:
 * 1. 从 Predict.fun API 获取市场元数据
 * 2. 通过链上 CTF 函数重建 conditionId 和 tokenIds
 * 3. 交叉验证 API 结果与链上计算的一致性
 */

import { ethers } from 'ethers';
import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADDRESSES, CTF_ABI, EXCHANGE_ABI, getContracts } from './constants.js';
import { createProvider } from './provider.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const ZERO_BYTES32 = '0x' + '0'.repeat(64);

// ============================================================
// API 调用
// ============================================================

/**
 * 获取 Predict.fun API 基础 URL
 */
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
 * 获取市场详情
 * @param {number|string} marketId
 * @returns {Promise<object>}
 */
export async function fetchMarket(marketId) {
  const url = `${getApiBaseUrl()}/v1/markets/${marketId}`;
  const resp = await fetch(url, { headers: getApiHeaders() });
  if (!resp.ok) {
    throw new Error(`Failed to fetch market ${marketId}: ${resp.status} ${resp.statusText}`);
  }
  const json = await resp.json();
  if (!json.success) {
    throw new Error(`API error: ${JSON.stringify(json)}`);
  }
  return json.data;
}

async function queryMarkets(params = {}) {
  const url = new URL(`${getApiBaseUrl()}/v1/markets`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  const resp = await fetch(url, { headers: getApiHeaders() });
  if (!resp.ok) {
    throw new Error(`Failed to query markets: ${resp.status} ${resp.statusText}`);
  }
  const json = await resp.json();
  if (!json.success) {
    throw new Error(`API error: ${JSON.stringify(json)}`);
  }
  return json;
}

export function getDefaultMarketCachePath() {
  return resolve(MODULE_DIR, '..', 'fixtures', 'market_index.json');
}

function getMarketCachePath(explicitPath) {
  return explicitPath || process.env.MARKET_CACHE_FILE || getDefaultMarketCachePath();
}

export function loadMarketCache(cacheFile) {
  const resolvedPath = getMarketCachePath(cacheFile);
  if (!existsSync(resolvedPath)) {
    return {
      path: resolvedPath,
      marketIdsByConditionId: {},
      marketIdsByTokenId: {},
    };
  }
  const parsed = JSON.parse(readFileSync(resolvedPath, 'utf8'));
  return {
    path: resolvedPath,
    marketIdsByConditionId: parsed.marketIdsByConditionId || {},
    marketIdsByTokenId: parsed.marketIdsByTokenId || {},
  };
}

async function findMarketByConditionIdViaApi(conditionId) {
  const queries = [
    { conditionId, first: 10 },
    { searchTerm: conditionId, first: 10 },
  ];

  for (const query of queries) {
    try {
      const response = await queryMarkets(query);
      const matched = (response.data || []).find(
        item => item.conditionId?.toLowerCase() === conditionId.toLowerCase()
      );
      if (matched) {
        return {
          market: matched,
          lookup: {
            marketId: matched.id,
            source: 'api-filter',
          },
        };
      }
    } catch {
      // API 过滤不可用时静默回退到 cache
    }
  }

  return null;
}

async function resolveMarketByConditionId(conditionId, options = {}) {
  const apiResult = await findMarketByConditionIdViaApi(conditionId);
  if (apiResult) return apiResult;

  const cache = loadMarketCache(options.cacheFile);
  const marketId = cache.marketIdsByConditionId[conditionId.toLowerCase()] || null;
  if (!marketId) return null;

  const market = await fetchMarket(marketId);
  return {
    market,
    lookup: {
      marketId,
      source: `cache:${cache.path}`,
    },
  };
}

// ============================================================
// 链上数据获取
// ============================================================

/**
 * 从链上重建 conditionId
 * @param {ethers.JsonRpcProvider} provider
 * @param {object} market - 市场对象
 * @param {number} chainId
 * @returns {Promise<{conditionId: string, matches: boolean}>}
 */
async function deriveConditionId(provider, market, chainId) {
  const { ctf } = getContracts(market, chainId);
  const ctfContract = new ethers.Contract(ctf, CTF_ABI, provider);

  // 对于常规市场: conditionId = keccak256(resolverAddress, oracleQuestionId, 2)
  // 但 Predict.fun 的 prepareCondition(bytes32 questionId, uint256 outcomeSlotCount)
  // 中没有显式 oracle 参数，所以用 resolverAddress 作为 oracle
  const oracle = market.resolverAddress;
  const questionId = market.oracleQuestionId;
  const outcomeSlotCount = market.outcomes?.length || 2;

  try {
    const recomputed = await ctfContract.getConditionId(oracle, questionId, outcomeSlotCount);
    return {
      conditionId: recomputed,
      matches: recomputed.toLowerCase() === market.conditionId?.toLowerCase(),
    };
  } catch (err) {
    return {
      conditionId: null,
      matches: false,
      error: err.message,
    };
  }
}

/**
 * 从链上重建 YES/NO tokenIds
 * @param {ethers.JsonRpcProvider} provider
 * @param {object} market
 * @param {number} chainId
 * @param {string} conditionId
 * @returns {Promise<object>}
 */
async function deriveTokenIds(provider, market, chainId, conditionId) {
  const { ctf, collateral } = getContracts(market, chainId);
  const ctfContract = new ethers.Contract(ctf, CTF_ABI, provider);

  const ZERO_COLLECTION = '0x' + '0'.repeat(64);

  try {
    // 遍历 outcomes，计算每个 outcome 的 collectionId 和 positionId
    const outcomes = [];

    for (const outcome of (market.outcomes || [])) {
      const indexSet = outcome.indexSet;

      const collectionId = await ctfContract.getCollectionId(ZERO_COLLECTION, conditionId, indexSet);
      const tokenId = await ctfContract.getPositionId(collateral, collectionId);
      const tokenIdStr = tokenId.toString();

      outcomes.push({
        indexSet,
        name: outcome.name,
        apiOnChainId: outcome.onChainId?.toString(),
        derivedTokenId: tokenIdStr,
        matches: tokenIdStr === outcome.onChainId?.toString(),
      });
    }

    return { outcomes, collateral };
  } catch (err) {
    return {
      outcomes: [],
      collateral,
      error: err.message,
    };
  }
}

/**
 * 通过 exchange.getConditionId / getComplement 验证 tokenIds
 * @param {ethers.JsonRpcProvider} provider
 * @param {object} market
 * @param {number} chainId
 * @param {object[]} outcomes
 * @returns {Promise<object>}
 */
async function verifyWithExchange(provider, market, chainId, outcomes) {
  const { exchange, ctf } = getContracts(market, chainId);
  const exchangeContract = new ethers.Contract(exchange, EXCHANGE_ABI, provider);

  const checks = {};
  const errors = [];

  for (const outcome of outcomes) {
    const tokenId = BigInt(outcome.derivedTokenId);
    try {
      const condFromExchange = await exchangeContract.getConditionId(tokenId);
      const complement = await exchangeContract.getComplement(tokenId);

      const conditionMatches = condFromExchange.toLowerCase() === market.conditionId?.toLowerCase();

      // 找到互补的 outcome
      const complementOutcome = outcomes.find(o => o.derivedTokenId === complement.toString());

      checks[outcome.name] = {
        conditionIdMatches: conditionMatches,
        exchangeComplementMatches: !!complementOutcome,
        complementTokenId: complement.toString(),
        complementName: complementOutcome?.name || null,
      };
    } catch (err) {
      errors.push(`${outcome.name}: ${err.message}`);
      checks[outcome.name] = { error: err.message };
    }
  }

  return { checks, errors };
}

function buildBaseMarketResult(market, chainId) {
  return {
    marketId: market.id,
    chainId,
    conditionId: market.conditionId,
    oracleQuestionId: market.oracleQuestionId,
    resolverAddress: market.resolverAddress,
    isNegRisk: market.isNegRisk,
    isYieldBearing: market.isYieldBearing,
    feeRateBps: market.feeRateBps,
    decimalPrecision: market.decimalPrecision,
    marketVariant: market.marketVariant,
    status: market.status,
    tradingStatus: market.tradingStatus,
    title: market.title,
    question: market.question,
    contracts: getContracts(market, chainId),
    derivation: {
      conditionIdRecomputed: null,
      tokenIdsDerived: false,
      exchangeConditionCheck: null,
      exchangeComplementCheck: null,
    },
    outcomes: [],
    errors: [],
  };
}

// ============================================================
// 核心解码函数
// ============================================================

/**
 * 解码一个市场
 * @param {ethers.JsonRpcProvider} provider
 * @param {number} marketId
 * @param {number} chainId
 * @returns {Promise<object>}
 */
export async function decodeMarket(provider, marketId, chainId) {
  const market = await fetchMarket(marketId);
  return decodeMarketFromMarketData(provider, market, chainId);
}

export async function decodeMarketFromMarketData(provider, market, chainId) {
  const result = buildBaseMarketResult(market, chainId);

  // v0 只支持常规市场
  if (market.isNegRisk || market.isYieldBearing) {
    result.errors.push(`v0 only supports non-NegRisk and non-YieldBearing markets. Got isNegRisk=${market.isNegRisk}, isYieldBearing=${market.isYieldBearing}`);
    return result;
  }

  // 步骤 2: 从链上重建 conditionId
  const condResult = await deriveConditionId(provider, market, chainId);
  result.derivation.conditionIdRecomputed = condResult.matches;
  if (condResult.error) {
    result.errors.push(`deriveConditionId: ${condResult.error}`);
  }

  // 步骤 3: 从链上重建 tokenIds
  const tokenResult = await deriveTokenIds(provider, market, chainId, condResult.conditionId || market.conditionId);
  result.derivation.tokenIdsDerived = tokenResult.outcomes.length > 0;
  result.outcomes = tokenResult.outcomes;
  if (tokenResult.error) {
    result.errors.push(`deriveTokenIds: ${tokenResult.error}`);
  }

  // 步骤 4: 用 exchange 验证
  const exchangeResult = await verifyWithExchange(provider, market, chainId, result.outcomes);
  result.derivation.exchangeConditionCheck = exchangeResult.checks
    ? Object.values(exchangeResult.checks).every(c => !c.error && c.conditionIdMatches)
    : false;
  result.derivation.exchangeComplementCheck = exchangeResult.checks
    ? Object.values(exchangeResult.checks).every(c => !c.error && c.exchangeComplementMatches)
    : false;
  result.exchangeChecks = exchangeResult.checks;
  if (exchangeResult.errors.length > 0) {
    result.errors.push(...exchangeResult.errors.map(e => `verifyWithExchange: ${e}`));
  }

  return result;
}

/**
 * 通过 tokenId 反查市场信息（路径 B）
 * @param {ethers.JsonRpcProvider} provider
 * @param {string} tokenId
 * @param {number} chainId
 * @returns {Promise<object>}
 */
export async function decodeByTokenId(provider, tokenId, chainId, options = {}) {
  const addrs = ADDRESSES[chainId];
  if (!addrs) throw new Error(`Unsupported chainId: ${chainId}`);

  // 先尝试所有可能的 exchange
  const exchangeAddrs = [
    addrs.CTF_EXCHANGE,
    addrs.NEG_RISK_CTF_EXCHANGE,
    addrs.YIELD_BEARING_CTF_EXCHANGE,
    addrs.YIELD_BEARING_NEG_RISK_CTF_EXCHANGE,
  ].filter(Boolean);

  const tokenIdStr = tokenId.toString();
  let conditionId = null;
  let exchangeAddr = null;
  let complementTokenId = null;

  for (const addr of exchangeAddrs) {
    try {
      const testExchange = new ethers.Contract(addr, EXCHANGE_ABI, provider);
      const cid = await testExchange.getConditionId(tokenId);
      if (cid !== ZERO_BYTES32) {
        conditionId = cid;
        exchangeAddr = addr;
        complementTokenId = (await testExchange.getComplement(tokenId)).toString();
        break;
      }
    } catch {
      // 尝试下一个
    }
  }

  if (!conditionId) {
    throw new Error(`Could not find conditionId for tokenId: ${tokenId}`);
  }

  const resolved = await resolveMarketByConditionId(conditionId, {
    cacheFile: options.cacheFile,
  });

  if (!resolved) {
    return {
      input: {
        tokenId: tokenIdStr,
        complementTokenId,
        conditionId,
        exchange: exchangeAddr,
      },
      lookup: {
        marketFound: false,
        source: 'none',
      },
      errors: [
        'Market lookup by conditionId was not available from API filters and no local cache entry matched this tokenId.',
      ],
    };
  }

  const marketResult = await decodeMarketFromMarketData(provider, resolved.market, chainId);
  const inputOutcome = marketResult.outcomes.find(
    outcome => outcome.derivedTokenId === tokenIdStr || outcome.apiOnChainId === tokenIdStr
  ) || null;
  const complementOutcome = marketResult.outcomes.find(
    outcome => outcome.derivedTokenId === complementTokenId || outcome.apiOnChainId === complementTokenId
  ) || null;

  return {
    ...marketResult,
    input: {
      tokenId: tokenIdStr,
      complementTokenId,
      conditionId,
      exchange: exchangeAddr,
      outcomeName: inputOutcome?.name || null,
      complementOutcomeName: complementOutcome?.name || null,
    },
    lookup: {
      marketFound: true,
      marketId: resolved.lookup.marketId,
      source: resolved.lookup.source,
    },
  };
}

// ============================================================
// CLI 入口
// ============================================================

async function main() {
  const program = new Command();

  program
    .name('market_decoder')
    .description('Decode Predict.fun market parameters')
    .option('--market-id <id>', 'Market ID')
    .option('--token-id <id>', 'Token ID (alternative input)')
    .option('--chain-id <id>', 'Chain ID', '97')
    .option('--rpc-url <url>', 'RPC URL')
    .option('--api-base-url <url>', 'API base URL')
    .option('--market-cache-file <file>', 'Local market index cache for tokenId/conditionId reverse lookup')
    .option('--output <file>', 'Output file path');

  program.parse();
  const opts = program.opts();

  if (!opts.marketId && !opts.tokenId) {
    console.error('Error: --market-id or --token-id is required');
    process.exit(1);
  }

  const chainId = parseInt(opts.chainId, 10);
  const { provider, rpcUrl } = createProvider(chainId, opts.rpcUrl);

  if (opts.apiBaseUrl) {
    process.env.API_BASE_URL = opts.apiBaseUrl;
  }

  let result;
  if (opts.marketId) {
    result = await decodeMarket(provider, opts.marketId, chainId);
  } else {
    result = await decodeByTokenId(provider, opts.tokenId, chainId, {
      cacheFile: opts.marketCacheFile,
    });
  }

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
