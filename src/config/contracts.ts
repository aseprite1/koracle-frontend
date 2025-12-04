// Contract addresses on Giwa Sepolia
export const ADDRESSES = {
  MORPHO: '0xf31D0A92Ab90096a5d895666B5dEDA3639d185B2',
  UPETH: '0xc05bAe1723bd929306B0ab8125062Efc111fb338',
  UPKRW: '0x159C54accF62C14C117474B67D2E3De8215F5A72',
  ORACLE: '0x258d90F00eEd27c69514A934379Aa41Cc03ea875',
  IRM: '0xA99676204e008B511dA8662F9bE99e2bfA5afd63',
} as const

export const MARKET_ID = '0x5fdc9fa54b964034b39b1b36ec4b8b009bbf1448cdc951cbb05f647c42d9149f' as const
export const LLTV = 920000000000000000n // 92%

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
] as const

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
] as const
