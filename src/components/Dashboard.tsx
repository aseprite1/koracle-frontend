import { useState, useEffect } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { formatUnits, parseUnits } from 'viem'
import { ADDRESSES, MARKET_ID, morphoAbi, oracleAbi, erc20Abi } from '../config/contracts'
import { giwaSepoliaNetwork } from '../config/appkit'

// ============ TYPES ============
type ViewType = 'dashboard' | 'liquidate'
type MarketSelection = 'UPETH' | 'UPKRW' | 'UPETH_BORROW' | null

interface WalletState {
  balance: {
    UPETH: number
    UPKRW: number
  }
}

interface MarketState {
  ethPrice: number
  kimchi: number
  tvl: number
}

interface UserPosition {
  supplyShares: bigint
  borrowShares: bigint
  collateral: bigint
  supplyAssets: number  // calculated
  borrowAssets: number  // calculated
}

// ============ ICONS ============
const icons = {
  UPETH: (
    <svg className="w-6 h-6 asset-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <g fill="none" fillRule="evenodd">
        <circle cx="16" cy="16" r="16" fill="#627EEA"/>
        <path fill="#FFF" fillOpacity=".602" d="M16.498 4v8.87l7.497 3.35z"/>
        <path fill="#FFF" d="M16.498 4L9 16.22l7.498-3.35z"/>
        <path fill="#FFF" fillOpacity=".602" d="M16.498 21.968l7.497-4.353-7.497-3.348z"/>
        <path fill="#FFF" d="M9 17.615l7.498 4.353v-7.701z"/>
        <path fill="#FFF" fillOpacity=".2" d="M16.498 20.573l7.497-4.353-7.497 10.291z"/>
        <path fill="#FFF" fillOpacity=".602" d="M9 16.22l7.498 4.353v1.791z"/>
      </g>
    </svg>
  ),
  UPETH_LG: (
    <svg className="w-8 h-8 asset-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <g fill="none" fillRule="evenodd">
        <circle cx="16" cy="16" r="16" fill="#627EEA"/>
        <path fill="#FFF" fillOpacity=".602" d="M16.498 4v8.87l7.497 3.35z"/>
        <path fill="#FFF" d="M16.498 4L9 16.22l7.498-3.35z"/>
        <path fill="#FFF" fillOpacity=".602" d="M16.498 21.968l7.497-4.353-7.497-3.348z"/>
        <path fill="#FFF" d="M9 17.615l7.498 4.353v-7.701z"/>
        <path fill="#FFF" fillOpacity=".2" d="M16.498 20.573l7.497-4.353-7.497 10.291z"/>
        <path fill="#FFF" fillOpacity=".602" d="M9 16.22l7.498 4.353v1.791z"/>
      </g>
    </svg>
  ),
  UPKRW: (
    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-red-500 to-blue-600 flex items-center justify-center text-[10px] font-bold text-white border border-white/10">
      ₩
    </div>
  ),
  UPKRW_LG: (
    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-red-500 to-blue-600 flex items-center justify-center text-xs font-bold text-white border border-white/10">
      ₩
    </div>
  ),
  UPKRW_SM: (
    <div className="w-4 h-4 rounded-full bg-gradient-to-br from-red-500 to-blue-600 flex items-center justify-center text-[8px] font-bold text-white border border-white/10">
      ₩
    </div>
  ),
}

// ============ UTILS ============
const fmt = (n: number) => new Intl.NumberFormat('en-US').format(n)

