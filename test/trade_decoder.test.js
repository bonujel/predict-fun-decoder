import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeTradeFromLogs, decodeTradeFromReceiptObject } from '../src/trade_decoder.js';
import { loadFixture } from './helpers/fixtures.js';

const receipt = loadFixture('receipt_0x2b06856b775b0918c0c865955dc9a6c8e62f4e03251bd759e70e71482a3614dc.json');
const logsPayload = loadFixture('logs_0x2b06856b775b0918c0c865955dc9a6c8e62f4e03251bd759e70e71482a3614dc.json');

test('trade_decoder 能从 receipt 解出两条真实成交腿', () => {
  const result = decodeTradeFromReceiptObject(receipt, 97);

  assert.equal(result.txHash, receipt.transactionHash);
  assert.equal(result.matchType, 'MINT');
  assert.equal(result.fills.length, 2);
  assert.equal(result.matchedEvents.length, 1);
  assert.deepEqual(
    result.fills.map(fill => fill.tokenId),
    [
      '66100295494026117689691193272997657936075615289731125308266914975031974519236',
      '12723470295927997005591429032016946047344374045078339206225302506313975527799',
    ]
  );
  assert.deepEqual(
    result.fills.map(fill => fill.priceRaw),
    ['580000000000000000', '420000000000000000']
  );
  assert.ok(result.notes.some(note => note.includes('Kernel smart account')));
});

test('trade_decoder 能从 raw logs 文件直接解码', () => {
  const result = decodeTradeFromLogs(logsPayload.logs, 97, {
    txHash: logsPayload.txHash,
    receiptTo: logsPayload.receiptTo,
  });

  assert.equal(result.txHash, logsPayload.txHash);
  assert.equal(result.fills.length, 2);
  assert.equal(result.ctfEvents.length, 1);
});
