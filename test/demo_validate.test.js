import test from 'node:test';
import assert from 'node:assert/strict';
import { runDemo } from '../src/demo_validate.js';
import { loadFixture } from './helpers/fixtures.js';
import { createFixtureProvider } from './helpers/fake_provider.js';
import { installMockFetch, jsonResponse } from './helpers/mock_fetch.js';

const market = loadFixture('market_72829.json');
const matches = loadFixture('matches_72829.json');
const positions = loadFixture('positions_1c557_72829.json');
const receipt = loadFixture('receipt_0x2b06856b775b0918c0c865955dc9a6c8e62f4e03251bd759e70e71482a3614dc.json');
const address = '0x1c557c50aa572E83F88d1F09D49A725DF1f5f9Ed';

test('demo_validate 能对样例 market/tx 离线完成闭环校验', async () => {
  const provider = createFixtureProvider({ market, receipt, chainId: 97 });
  const restoreFetch = installMockFetch(async (url) => {
    const href = String(url);
    if (href.includes('/v1/markets?')) {
      return jsonResponse({ success: true, data: [] });
    }
    if (href.endsWith('/v1/markets/72829')) {
      return jsonResponse({ success: true, data: market });
    }
    if (href.includes('/v1/orders/matches?marketId=72829')) {
      return jsonResponse({ success: true, data: matches });
    }
    if (href.includes(`/v1/positions/${address}?first=20`)) {
      return jsonResponse({ success: true, data: positions });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  });

  try {
    const result = await runDemo(
      provider,
      72829,
      receipt.transactionHash,
      address,
      97
    );

    assert.equal(result.summary.allChecksPass, true);
    assert.equal(result.summary.checks.marketConditionMatchesChain, true);
    assert.equal(result.summary.checks.marketTokensMatchApi, true);
    assert.equal(result.summary.checks.tradeMatchesApi, true);
    assert.equal(result.summary.checks.positionsExist, true);
    assert.equal(result.summary.matchValidation.length, 1);
  } finally {
    restoreFetch();
  }
});
