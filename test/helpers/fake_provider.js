import { ethers } from 'ethers';
import { ADDRESSES, CTF_ABI, EXCHANGE_ABI, getContracts } from '../../src/constants.js';

const ZERO_BYTES32 = '0x' + '0'.repeat(64);

function makeCollectionId(indexSet) {
  return '0x' + BigInt(indexSet).toString(16).padStart(64, '0');
}

export function createFixtureProvider({ market, receipt = null, chainId = 97 }) {
  const exchangeInterface = new ethers.Interface(EXCHANGE_ABI);
  const ctfInterface = new ethers.Interface(CTF_ABI);
  const contracts = getContracts(market, chainId);
  const activeExchange = contracts.exchange.toLowerCase();
  const activeCtf = contracts.ctf.toLowerCase();
  const allExchanges = new Set([
    ADDRESSES[chainId]?.CTF_EXCHANGE?.toLowerCase(),
    ADDRESSES[chainId]?.NEG_RISK_CTF_EXCHANGE?.toLowerCase(),
    ADDRESSES[chainId]?.YIELD_BEARING_CTF_EXCHANGE?.toLowerCase(),
    ADDRESSES[chainId]?.YIELD_BEARING_NEG_RISK_CTF_EXCHANGE?.toLowerCase(),
  ].filter(Boolean));

  const conditionByTokenId = new Map(
    (market.outcomes || []).map(outcome => [outcome.onChainId.toString(), market.conditionId])
  );
  const collectionIdByIndexSet = new Map(
    (market.outcomes || []).map(outcome => [Number(outcome.indexSet), makeCollectionId(outcome.indexSet)])
  );
  const tokenIdByCollectionId = new Map(
    (market.outcomes || []).map(outcome => [
      collectionIdByIndexSet.get(Number(outcome.indexSet)).toLowerCase(),
      BigInt(outcome.onChainId),
    ])
  );
  const complementByTokenId = new Map();
  for (const outcome of market.outcomes || []) {
    const complement = (market.outcomes || []).find(
      candidate => candidate.onChainId.toString() !== outcome.onChainId.toString()
    );
    if (complement) {
      complementByTokenId.set(outcome.onChainId.toString(), BigInt(complement.onChainId));
    }
  }

  async function handleExchangeCall(data, to) {
    const parsed = exchangeInterface.parseTransaction({ data });
    switch (parsed.name) {
      case 'getConditionId': {
        if (to !== activeExchange) {
          return exchangeInterface.encodeFunctionResult('getConditionId', [ZERO_BYTES32]);
        }
        const tokenId = parsed.args[0].toString();
        return exchangeInterface.encodeFunctionResult('getConditionId', [
          conditionByTokenId.get(tokenId) || ZERO_BYTES32,
        ]);
      }
      case 'getComplement': {
        if (to !== activeExchange) {
          return exchangeInterface.encodeFunctionResult('getComplement', [0n]);
        }
        const tokenId = parsed.args[0].toString();
        return exchangeInterface.encodeFunctionResult('getComplement', [
          complementByTokenId.get(tokenId) || 0n,
        ]);
      }
      case 'validateTokenId': {
        const tokenId = parsed.args[0].toString();
        return exchangeInterface.encodeFunctionResult('validateTokenId', [
          to === activeExchange && conditionByTokenId.has(tokenId),
        ]);
      }
      case 'getCollateral':
        return exchangeInterface.encodeFunctionResult('getCollateral', [contracts.collateral]);
      default:
        throw new Error(`Unsupported exchange call: ${parsed.name}`);
    }
  }

  async function handleCtfCall(data, to) {
    if (to !== activeCtf) {
      throw new Error(`Unexpected CTF address: ${to}`);
    }
    const parsed = ctfInterface.parseTransaction({ data });
    switch (parsed.name) {
      case 'getConditionId':
        return ctfInterface.encodeFunctionResult('getConditionId', [market.conditionId]);
      case 'getCollectionId': {
        const indexSet = Number(parsed.args[2]);
        return ctfInterface.encodeFunctionResult('getCollectionId', [
          collectionIdByIndexSet.get(indexSet) || ZERO_BYTES32,
        ]);
      }
      case 'getPositionId': {
        const collectionId = parsed.args[1].toLowerCase();
        return ctfInterface.encodeFunctionResult('getPositionId', [
          tokenIdByCollectionId.get(collectionId) || 0n,
        ]);
      }
      default:
        throw new Error(`Unsupported CTF call: ${parsed.name}`);
    }
  }

  return {
    async getTransactionReceipt(txHash) {
      if (!receipt) return null;
      const receiptTxHash = receipt.transactionHash || receipt.hash || null;
      if (!txHash) return receipt;
      return receiptTxHash?.toLowerCase() === txHash.toLowerCase() ? receipt : null;
    },
    async call(transaction) {
      const to = transaction.to?.toLowerCase();
      if (!to) {
        throw new Error('Missing call target address');
      }
      if (allExchanges.has(to)) {
        return handleExchangeCall(transaction.data, to);
      }
      if (to === activeCtf) {
        return handleCtfCall(transaction.data, to);
      }
      throw new Error(`Unexpected call target: ${to}`);
    },
    async resolveName(name) {
      return name;
    },
    async getNetwork() {
      return { chainId };
    },
  };
}
