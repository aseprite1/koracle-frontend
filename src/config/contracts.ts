// Contract addresses on Giwa Sepolia
export const ADDRESSES = {
  // Core contracts
  MORPHO: '0x6593314304ccc16ff64136123810Dd1e3EFa880a',
  UPETH: '0xc05bAe1723bd929306B0ab8125062Efc111fb338',
  UPKRW: '0x159C54accF62C14C117474B67D2E3De8215F5A72',
  ORACLE: '0xBD7E2b7DC0F9d8f0654D12c4B80322a1d30a1B6E',
  IRM: '0xA99676204e008B511dA8662F9bE99e2bfA5afd63',
  FAUCET: '0xF41830489d6DA54Fc9BcB387bF57E5fb47EdE95a',
  
  // Koracle contracts
  KORACLE: '0x0532d3A42318Ebbd10CECAF34517780fBf3e51D7',
  LISTING_ORACLE: '0x2dd1E775A387ef0d847015210a7DA32F5D2801b7',
  AGGREGATOR_FACTORY: '0x0e1d1B813Dd9a64E1E516AB55B9805db84Ec6D50',
} as const

export const MARKET_ID = '0x34c2bb71328345be53c633123ece6c4095b95b522aabbd8771071ec3141b3bd3' as const
export const LLTV = 920000000000000000n // 92%

// Koracle Feed IDs
export const FEED_IDS = {
  ETH_KRW: 'WEIGHTED.ETH.KRW',
  BTC_KRW: 'WEIGHTED.BTC.KRW',
  CRYPTO_FX: 'CRYPTOFX.USDT.KRW',
  USD_KRW: 'USD.KRW.PRICE',
} as const

// Market Parameters
export const marketParams = {
  loanToken: ADDRESSES.UPETH,
  collateralToken: ADDRESSES.UPKRW,
  oracle: ADDRESSES.ORACLE,
  irm: ADDRESSES.IRM,
  lltv: LLTV,
} as const

// ABIs
export const erc20Abi = [
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    name: 'approve',
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
] as const