// ============ MAIN COMPONENT ============
export default function Dashboard() {
  // === Wallet State ===
  const { address, isConnected } = useAccount()
  
  // === Local State ===
  const [currentView, setCurrentView] = useState<ViewType>('dashboard')
  const [selection, setSelection] = useState<MarketSelection>(null)
  const [inputAmount, setInputAmount] = useState('')
  const [collateralAmount, setCollateralAmount] = useState('')
  const [simulatedHF, setSimulatedHF] = useState<number | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)
  const [executionStatus, setExecutionStatus] = useState<'idle' | 'broadcasting' | 'confirmed'>('idle')

  const [walletState, setWalletState] = useState<WalletState>({
    balance: { UPETH: 0, UPKRW: 0 }
  })

  const [marketState, setMarketState] = useState<MarketState>({
    ethPrice: 4566000,
    kimchi: 2.4,
    tvl: 142050000
  })

  const [userPosition, setUserPosition] = useState<UserPosition>({
    supplyShares: 0n,
    borrowShares: 0n,
    collateral: 0n,
    supplyAssets: 0,
    borrowAssets: 0
  })

  const [txStep, setTxStep] = useState<'idle' | 'approving' | 'approved' | 'executing'>('idle')

  // === Contract Reads ===
  const { data: marketData } = useReadContract({
    address: ADDRESSES.MORPHO,
    abi: morphoAbi,
    functionName: 'market',
    args: [MARKET_ID],
    chainId: giwaSepoliaNetwork.id,
  })

  const { data: ethPrice } = useReadContract({
    address: ADDRESSES.ORACLE,
    abi: oracleAbi,
    functionName: 'price',
    chainId: giwaSepoliaNetwork.id,
  })

  const { data: kimchiPremium } = useReadContract({
    address: ADDRESSES.ORACLE,
    abi: oracleAbi,
    functionName: 'kimchiPremium',
    chainId: giwaSepoliaNetwork.id,
  })

  const { data: upethBalance } = useReadContract({
    address: ADDRESSES.UPETH,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: giwaSepoliaNetwork.id,
  })

  const { data: upkrwBalance } = useReadContract({
    address: ADDRESSES.UPKRW,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: giwaSepoliaNetwork.id,
  })

  // Read user position
  const { data: positionData, refetch: refetchPosition } = useReadContract({
    address: ADDRESSES.MORPHO,
    abi: morphoAbi,
    functionName: 'position',
    args: address ? [MARKET_ID, address] : undefined,
    chainId: giwaSepoliaNetwork.id,
  })

  // === Contract Writes ===
  const { writeContract, data: txHash } = useWriteContract()
  const { isLoading: isTxPending, isSuccess: isTxSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  // === Effects ===
  useEffect(() => {
    if (ethPrice) {
      const price = Math.round(1 / Number(formatUnits(ethPrice, 18)) * 4566000)
      setMarketState(prev => ({ ...prev, ethPrice: price }))
    }
  }, [ethPrice])

  useEffect(() => {
    if (kimchiPremium) {
      const kimchi = Number(formatUnits(kimchiPremium, 18)) * 100
      setMarketState(prev => ({ ...prev, kimchi }))
    }
  }, [kimchiPremium])

  useEffect(() => {
    if (marketData && ethPrice) {
      const totalSupply = Number(formatUnits(marketData[0], 18))
      const tvl = Math.round(totalSupply * (1 / Number(formatUnits(ethPrice, 18))) * 4566000)
      setMarketState(prev => ({ ...prev, tvl }))
    }
  }, [marketData, ethPrice])

  useEffect(() => {
    if (upethBalance && upkrwBalance) {
      setWalletState({
        balance: {
          UPETH: Number(formatUnits(upethBalance, 18)),
          UPKRW: Number(formatUnits(upkrwBalance, 18))
        }
      })
    }
  }, [upethBalance, upkrwBalance])

  useEffect(() => {
    if (isTxSuccess) {
      if (txStep === 'approving') {
        // Approve 완료 -> 다음 단계로
        setTxStep('approved')
      } else if (txStep === 'executing') {
        // Supply/Borrow 완료
        setExecutionStatus('confirmed')
        refetchPosition()
        setTimeout(() => {
          setExecutionStatus('idle')
          setTxStep('idle')
          setInputAmount('')
          setCollateralAmount('')
          setSimulatedHF(null)
        }, 2000)
      }
    }
  }, [isTxSuccess, txStep, refetchPosition])

  // Update user position when data changes
  useEffect(() => {
    if (positionData && marketData) {
      const [supplyShares, borrowShares, collateral] = positionData
      
      // Calculate assets from shares
      // supplyAssets = supplyShares * totalSupplyAssets / totalSupplyShares
      const totalSupplyAssets = marketData[0]
      const totalSupplyShares = marketData[1]
      const totalBorrowAssets = marketData[2]
      const totalBorrowShares = marketData[3]
      
      let supplyAssets = 0
      let borrowAssets = 0
      
      if (totalSupplyShares > 0n) {
        supplyAssets = Number(supplyShares * totalSupplyAssets / totalSupplyShares) / 1e18
      }
      
      if (totalBorrowShares > 0n) {
        borrowAssets = Number(BigInt(borrowShares) * totalBorrowAssets / totalBorrowShares) / 1e18
      }
      
      setUserPosition({
        supplyShares,
        borrowShares: BigInt(borrowShares),
        collateral: BigInt(collateral),
        supplyAssets,
        borrowAssets
      })
    }
  }, [positionData, marketData])

  // === Computed Values ===
  const utilization = marketData && marketData[0] > 0n
    ? (Number(marketData[2]) / Number(marketData[0]) * 100)
    : 0
  const supplyApy = (utilization * 0.8).toFixed(1)
  const borrowApy = utilization.toFixed(1)

  const isKimchiRisk = marketState.kimchi > 3

  // === Handlers ===
  const navigate = (page: ViewType) => {
    setCurrentView(page)
    setSelection(null)
    setInputAmount('')
    setCollateralAmount('')
    setSimulatedHF(null)
  }

  const selectMarket = (marketId: MarketSelection) => {
    setSelection(marketId)
    setInputAmount('')
    setCollateralAmount('')
    setSimulatedHF(null)
  }

  const simulate = (value: string) => {
    setInputAmount(value)
    
    if (!value || parseFloat(value) === 0) {
      setSimulatedHF(null)
      return
    }

    // Mock calculation - in production, this would call the contract
    const hf = 1.35
    setSimulatedHF(hf)
  }

  const marketParams = {
    loanToken: ADDRESSES.UPETH,
    collateralToken: ADDRESSES.UPKRW,
    oracle: ADDRESSES.ORACLE,
    irm: ADDRESSES.IRM,
    lltv: 920000000000000000n
  }

  const execute = async () => {
    if (!isConnected || !selection || !inputAmount) return

    setIsExecuting(true)
    setExecutionStatus('broadcasting')

    try {
      const amount = parseUnits(inputAmount, 18)
      const isBorrow = selection === 'UPETH_BORROW'

      if (isBorrow) {
        // Borrow flow: 
        // 1. Approve UPKRW for collateral
        // 2. Supply collateral
        // 3. Borrow UPETH
        
        if (!collateralAmount) {
          alert('담보 금액을 입력하세요')
          setExecutionStatus('idle')
          setIsExecuting(false)
          return
        }

        const collateralAmt = parseUnits(collateralAmount, 18)
        
        // Step 1: Approve collateral
        setTxStep('approving')
        writeContract({
          address: ADDRESSES.UPKRW,
          abi: erc20Abi,
          functionName: 'approve',
          args: [ADDRESSES.MORPHO, collateralAmt],
        })
        
        // Note: 실제로는 approve tx 완료 후 supplyCollateral, 그 다음 borrow 해야함
        // 현재는 단순화해서 approve만 먼저 실행
        // TODO: multicall 또는 sequential tx 처리 필요
        
      } else {
        // Supply flow:
        // 1. Approve token
        // 2. Supply
        
        const token = selection === 'UPKRW' ? ADDRESSES.UPKRW : ADDRESSES.UPETH
        
        // Step 1: Approve
        setTxStep('approving')
        writeContract({
          address: token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [ADDRESSES.MORPHO, amount],
        })
      }
    } catch (error) {
      console.error('Transaction failed:', error)
      setExecutionStatus('idle')
      setTxStep('idle')
    } finally {
      setIsExecuting(false)
    }
  }

  // Execute after approve is done
  const executeAfterApprove = async () => {
    if (!isConnected || !selection || !inputAmount) return

    setTxStep('executing')
    const amount = parseUnits(inputAmount, 18)
    const isBorrow = selection === 'UPETH_BORROW'

    try {
      if (isBorrow) {
        const collateralAmt = parseUnits(collateralAmount, 18)
        
        // Supply collateral first, then borrow
        // For simplicity, just do supplyCollateral here
        // In production, you'd chain these or use multicall
        writeContract({
          address: ADDRESSES.MORPHO,
          abi: morphoAbi,
          functionName: 'supplyCollateral',
          args: [marketParams, collateralAmt, address!, '0x'],
        })
      } else {
        // Supply
        writeContract({
          address: ADDRESSES.MORPHO,
          abi: morphoAbi,
          functionName: 'supply',
          args: [marketParams, amount, 0n, address!, '0x'],
        })
      }
    } catch (error) {
      console.error('Execute failed:', error)
      setTxStep('idle')
      setExecutionStatus('idle')
    }
  }

  // === Panel Mode ===
  const getPanelMode = () => {
    if (!selection) return 'IDLE'
    if (selection === 'UPETH_BORROW') return 'BORROW'
    return 'SUPPLY'
  }

  const getPanelAsset = () => {
    if (!selection) return null
    if (selection === 'UPETH_BORROW') return 'UPETH'
    return selection
  }

  // ============ RENDER ============
  return (
    <div className="h-screen flex flex-col selection:bg-accent selection:text-black">
      {/* Noise Overlay */}
      <div className="noise-overlay" />
      
      {/* Background Grid & Glow */}
      <div className="fixed inset-0 bg-grid-pattern bg-[length:40px_40px] opacity-20 pointer-events-none z-0" />
      <div className="fixed top-0 left-0 w-full h-[500px] bg-eclipse-glow opacity-60 pointer-events-none z-0" />

      {/* ============ NAVIGATION ============ */}
      <nav className="h-16 border-b border-white/10 flex items-center justify-between px-6 z-40 bg-void/80 backdrop-blur-sm sticky top-0">
        <div className="flex items-baseline space-x-2">
          <span className="font-serif italic text-2xl tracking-wide font-bold text-white">Coin Billigi</span>
          <span className="font-mono text-[10px] text-secondary tracking-widest uppercase">by koracle</span>
        </div>
        
        <div className="hidden md:flex items-center space-x-8 text-sm font-medium text-secondary font-mono">
          <button 
            onClick={() => navigate('dashboard')}
            className={`hover:text-accent transition-colors ${currentView === 'dashboard' ? 'text-white' : ''}`}
          >
            PROTOCOL
          </button>
          <button 
            onClick={() => navigate('liquidate')}
            className={`hover:text-accent transition-colors ${currentView === 'liquidate' ? 'text-white' : ''}`}
          >
            LIQUIDATION <span className="text-[10px] text-kimchi align-top ml-0.5">●</span>
          </button>
          <button className="hover:text-accent transition-colors">DOCS</button>
        </div>

        <div className="flex items-center space-x-4">
          {/* Kimchi Indicator */}
          <div className="hidden lg:flex items-center px-3 py-1 border border-white/10 rounded-sm bg-white/5 space-x-3">
            <div className="flex items-center space-x-1.5">
              <div className={`w-1 h-1 rounded-full ${isKimchiRisk ? 'bg-kimchi' : 'bg-accent'} animate-pulse`} />
              <span className="text-[10px] uppercase tracking-wider text-secondary">Kimchi Prem.</span>
            </div>
            <span className={`text-xs font-mono border-l border-white/10 pl-3 ${isKimchiRisk ? 'text-kimchi' : 'text-accent'}`}>
              {marketState.kimchi.toFixed(1)}%
            </span>
          </div>

          <appkit-button />
        </div>
      </nav>

      {/* ============ MAIN LAYOUT ============ */}
      <main className="flex-1 flex overflow-hidden z-10 relative">
        {/* Center Stage (Content) */}
        <div className="flex-1 overflow-y-auto relative scroll-smooth" id="main-scroll">
          <div className="max-w-[1400px] mx-auto p-6 md:p-12 pb-32">
            <div className="space-y-12" id="view-container">
              
              {/* ============ DASHBOARD VIEW ============ */}
              {currentView === 'dashboard' && (
                <div className="fade-in space-y-16">
                  {/* Hero Header */}
                  <section className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-end border-b border-white/5 pb-12">
                    <div className="lg:col-span-7">
                      <h1 className="text-6xl lg:text-8xl font-serif italic mb-6 leading-[0.9] tracking-tight">
                        Trustless <br />
                        <span className="not-italic font-sans font-light text-secondary tracking-normal text-5xl lg:text-7xl">
                          Liquidity
                        </span>
                      </h1>
                      <div className="flex space-x-12 font-mono text-xs tracking-widest text-secondary mt-8">
                        <div className="flex flex-col">
                          <span className="mb-2 uppercase opacity-50">Market Size</span>
                          <span className="text-2xl text-white font-light">${fmt(marketState.tvl)}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="mb-2 uppercase opacity-50">Kimchi Premium</span>
                          <span className={`text-2xl font-light ${isKimchiRisk ? 'text-kimchi' : 'text-accent'}`}>
                            {marketState.kimchi.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Visual Data Block */}
                    <div className="lg:col-span-5 flex flex-col justify-end space-y-4">
                      <div className="w-full h-32 border border-white/10 bg-white/[0.02] relative overflow-hidden group hover:border-accent/30 transition-colors">
                        <div className="absolute inset-0 flex items-center justify-between px-8">
                          <div className="text-left">
                            <div className="font-mono text-[10px] uppercase text-secondary mb-1">Supply APY</div>
                            <div className="text-4xl font-mono text-white">{supplyApy}%</div>
                          </div>
                          <div className="h-12 w-px bg-white/10" />
                          <div className="text-right">
                            <div className="font-mono text-[10px] uppercase text-secondary mb-1">Borrow APY</div>
                            <div className="text-4xl font-mono text-accent">{borrowApy}%</div>
                          </div>
                        </div>
                        {/* Scanline effect */}
                        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/5 to-transparent h-1 w-full animate-scanline pointer-events-none" />
                      </div>
                    </div>
                  </section>

                  {/* Market Grid */}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-16">
                    {/* Earn / Supply */}
                    <div className="space-y-8">
                      <div className="flex items-center justify-between border-b border-white/10 pb-4">
                        <h2 className="font-sans font-medium text-2xl flex items-center">
                          <span className="w-2 h-2 bg-accent rounded-full mr-3" />
                          Earn
                        </h2>
                        <span className="font-mono text-[10px] uppercase text-secondary">Asset to Supply</span>
                      </div>

                      <div>
                        {/* Header */}
                        <div className="grid grid-cols-4 font-mono text-[10px] uppercase text-secondary px-4 pb-4 opacity-50">
                          <span>Asset</span>
                          <span className="text-right">APY</span>
                          <span className="text-right">Balance</span>
                          <span />
                        </div>

                        {/* UPETH Card */}
                        <div
                          onClick={() => selectMarket('UPETH')}
                          className={`group grid grid-cols-4 items-center p-5 border cursor-pointer transition-all
                            ${selection === 'UPETH' 
                              ? 'border-accent bg-white/[0.04]' 
                              : 'border-white/5 hover:border-accent bg-white/[0.02] hover:bg-white/[0.04]'}`}
                        >
                          <div className="flex items-center space-x-4">
                            {icons.UPETH}
                            <span className="font-bold text-lg">UPETH</span>
                          </div>
                          <div className="text-right font-mono text-accent text-lg">{supplyApy}%</div>
                          <div className="text-right font-mono text-secondary">
                            {isConnected ? fmt(walletState.balance.UPETH) : '-'}
                          </div>
                          <div className="flex justify-end">
                            <span className="material-symbols-outlined text-secondary group-hover:text-accent transition-colors">
                              arrow_forward
                            </span>
                          </div>
                        </div>

                        {/* UPKRW Card */}
                        <div
                          onClick={() => selectMarket('UPKRW')}
                          className={`group grid grid-cols-4 items-center p-5 border-b border-x cursor-pointer transition-all mt-[-1px]
                            ${selection === 'UPKRW'
                              ? 'border-accent bg-white/[0.04]'
                              : 'border-white/5 hover:border-white/20 bg-white/[0.01]'}`}
                        >
                          <div className="flex items-center space-x-4">
                            {icons.UPKRW}
                            <span className="font-bold text-lg">UPKRW</span>
                          </div>
                          <div className="text-right font-mono text-white text-lg">2.1%</div>
                          <div className="text-right font-mono text-secondary">
                            {isConnected ? fmt(walletState.balance.UPKRW) : '-'}
                          </div>
                          <div className="flex justify-end">
                            <span className="material-symbols-outlined text-secondary group-hover:text-white transition-colors">
                              arrow_forward
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Borrow */}
                    <div className="space-y-8">
                      <div className="flex items-center justify-between border-b border-white/10 pb-4">
                        <h2 className="font-sans font-medium text-2xl flex items-center">
                          <span className="w-2 h-2 bg-white rounded-full mr-3" />
                          Borrow
                        </h2>
                        <span className="font-mono text-[10px] uppercase text-secondary">Asset to Borrow</span>
                      </div>

                      <div>
                        {/* Header */}
                        <div className="grid grid-cols-4 font-mono text-[10px] uppercase text-secondary px-4 pb-4 opacity-50">
                          <span>Asset</span>
                          <span className="text-right">Max LTV</span>
                          <span className="text-right">Liquidity</span>
                          <span />
                        </div>

                        {/* UPETH Borrow */}
                        <div
                          onClick={() => selectMarket('UPETH_BORROW')}
                          className={`group grid grid-cols-4 items-center p-5 border cursor-pointer transition-all
                            ${selection === 'UPETH_BORROW'
                              ? 'border-white bg-white/[0.05]'
                              : 'border-white/5 hover:border-white hover:bg-white/[0.05] bg-white/[0.02]'}`}
                        >
                          <div className="flex items-center space-x-4">
                            {icons.UPETH}
                            <span className="font-bold text-lg">UPETH</span>
                          </div>
                          <div className="text-right font-mono text-secondary text-lg">92%</div>
                          <div className="text-right font-mono text-green-400 text-xs uppercase tracking-widest pt-1">Deep</div>
                          <div className="flex justify-end">
                            <span className="material-symbols-outlined text-secondary group-hover:text-white transition-colors">
                              arrow_forward
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* System Status */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-8 border-t border-white/5">
                    <div className="p-4 border border-white/5 bg-white/[0.01] flex items-center space-x-4">
                      <span className="material-symbols-outlined text-secondary">security</span>
                      <div>
                        <div className="text-xs text-secondary uppercase tracking-wider mb-1">Audit Status</div>
                        <div className="text-sm font-mono text-white">Secured by Morpho Blue</div>
                      </div>
                    </div>
                    <div className="p-4 border border-white/5 bg-white/[0.01] flex items-center space-x-4">
                      <span className="material-symbols-outlined text-secondary">public</span>
                      <div>
                        <div className="text-xs text-secondary uppercase tracking-wider mb-1">Oracle</div>
                        <div className="text-sm font-mono text-white">Chainlink + KRW Aggregator</div>
                      </div>
                    </div>
                    <div className="p-4 border border-white/5 bg-white/[0.01] flex items-center space-x-4">
                      <span className="material-symbols-outlined text-kimchi">warning</span>
                      <div>
                        <div className="text-xs text-secondary uppercase tracking-wider mb-1">Risk Parameter</div>
                        <div className="text-sm font-mono text-kimchi">Dynamic LTV Active</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ============ LIQUIDATION VIEW ============ */}
              {currentView === 'liquidate' && (
                <div className="fade-in space-y-8">
                  <div className="border-b border-white/10 pb-6 flex flex-col md:flex-row justify-between md:items-end gap-4">
                    <div>
                      <h1 className="text-4xl font-serif italic mb-2">
                        Liquidation <span className="not-italic font-sans font-light text-secondary">Terminal</span>
                      </h1>
                      <p className="font-mono text-xs text-secondary max-w-md mt-2">
                        Monitor undercollateralized positions. Liquidations are atomic and permissionless.
                        <br /><span className="text-kimchi">Kimchi Premium affects liquidation thresholds.</span>
                      </p>
                    </div>
                    <div className="text-left md:text-right">
                      <div className="font-mono text-xs text-secondary mb-1">ORACLE PRICE</div>
                      <div className="font-mono text-xl text-white">1 ETH = {fmt(marketState.ethPrice)} KRW</div>
                    </div>
                  </div>

                  {/* Monitor Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="p-6 border border-white/10 bg-panel relative overflow-hidden">
                      <div className="text-xs uppercase font-mono text-secondary mb-2">Kimchi Premium</div>
                      <div className={`text-4xl font-mono ${isKimchiRisk ? 'text-kimchi animate-pulse' : 'text-accent'}`}>
                        {marketState.kimchi.toFixed(1)}%
                      </div>
                      <div className="mt-4 text-[10px] text-secondary border-t border-white/10 pt-2 flex justify-between">
                        <span>THRESHOLD</span>
                        <span className="text-white">&gt; 3.0%</span>
                      </div>
                    </div>
                    <div className="p-6 border border-white/10 bg-panel">
                      <div className="text-xs uppercase font-mono text-secondary mb-2">Total Debt at Risk</div>
                      <div className="text-4xl font-mono text-white">$420.5K</div>
                      <div className="mt-4 text-[10px] text-secondary border-t border-white/10 pt-2 flex justify-between">
                        <span>POSITIONS</span>
                        <span className="text-white">12</span>
                      </div>
                    </div>
                    <div className="p-6 border border-white/10 bg-panel">
                      <div className="text-xs uppercase font-mono text-secondary mb-2">My Liquidation Bonus</div>
                      <div className="text-4xl font-mono text-white">5.0%</div>
                      <div className="mt-4 text-[10px] text-secondary border-t border-white/10 pt-2 flex justify-between">
                        <span>EST. PROFIT</span>
                        <span className="text-accent">$2,100</span>
                      </div>
                    </div>
                  </div>

                  {/* Data Grid */}
                  <div className="w-full overflow-x-auto border border-white/10 bg-panel">
                    <table className="w-full text-left border-collapse">
                      <thead className="font-mono text-[10px] uppercase text-secondary bg-white/[0.02]">
                        <tr>
                          <th className="p-4 font-normal">Position ID</th>
                          <th className="p-4 font-normal text-right">Collateral (UPKRW)</th>
                          <th className="p-4 font-normal text-right">Debt (UPETH)</th>
                          <th className="p-4 font-normal text-right">Health Factor</th>
                          <th className="p-4 font-normal text-right">Status</th>
                          <th className="p-4 font-normal text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="text-sm font-mono divide-y divide-white/5">
                        {[1, 2, 3, 4].map((i) => {
                          const hf = (0.9 + i * 0.08).toFixed(2)
                          const risky = parseFloat(hf) < 1.05
                          return (
                            <tr key={i} className="hover:bg-white/5 transition-colors group">
                              <td className="p-4 text-secondary group-hover:text-white transition-colors">
                                0x7a...8b{i}2
                              </td>
                              <td className="p-4 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  {fmt(45000000 + i * 1000000)}
                                  {icons.UPKRW_SM}
                                </div>
                              </td>
                              <td className="p-4 text-right text-white">{(12.5 - i).toFixed(2)}</td>
                              <td className={`p-4 text-right font-bold ${risky ? 'text-red-500' : 'text-yellow-500'}`}>
                                {hf}
                              </td>
                              <td className={`p-4 text-right text-[10px] uppercase tracking-widest ${risky ? 'text-red-500' : 'text-secondary'}`}>
                                {risky ? 'LIQUIDATABLE' : 'RISKY'}
                              </td>
                              <td className="p-4 text-right">
                                <button
                                  disabled={!risky}
                                  className="px-4 py-2 border border-white/20 hover:bg-red-500 hover:border-red-500 hover:text-white transition-all text-[10px] font-bold uppercase disabled:opacity-20 disabled:cursor-not-allowed"
                                >
                                  Liquidate
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>

        {/* ============ RIGHT ACTION PANEL ============ */}
        <aside className="w-[420px] border-l border-white/10 bg-panel flex-col hidden lg:flex shadow-[-20px_0_40px_rgba(0,0,0,0.5)] z-20">
          <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/[0.02]">
            <h3 className="font-mono text-xs uppercase tracking-widest text-secondary flex items-center">
              <span className="material-symbols-outlined text-sm mr-2 text-accent">terminal</span>
              Terminal // <span className={`ml-1 ${getPanelMode() === 'BORROW' ? 'text-white' : 'text-accent'}`}>
                {getPanelMode()} {getPanelAsset() || ''}
              </span>
            </h3>
            <div className="flex space-x-1 opacity-50">
              <div className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
              <div className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
              <div className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
            </div>
          </div>

          {/* Panel Content */}
          <div className="flex-1 p-8 relative flex flex-col" id="right-panel-content">
            {!selection ? (
              /* Idle State */
              <div className="h-full flex flex-col items-center justify-center text-center opacity-30 space-y-6">
                <div className="w-16 h-16 border border-dashed border-white rounded-full flex items-center justify-center">
                  <span className="material-symbols-outlined text-3xl font-light">data_exploration</span>
                </div>
                <p className="font-mono text-xs max-w-[200px] leading-relaxed">
                  Select a market from the protocol dashboard to initialize transaction sequence.
                </p>
              </div>
            ) : (
              /* Active State */
              <div className="fade-in h-full flex flex-col pt-2">
                {/* Icon Header */}
                <div className="flex items-center space-x-4 mb-8">
                  <div className="w-12 h-12 flex items-center justify-center border border-white/10 rounded-full bg-white/5">
                    {getPanelAsset() === 'UPETH' ? icons.UPETH_LG : icons.UPKRW_LG}
                  </div>
                  <div>
                    <h4 className="font-bold text-xl">{getPanelAsset()}</h4>
                    <div className="text-[10px] font-mono text-secondary uppercase tracking-widest">
                      {getPanelAsset() === 'UPETH' ? 'Ethereum Mainnet' : 'KRW Stablecoin'}
                    </div>
                  </div>
                </div>

                {/* Input */}
                <div className="relative group mb-8">
                  <div className="flex justify-between font-mono text-[10px] text-secondary mb-2 uppercase">
                    <label>Amount</label>
                    <span>
                      Wallet: {isConnected 
                        ? fmt(getPanelAsset() === 'UPKRW' ? walletState.balance.UPKRW : walletState.balance.UPETH)
                        : '0.00'}
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      value={inputAmount}
                      onChange={(e) => simulate(e.target.value)}
                      className="w-full bg-transparent border-b border-white/20 py-4 text-4xl font-mono text-white focus:outline-none focus:border-accent transition-colors placeholder-white/10"
                      placeholder="0.00"
                    />
                    <button 
                      onClick={() => {
                        const max = getPanelAsset() === 'UPKRW' 
                          ? walletState.balance.UPKRW 
                          : walletState.balance.UPETH
                        simulate(max.toString())
                      }}
                      className="absolute right-0 top-1/2 -translate-y-1/2 text-[10px] font-bold bg-white/10 hover:bg-white/20 text-white px-2 py-1 uppercase transition-colors"
                    >
                      MAX
                    </button>
                  </div>
                </div>

                {/* Collateral Input (for Borrow) */}
                {selection === 'UPETH_BORROW' && (
                  <div className="relative group mb-8 fade-in">
                    <label className="block font-mono text-[10px] text-secondary mb-2 uppercase">
                      Collateral (UPKRW)
                    </label>
                    <div className="flex items-center space-x-2 border-b border-white/20 pb-2">
                      {icons.UPKRW}
                      <input
                        type="number"
                        value={collateralAmount}
                        onChange={(e) => setCollateralAmount(e.target.value)}
                        className="w-full bg-transparent py-2 text-xl font-mono text-white focus:outline-none placeholder-white/10"
                        placeholder="0"
                      />
                    </div>
                  </div>
                )}

                {/* Simulation Stats */}
                <div className="space-y-4 mb-auto bg-white/[0.02] p-4 border border-white/5">
                  <div className="flex justify-between text-sm">
                    <span className="text-secondary font-mono text-xs uppercase">Rate Strategy</span>
                    <span className="font-mono text-accent">Adaptive</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-secondary font-mono text-xs uppercase">Est. APY</span>
                    <span className="font-mono text-white">
                      {selection === 'UPETH_BORROW' ? borrowApy : supplyApy}%
                    </span>
                  </div>
                  
                  {selection === 'UPETH_BORROW' && (
                    <>
                      <div className="h-px bg-white/10 my-2" />
                      <div className="flex justify-between text-sm">
                        <span className="text-secondary font-mono text-xs uppercase">Health Factor</span>
                        <span className="font-mono text-white">
                          {simulatedHF ? simulatedHF.toFixed(2) : '--'}
                        </span>
                      </div>
                      <div className="w-full h-1 bg-zinc-800 mt-2">
                        <div
                          className={`h-full transition-all duration-500 ${
                            simulatedHF && simulatedHF < 1.1 ? 'bg-red-500' : 'bg-green-400'
                          }`}
                          style={{ width: simulatedHF ? `${Math.min(simulatedHF / 2 * 100, 100)}%` : '0%' }}
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* My Position */}
                {isConnected && (userPosition.supplyAssets > 0 || userPosition.borrowAssets > 0 || userPosition.collateral > 0n) && (
                  <div className="mb-4 p-3 border border-accent/30 bg-accent/5">
                    <div className="font-mono text-[10px] uppercase text-accent mb-2">My Position</div>
                    <div className="space-y-1 text-xs">
                      {userPosition.supplyAssets > 0 && (
                        <div className="flex justify-between">
                          <span className="text-secondary">Supplied</span>
                          <span className="text-white">{userPosition.supplyAssets.toFixed(4)} UPETH</span>
                        </div>
                      )}
                      {userPosition.borrowAssets > 0 && (
                        <div className="flex justify-between">
                          <span className="text-secondary">Borrowed</span>
                          <span className="text-white">{userPosition.borrowAssets.toFixed(4)} UPETH</span>
                        </div>
                      )}
                      {userPosition.collateral > 0n && (
                        <div className="flex justify-between">
                          <span className="text-secondary">Collateral</span>
                          <span className="text-white">{fmt(Number(userPosition.collateral) / 1e18)} UPKRW</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="mt-8 space-y-3">
                  {txStep === 'approved' ? (
                    <button
                      onClick={executeAfterApprove}
                      disabled={isTxPending}
                      className="w-full py-5 font-bold font-mono uppercase tracking-widest text-sm transition-colors bg-accent text-black hover:bg-white disabled:opacity-50"
                    >
                      {isTxPending ? 'EXECUTING...' : selection === 'UPETH_BORROW' ? '2. Supply Collateral' : '2. Confirm Supply'}
                    </button>
                  ) : (
                    <button
                      onClick={execute}
                      disabled={!isConnected || isExecuting || isTxPending || txStep === 'executing'}
                      className={`w-full py-5 font-bold font-mono uppercase tracking-widest text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                        ${executionStatus === 'confirmed' 
                          ? 'bg-accent text-black' 
                          : 'bg-white text-black hover:bg-accent'}`}
                    >
                      {!isConnected 
                        ? 'Connect Wallet'
                        : txStep === 'approving'
                          ? 'APPROVING...'
                          : txStep === 'executing'
                            ? 'EXECUTING...'
                            : executionStatus === 'confirmed'
                              ? 'CONFIRMED'
                              : selection === 'UPETH_BORROW' 
                                ? '1. Approve Collateral' 
                                : '1. Approve Token'}
                    </button>
                  )}
                  
                  {selection === 'UPETH_BORROW' && (
                    <p className="text-[10px] text-center text-secondary mt-2 font-mono">
                      Max LTV 92% • Kimchi Risk: Active
                    </p>
                  )}

                  <button
                    onClick={() => selectMarket(null)}
                    className="w-full py-2 text-xs text-secondary hover:text-white transition-colors font-mono"
                  >
                    [ Cancel ]
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  )
}
