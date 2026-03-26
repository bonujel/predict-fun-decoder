/**
 * constants.js — Predict.fun Decoder 核心常量
 *
 * 合约地址、ABI、Topic Hash、已知 Exchange 集合
 * 参考: @predictdotfun/sdk Constants.ts + 实测验证
 */

// ============================================================
// 合约地址
// ============================================================

export const ADDRESSES = {
  // ---- BNB Mainnet (chainId = 56) ----
  56: {
    CTF_EXCHANGE:                    '0x8BC070BEdAB741406F4B1Eb65A72bee27894B689',
    NEG_RISK_CTF_EXCHANGE:           '0x365fb81bd4A24D6303cd2F19c349dE6894D8d58A',
    NEG_RISK_ADAPTER:                '0xc3Cf7c252f65E0d8D88537dF96569AE94a7F1A6E',
    CONDITIONAL_TOKENS:              '0x22DA1810B194ca018378464a58f6Ac2B10C9d244',
    NEG_RISK_CONDITIONAL_TOKENS:     '0x22DA1810B194ca018378464a58f6Ac2B10C9d244',
    USDT:                            '0x55d398326f99059fF775485246999027B3197955',
    YIELD_BEARING_CTF_EXCHANGE:      '0x6bEb5a40C032AFc305961162d8204CDA16DECFa5',
    YIELD_BEARING_NEG_RISK_CTF_EXCHANGE: '0x8A289d458f5a134bA40015085A8F50Ffb681B41d',
    YIELD_BEARING_NEG_RISK_ADAPTER:  '0x41dCe1A4B8FB5e6327701750aF6231B7CD0b2A40',
    YIELD_BEARING_CONDITIONAL_TOKENS:'0x9400F8Ad57e9e0F352345935d6D3175975eb1d9F',
    YIELD_BEARING_NEG_RISK_CONDITIONAL_TOKENS: '0xF64b0b318AAf83BD9071110af24D24445719A07F',
    KERNEL:                          '0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D',
    ECDSA_VALIDATOR:                 '0x845ADb2C711129d4f3966735eD98a9F09fC4cE57',
  },

  // ---- BNB Testnet (chainId = 97) ----
  97: {
    CTF_EXCHANGE:                    '0x2A6413639BD3d73a20ed8C95F634Ce198ABbd2d7',
    NEG_RISK_CTF_EXCHANGE:           '0xd690b2bd441bE36431F6F6639D7Ad351e7B29680',
    NEG_RISK_ADAPTER:                '0x285c1B939380B130D7EBd09467b93faD4BA623Ed',
    CONDITIONAL_TOKENS:              '0x2827AAef52D71910E8FBad2FfeBC1B6C2DA37743',
    NEG_RISK_CONDITIONAL_TOKENS:     '0x2827AAef52D71910E8FBad2FfeBC1B6C2DA37743',
    USDT:                            '0xB32171ecD878607FFc4F8FC0bCcE6852BB3149E0',
    YIELD_BEARING_CTF_EXCHANGE:      '0x8a6B4Fa700A1e310b106E7a48bAFa29111f66e89',
    YIELD_BEARING_NEG_RISK_CTF_EXCHANGE: '0x95D5113bc50eD201e319101bbca3e0E250662fCC',
    YIELD_BEARING_NEG_RISK_ADAPTER:  '0xb74aea04bdeBE912Aa425bC9173F9668e6f11F99',
    YIELD_BEARING_CONDITIONAL_TOKENS:'0x38BF1cbD66d174bb5F3037d7068E708861D68D7f',
    YIELD_BEARING_NEG_RISK_CONDITIONAL_TOKENS: '0x26e865CbaAe99b62fbF9D18B55c25B5E079A93D5',
  },
};

// ============================================================
// Topic0 Hash（keccak256 事件签名）
// ============================================================

export const TOPICS = {
  // Exchange 事件
  OrderFilled:      '0xd0a08e8c493f9c94f29311604c9de1b4e8c8d4c06bd0c789af57f2d65bfec0f6',
  OrdersMatched:     '0x63bf4d16b7fa898ef4c4b2b6d90fd201e9c56313b65638af6088d149d2ce956c',
  TokenRegistered:   '0xbc9a2432e8aeb48327246cddd6e872ef452812b4243c04e6bfb786a2cd8faf0d',
  OrderCancelled:    '0x5152abf959f6564662358c2e52b702259b78bac5ee7842a0f01937e670efcc7d',
  FeeCharged:        '0xacffcc86834d0f1a64b0d5a675798deed6ff0bcfc2231edd3480e7288dba7ff4',

  // ConditionalTokens 事件
  ConditionPreparation:  '0xab3760c3bd2bb38b5bcf54dc79802ed67338b4cf29f3054ded67ed24661e4177',
  ConditionResolution:   '0xb44d84d3289691f71497564b85d4233648d9dbae8cbdbb4329f301c3a0185894',
  PositionSplit:         '0x2e6bb91f8cbcda0c93623c54d0403a43514fabc40084ec96b6d5379a74786298',
  PositionsMerge:        '0x6f13ca62553fcc2bcd2372180a43949c1e4cebba603901ede2f4e14f36b282ca',
  PayoutRedemption:      '0x2682012a4a4f1973119f1c9b90745d1bd91fa2bab387344f044cb3586864d18d',
};

