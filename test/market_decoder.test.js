import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeByTokenId, decodeMarketFromMarketData } from '../src/market_decoder.js';
import { loadFixture } from './helpers/fixtures.js';
import { createFixtureProvider } from './helpers/fake_provider.js';
import { installMockFetch, jsonResponse } from './helpers/mock_fetch.js';

const market = loadFixture('market_72829.json');

test('market_decoder 能重建 conditionId 与 tokenId', async () => {
  const provider = createFixtureProvider({ market, chainId: 97 });
  const result = await decodeMarketFromMarketData(provider, market, 97);

  assert.equal(result.marketId, 72829);
  assert.equal(result.derivation.conditionIdRecomputed, true);
  assert.equal(result.derivation.tokenIdsDerived, true);
  assert.equal(result.derivation.exchangeConditionCheck, true);
  assert.equal(result.derivation.exchangeComplementCheck, true);
  assert.equal(result.outcomes[0].derivedTokenId, market.outcomes[0].onChainId);
  assert.equal(result.outcomes[1].derivedTokenId, market.outcomes[1].onChainId);
});

test('market_decoder 能从 tokenId 反查 market', async () => {
  const provider = createFixtureProvider({ market, chainId: 97 });
  const restoreFetch = installMockFetch(async (url) => {
    const href = String(url);
    if (href.includes('/v1/markets?')) {
      return jsonResponse({ success: true, data: [] });
    }
    if (href.endsWith('/v1/markets/72829')) {
      return jsonResponse({ success: true, data: market });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  });

  try {
    const result = await decodeByTokenId(
      provider,
      market.outcomes[0].onChainId,
      97
    );

    assert.equal(result.marketId, 72829);
    assert.equal(result.lookup.marketFound, true);
    assert.ok(result.lookup.source.includes('cache:'));
    assert.equal(result.input.outcomeName, 'Cloud9');
    assert.equal(result.input.complementOutcomeName, 'RED Canids');
  } finally {
    restoreFetch();
  }
});