export const morphoAbi = [
  // Supply loan token (UPETH)
  {
    inputs: [
      {
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' }
        ],
        name: 'marketParams',
        type: 'tuple'
      },
      { name: 'assets', type: 'uint256' },
      { name: 'shares', type: 'uint256' },
      { name: 'onBehalf', type: 'address' },
      { name: 'data', type: 'bytes' }
    ],
    name: 'supply',
    outputs: [{ type: 'uint256' }, { type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  // Withdraw loan token (UPETH)
  {
    inputs: [
      {
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' }
        ],
        name: 'marketParams',
        type: 'tuple'
      },
      { name: 'assets', type: 'uint256' },
      { name: 'shares', type: 'uint256' },
      { name: 'onBehalf', type: 'address' },
      { name: 'receiver', type: 'address' }
    ],
    name: 'withdraw',
    outputs: [{ type: 'uint256' }, { type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  // Borrow loan token (UPETH)
  {
    inputs: [
      {
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' }
        ],
        name: 'marketParams',
        type: 'tuple'
      },
      { name: 'assets', type: 'uint256' },
      { name: 'shares', type: 'uint256' },
      { name: 'onBehalf', type: 'address' },
      { name: 'receiver', type: 'address' }
    ],
    name: 'borrow',
    outputs: [{ type: 'uint256' }, { type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  // Repay loan token (UPETH)
  {
    inputs: [
      {
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' }
        ],
        name: 'marketParams',
        type: 'tuple'
      },
      { name: 'assets', type: 'uint256' },
      { name: 'shares', type: 'uint256' },
      { name: 'onBehalf', type: 'address' },
      { name: 'data', type: 'bytes' }
    ],
    name: 'repay',
    outputs: [{ type: 'uint256' }, { type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  // Supply collateral (UPKRW)
  {
    inputs: [
      {
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' }
        ],
        name: 'marketParams',
        type: 'tuple'
      },
      { name: 'assets', type: 'uint256' },
      { name: 'onBehalf', type: 'address' },
      { name: 'data', type: 'bytes' }
    ],
    name: 'supplyCollateral',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  // Withdraw collateral (UPKRW)
  {
    inputs: [
      {
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' }
        ],
        name: 'marketParams',
        type: 'tuple'
      },
      { name: 'assets', type: 'uint256' },
      { name: 'onBehalf', type: 'address' },
      { name: 'receiver', type: 'address' }
    ],
    name: 'withdrawCollateral',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  // Market data
  {
    inputs: [{ name: 'id', type: 'bytes32' }],
    name: 'market',
    outputs: [
      { name: 'totalSupplyAssets', type: 'uint128' },
      { name: 'totalSupplyShares', type: 'uint128' },
      { name: 'totalBorrowAssets', type: 'uint128' },
      { name: 'totalBorrowShares', type: 'uint128' },
      { name: 'lastUpdate', type: 'uint128' },
      { name: 'fee', type: 'uint128' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  // User position
  {
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'user', type: 'address' }
    ],
    name: 'position',
    outputs: [
      { name: 'supplyShares', type: 'uint256' },
      { name: 'borrowShares', type: 'uint128' },
      { name: 'collateral', type: 'uint128' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  // Set user kimp threshold
  {
    inputs: [
      {
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' }
        ],
        name: 'marketParams',
        type: 'tuple'
      },
      { name: 'threshold', type: 'uint256' }
    ],
    name: 'setKimpThreshold',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  // Get user kimp threshold
  {
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'user', type: 'address' }
    ],
    name: 'getUserKimpThreshold',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  // Get liquidation status
  {
    inputs: [
      {
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' }
        ],
        name: 'marketParams',
        type: 'tuple'
      },
      { name: 'borrower', type: 'address' }
    ],
    name: 'getLiquidationStatus',
    outputs: [
      { name: 'isHealthy', type: 'bool' },
      { name: 'currentKimp', type: 'uint256' },
      { name: 'userThreshold', type: 'uint256' },
      { name: 'canKimpLiquidate', type: 'bool' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  // Custom liquidate
  {
    inputs: [
      {
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' }
        ],
        name: 'marketParams',
        type: 'tuple'
      },
      { name: 'borrower', type: 'address' },
      { name: 'seizedAssets', type: 'uint256' },
      { name: 'repaidShares', type: 'uint256' },
      { name: 'data', type: 'bytes' }
    ],
    name: 'customLiquidate',
    outputs: [
      { name: 'seizedAssets', type: 'uint256' },
      { name: 'repaidAssets', type: 'uint256' }
    ],
    stateMutability: 'nonpayable',
    type: 'function'
  },
] as const

// Liquidate function (standard)
export const liquidateAbi = [
  {
    inputs: [
      {
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' }
        ],
        name: 'marketParams',
        type: 'tuple'
      },
      { name: 'borrower', type: 'address' },
      { name: 'seizedAssets', type: 'uint256' },
      { name: 'repaidShares', type: 'uint256' },
      { name: 'data', type: 'bytes' }
    ],
    name: 'liquidate',
    outputs: [
      { name: 'seizedAssets', type: 'uint256' },
      { name: 'repaidAssets', type: 'uint256' }
    ],
    stateMutability: 'nonpayable',
    type: 'function'
  },
] as const

// Oracle ABI (KoracleAdapter)
export const oracleAbi = [
  {
    inputs: [],
    name: 'price',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'kimchiPremium',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'getEthKrwPrice',
    outputs: [
      { name: 'ethKrwPrice', type: 'uint256' },
      { name: 'timestamp', type: 'uint256' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'getFxRates',
    outputs: [
      { name: 'cryptoFxRate', type: 'uint256' },
      { name: 'officialRate', type: 'uint256' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
] as const

// Koracle ABI (direct calls to Koracle contract)
export const koracleAbi = [
  {
    inputs: [{ name: 'feedId', type: 'string' }],
    name: 'getPriceByFeedId',
    outputs: [
      { name: 'price', type: 'uint256' },
      { name: 'timestamp', type: 'uint256' },
      { name: 'roundId', type: 'uint256' },
      { name: 'feedIdOut', type: 'string' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
] as const

// Listing Oracle ABI (입출금 가능 여부)
export const listingOracleAbi = [
  {
    inputs: [{ name: 'asset', type: 'string' }],
    name: 'isDepositEnabled',
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'asset', type: 'string' }],
    name: 'isWithdrawEnabled',
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'asset', type: 'string' }],
    name: 'getListingStatus',
    outputs: [
      { name: 'depositEnabled', type: 'bool' },
      { name: 'withdrawEnabled', type: 'bool' },
      { name: 'lastUpdate', type: 'uint256' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
] as const

export const faucetAbi = [
  {
    inputs: [],
    name: 'claim',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'hasClaimed',
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'getRemainingBalance',
    outputs: [
      { name: 'upkrwBalance', type: 'uint256' },
      { name: 'upethBalance', type: 'uint256' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'UPKRW_AMOUNT',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'UPETH_AMOUNT',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'user', type: 'address' },
      { indexed: false, name: 'upkrwAmount', type: 'uint256' },
      { indexed: false, name: 'upethAmount', type: 'uint256' }
    ],
    name: 'Claimed',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'token', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' }
    ],
    name: 'Withdrawn',
    type: 'event'
  },
] as const
