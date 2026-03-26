/**
 * provider.js — 统一创建稳定的 JsonRpcProvider
 *
 * 背景：
 * - 部分 BNB Testnet RPC 节点对 raw JSON-RPC 请求可正常响应
 * - 但在 ethers v6 的默认网络探测 / 批量请求流程下，可能出现启动超时
 *
 * 这里统一做两件事：
 * 1. 为已知链提供更稳妥的默认 RPC
 * 2. 对 provider 启用 staticNetwork + 关闭批量请求，降低握手超时概率
 */

import { ethers } from 'ethers';

export const DEFAULT_RPC_URLS = {
  56: 'https://bsc-dataseed.binance.org',
  97: 'https://bsc-testnet.publicnode.com',
};

/**
 * 获取默认 RPC URL
 * @param {number} chainId
 * @returns {string}
 */
export function getDefaultRpcUrl(chainId) {
  const rpcUrl = DEFAULT_RPC_URLS[chainId];
  if (!rpcUrl) {
    throw new Error(`No default RPC configured for chainId=${chainId}`);
  }
  return rpcUrl;
}

/**
 * 创建稳定的 JsonRpcProvider
 * @param {number} chainId
 * @param {string} [rpcUrl]
 * @returns {{ provider: ethers.JsonRpcProvider, rpcUrl: string }}
 */
export function createProvider(chainId, rpcUrl) {
  const resolvedRpcUrl = rpcUrl || process.env.RPC_URL || getDefaultRpcUrl(chainId);
  const network = ethers.Network.from(chainId);

  const provider = new ethers.JsonRpcProvider(
    resolvedRpcUrl,
    network,
    {
      staticNetwork: network,
      batchMaxCount: 1,
    }
  );

  return {
    provider,
    rpcUrl: resolvedRpcUrl,
  };
}