// ============================================================
// 合约 ABI（decoder 所需的只读函数 + 事件）
// ============================================================

export const EXCHANGE_ABI = [
  // 只读函数
  'function getConditionId(uint256 tokenId) view returns (bytes32)',
  'function getComplement(uint256 tokenId) view returns (uint256)',
  'function validateTokenId(uint256 tokenId) view returns (bool)',
  'function getCollateral() view returns (address)',

  // 事件
  'event OrderFilled(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint256 makerAssetId, uint256 takerAssetId, uint256 makerAmountFilled, uint256 takerAmountFilled, uint256 fee)',
  'event OrdersMatched(bytes32 indexed takerOrderHash, address indexed takerOrderMaker, uint256 makerAssetId, uint256 takerAssetId, uint256 makerAmountFilled, uint256 takerAmountFilled)',
  'event TokenRegistered(uint256 token0, uint256 token1, bytes32 conditionId)',
];

export const CTF_ABI = [
  // 只读函数
  'function getConditionId(address oracle, bytes32 questionId, uint256 outcomeSlotCount) pure returns (bytes32)',
  'function getCollectionId(bytes32 parentCollectionId, bytes32 conditionId, uint256 indexSet) view returns (bytes32)',
  'function getPositionId(address collateralToken, bytes32 collectionId) pure returns (uint256)',
  'function balanceOf(address owner, uint256 id) view returns (uint256)',
  'function payoutDenominator(bytes32 conditionId) view returns (uint256)',

  // 事件
  'event ConditionPreparation(bytes32 indexed conditionId, address indexed oracle, bytes32 indexed questionId, uint256 outcomeSlotCount)',
  'event PositionSplit(address indexed stakeholder, address collateralToken, bytes32 indexed parentCollectionId, bytes32 indexed conditionId, uint256[] partition, uint256 amount)',
  'event PositionsMerge(address indexed stakeholder, address collateralToken, bytes32 indexed parentCollectionId, bytes32 indexed conditionId, uint256[] partition, uint256 amount)',
  'event ConditionResolution(bytes32 indexed conditionId, address indexed oracle, bytes32 indexed questionId, uint256 outcomeSlotCount, uint256[] payoutNumerators)',
  'event PayoutRedemption(address indexed redeemer, address collateralToken, bytes32 indexed parentCollectionId, bytes32 indexed conditionId, uint256[] indexSets, uint256 payout)',
];

// ============================================================
// 已知 Exchange 地址集合（按 log.address 过滤用）
// ============================================================

export function getKnownExchanges(chainId) {
  const addrs = ADDRESSES[chainId];
  if (!addrs) return new Set();

  return new Set([
    addrs.CTF_EXCHANGE?.toLowerCase(),
    addrs.NEG_RISK_CTF_EXCHANGE?.toLowerCase(),
    addrs.YIELD_BEARING_CTF_EXCHANGE?.toLowerCase(),
    addrs.YIELD_BEARING_NEG_RISK_CTF_EXCHANGE?.toLowerCase(),
  ].filter(Boolean));
}

// ============================================================
// 合约路由：根据 market 属性选��正确的合约集
// ============================================================

/**
 * 根据市场属性返回对应的合约地址
 * @param {object} market - 市场对象，包含 isNegRisk 和 isYieldBearing
 * @param {number} chainId - 链 ID
 * @returns {{ exchange: string, ctf: string, adapter?: string, collateral: string }}
 */
export function getContracts(market, chainId) {
  const addrs = ADDRESSES[chainId];
  if (!addrs) throw new Error(`Unsupported chainId: ${chainId}`);

  const { isNegRisk = false, isYieldBearing = false } = market;

  if (isYieldBearing) {
    if (isNegRisk) {
      return {
        exchange: addrs.YIELD_BEARING_NEG_RISK_CTF_EXCHANGE,
        ctf: addrs.YIELD_BEARING_NEG_RISK_CONDITIONAL_TOKENS,
        adapter: addrs.YIELD_BEARING_NEG_RISK_ADAPTER,
        collateral: addrs.USDT, // 经 Venus 包装，但代币地址不变
      };
    }
    return {
      exchange: addrs.YIELD_BEARING_CTF_EXCHANGE,
      ctf: addrs.YIELD_BEARING_CONDITIONAL_TOKENS,
      collateral: addrs.USDT,
    };
  }

  if (isNegRisk) {
    return {
      exchange: addrs.NEG_RISK_CTF_EXCHANGE,
      ctf: addrs.NEG_RISK_CONDITIONAL_TOKENS,
      adapter: addrs.NEG_RISK_ADAPTER,
      collateral: addrs.USDT,
    };
  }

  // v0 默认路径：常规非 NegRisk、非 YieldBearing 市场
  return {
    exchange: addrs.CTF_EXCHANGE,
    ctf: addrs.CONDITIONAL_TOKENS,
    collateral: addrs.USDT,
  };
}

// ============================================================
// 链 ID 常量
// ============================================================

export const CHAIN_ID = {
  BNB_MAINNET: 56,
  BNB_TESTNET: 97,
};

// ============================================================
// EIP-712 域信息
// ============================================================

export const EIP712_DOMAIN = {
  name: 'predict.fun CTF Exchange',
  version: '1',
  chainId: undefined, // 动态填入
  verifyingContract: undefined, // 动态填入
};
