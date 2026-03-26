/**
 * normalize.js — 归一化工具函数
 *
 * 核心职责：统一处理 Predict.fun 的三种金额口径
 * - 链上 OrderFilled: uint256 原始值，USDT 为 18 decimals
 * - API orders/matches: "1e18" 整数字符串
 * - API orderbook / positions: 人类可读浮点数
 */

// ============================================================
// 常量
// ============================================================

export const DECIMALS = 18n;
export const UNIT = 10n ** DECIMALS; // 1e18

// ============================================================
// BigInt <-> 字符串/数字 转换
// ============================================================

/**
 * 将 "778500000000000000" 字符串转为 BigInt
 * @param {string} s
 * @returns {bigint}
 */
export function fromWeiString(s) {
  return BigInt(s);
}

/**
 * 将浮点数转为 BigInt（按 1e18 精度）
 * @param {number} f
 * @returns {bigint}
 */
export function fromFloat(f) {
  return BigInt(Math.round(f * Number(UNIT)));
}

/**
 * 将 BigInt 转为人类可读浮点数
 * @param {bigint} raw
 * @returns {number}
 */
export function toHuman(raw) {
  return Number(raw) / Number(UNIT);
}

/**
 * 将 BigInt 转为带小数的字符串（保留全部精度）
 * @param {bigint} raw
 * @returns {string}
 */
export function toDecimalString(raw) {
  const sign = raw < 0n ? '-' : '';
  const abs = raw < 0n ? -raw : raw;
  const integer = abs / UNIT;
  const fraction = abs % UNIT;
  return `${sign}${integer}.${fraction.toString().padStart(Number(DECIMALS), '0')}`;
}

// ============================================================
// 价格相关
// ============================================================

/**
 * 从 collateral 数量和 share 数量计算成交价
 * @param {bigint} collateralRaw - 抵押品 raw 值（1e18）
 * @param {bigint} sharesRaw - shares raw 值（1e18）
 * @returns {number} 人类可读价格
 */
export function calcPrice(collateralRaw, sharesRaw) {
  if (sharesRaw === 0n) return 0;
  return Number(collateralRaw) / Number(sharesRaw);
}

/**
 * 格式化价格为人类可读字符串
 * @param {bigint|number} priceRaw - 原始价格（1e18 整数值）或已转换的浮点数
 * @param {number} decimalPrecision - 保留小数位数，默认 4
 * @returns {string}
 */
export function formatPrice(priceRaw, decimalPrecision = 4) {
  // 如果传入的是已转换的浮点数
  if (typeof priceRaw === 'number') {
    return priceRaw.toFixed(decimalPrecision);
  }
  // 传入的是 BigInt（1e18 整数值），先转浮点
  return toHuman(priceRaw).toFixed(decimalPrecision);
}

/**
 * 互补价格计算（用于 No 侧或 orderbook 互补验证）
 * 例如 Yes=0.42 -> No=0.58
 * @param {number} price - Yes 侧价格
 * @param {number} decimalPrecision - 价格精度位数，默认 2
 * @returns {number}
 */
export function getComplement(price, decimalPrecision = 2) {
  const factor = 10 ** decimalPrecision;
  return (factor - Math.round(price * factor)) / factor;
}

// ============================================================
// 代币数量格式化
// ============================================================

/**
 * 格式化 shares 数量为人类可读字符串
 * @param {bigint} sharesRaw
 * @returns {string}
 */
export function formatShares(sharesRaw) {
  return toDecimalString(sharesRaw);
}

/**
 * 格式化 collateral 数量为人类可读字符串
 * @param {bigint} collateralRaw
 * @returns {string}
 */
export function formatCollateral(collateralRaw) {
  return toDecimalString(collateralRaw);
}

// ============================================================
// 数据源归一化（API 不同端点的口径统一为 BigInt）
// ============================================================

/**
 * 将 API orders/matches 的金额字段转为 BigInt
 * @param {string} s - "778500000000000000" 格式
 * @returns {bigint}
 */
export function normalizeApiMatchAmount(s) {
  return fromWeiString(s);
}

/**
 * 将 API orderbook 的浮点数量转为 BigInt
 * @param {number} f
 * @returns {bigint}
 */
export function normalizeOrderbookAmount(f) {
  return fromFloat(f);
}

/**
 * 将 API orderbook 的浮点价格转为 BigInt
 * @param {number} price
 * @param {number} decimalPrecision - decimalPrecision 字段，默认 2
 * @returns {bigint}
 */
export function normalizeOrderbookPrice(price, decimalPrecision = 2) {
  return BigInt(Math.round(price * 10 ** decimalPrecision));
}

// ============================================================
// 十六进制解码辅助
// ============================================================

/**
 * 从 raw data 字段解码单个 uint256
 * @param {string} dataHex - "0x..." 格式的 data 字段
 * @param {number} offset - 字段偏移（0, 1, 2... 表示第 N 个字段）
 * @returns {bigint}
 */
export function decodeUint256(dataHex, offset) {
  const data = dataHex.slice(2); // 去掉 0x
  const start = offset * 64;
  return BigInt('0x' + data.slice(start, start + 64));
}

/**
 * 将 BigInt 转为 0x 前缀的 hex 字符串
 * @param {bigint} value
 * @returns {string}
 */
export function toHex(value) {
  return '0x' + value.toString(16);
}
