import { useState, useEffect, useRef } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { formatUnits, parseUnits } from 'viem'
import { ADDRESSES, MARKET_ID, morphoAbi, oracleAbi, erc20Abi, marketParams } from '../config/contracts'
import { giwaSepoliaNetwork } from '../config/appkit'

// ============ TYPES ============
type ViewType = 'dashboard' | 'liquidate'
type MarketSelection = 'UPETH' | 'UPKRW' | 'UPETH_BORROW' | null
type ActionMode = 'supply' | 'withdraw'

type TxStep = 'idle' | 'approving' | 'approved' | 'supplying_collateral' | 'collateral_supplied' | 'borrowing' | 'executing'

interface UserPosition {
  supplyShares: bigint
  borrowShares: bigint
  collateral: bigint
  supplyAssets: number
  borrowAssets: number
}

// ============ CONSTANTS ============
const ORACLE_PRICE_SCALE = 10n ** 36n
const WAD = 10n ** 18n

// ============ UTILS ============
const fmt = (n: number) => new Intl.NumberFormat('en-US').format(n)

// ============ MAIN COMPONENT ============
export default function Dashboard() {
  const { address, isConnected } = useAccount()
  
  // === Local State ===
  const [currentView, setCurrentView] = useState<ViewType>('dashboard')
  const [selection, setSelection] = useState<MarketSelection>(null)
  const [actionMode, setActionMode] = useState<ActionMode>('supply')
  const [inputAmount, setInputAmount] = useState('')
  const [collateralAmount, setCollateralAmount] = useState('')
  const [simulatedHF, setSimulatedHF] = useState<number | null>(null)
  const [executionStatus, setExecutionStatus] = useState<'idle' | 'broadcasting' | 'confirmed'>('idle')
  const [txStep, setTxStep] = useState<TxStep>('idle')
  
  const approvedCollateralRef = useRef<bigint>(0n)
  const borrowAmountRef = useRef<bigint>(0n)

  // Market State
  const [ethPrice, setEthPrice] = useState(4566000)
  const [kimchi, setKimchi] = useState(2.4)
  const [tvl, setTvl] = useState(0)
  const [upethBalance, setUpethBalance] = useState(0)
  const [upkrwBalance, setUpkrwBalance] = useState(0)

  const [userPosition, setUserPosition] = useState<UserPosition>({
    supplyShares: 0n,
    borrowShares: 0n,
    collateral: 0n,
    supplyAssets: 0,
    borrowAssets: 0
  })

  // === Contract Reads ===
  const { data: marketData } = useReadContract({
    address: ADDRESSES.MORPHO,
    abi: morphoAbi,
    functionName: 'market',
    args: [MARKET_ID],
    chainId: giwaSepoliaNetwork.id,
  })

  const { data: oraclePrice } = useReadContract({
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

  const { data: upethBalanceData, refetch: refetchUpethBalance } = useReadContract({
    address: ADDRESSES.UPETH,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: giwaSepoliaNetwork.id,
  })

  const { data: upkrwBalanceData, refetch: refetchUpkrwBalance } = useReadContract({
    address: ADDRESSES.UPKRW,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: giwaSepoliaNetwork.id,
  })

  const { data: positionData, refetch: refetchPosition } = useReadContract({
    address: ADDRESSES.MORPHO,
    abi: morphoAbi,
    functionName: 'position',
    args: address ? [MARKET_ID, address] : undefined,
    chainId: giwaSepoliaNetwork.id,
  })

  // === Contract Writes ===
  const { writeContract, data: txHash, reset: resetWrite } = useWriteContract()
  const { isLoading: isTxPending, isSuccess: isTxSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  // === Effects ===
  
  // Oracle price calculation
  // oraclePrice = (1 UPKRW in UPETH) * 1e36
  // So: 1 ETH in KRW = 1e36 / oraclePrice
  useEffect(() => {
    if (oraclePrice && oraclePrice > 0n) {
      const ethInKrw = Number(ORACLE_PRICE_SCALE / oraclePrice)
      setEthPrice(Math.round(ethInKrw))
    }
  }, [oraclePrice])

  useEffect(() => {
    if (kimchiPremium) {
      setKimchi(Number(formatUnits(kimchiPremium, 18)) * 100)
    }
  }, [kimchiPremium])

  // TVL calculation: totalSupply (in UPETH) * ETH price in KRW
  useEffect(() => {
    if (marketData && oraclePrice && oraclePrice > 0n) {
      const totalSupplyAssets = Number(formatUnits(marketData[0], 18))
      const ethInKrw = Number(ORACLE_PRICE_SCALE / oraclePrice)
      const calculatedTvl = Math.round(totalSupplyAssets * ethInKrw)
      setTvl(calculatedTvl)
    }
  }, [marketData, oraclePrice])

  useEffect(() => {
    if (upethBalanceData) setUpethBalance(Number(formatUnits(upethBalanceData, 18)))
    if (upkrwBalanceData) setUpkrwBalance(Number(formatUnits(upkrwBalanceData, 18)))
  }, [upethBalanceData, upkrwBalanceData])

  useEffect(() => {
    if (isTxSuccess) {
      if (txStep === 'approving') {
        setTxStep('approved')
        resetWrite()
      } else if (txStep === 'supplying_collateral') {
        setTxStep('collateral_supplied')
        resetWrite()
      } else if (txStep === 'borrowing' || txStep === 'executing') {
        setExecutionStatus('confirmed')
        refetchPosition()
        refetchUpethBalance()
        refetchUpkrwBalance()
        setTimeout(() => {
          setExecutionStatus('idle')
          setTxStep('idle')
          setInputAmount('')
          setCollateralAmount('')
          setSimulatedHF(null)
          approvedCollateralRef.current = 0n
          borrowAmountRef.current = 0n
          resetWrite()
        }, 2000)
      }
    }
  }, [isTxSuccess, txStep, refetchPosition, refetchUpethBalance, refetchUpkrwBalance, resetWrite])

  useEffect(() => {
    if (positionData && marketData) {
      const [supplyShares, borrowShares, collateral] = positionData
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
  const isKimchiRisk = kimchi > 3

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
    setActionMode('supply')
    setInputAmount('')
    setCollateralAmount('')
    setSimulatedHF(null)
    setTxStep('idle')
    setExecutionStatus('idle')
    approvedCollateralRef.current = 0n
    borrowAmountRef.current = 0n
  }

  const calculateHealthFactor = (newBorrowETH: number, newCollateralKRW: number): number | null => {
    if (!oraclePrice) return null
    
    const existingCollateral = userPosition.collateral
    const existingBorrow = parseUnits(userPosition.borrowAssets.toString(), 18)
    
    const newCollateralBigInt = parseUnits(newCollateralKRW.toString(), 18)
    const newBorrowBigInt = parseUnits(newBorrowETH.toString(), 18)
    
    const totalCollateral = existingCollateral + newCollateralBigInt
    const totalBorrow = existingBorrow + newBorrowBigInt
    
    if (totalBorrow <= 0n) return null
    if (totalCollateral <= 0n) return null
    
    const lltv = marketParams.lltv
    const maxBorrow = (totalCollateral * oraclePrice * lltv) / (ORACLE_PRICE_SCALE * WAD)
    const hfScaled = (maxBorrow * WAD) / totalBorrow
    const hf = Number(hfScaled) / 1e18
    
    return hf
  }

  const simulate = (value: string) => {
    setInputAmount(value)
    if (!value || parseFloat(value) === 0) {
      setSimulatedHF(null)
      return
    }
    
    if (selection === 'UPETH_BORROW') {
      const borrowAmount = parseFloat(value)
      const collateral = parseFloat(collateralAmount) || 0
      const hf = calculateHealthFactor(borrowAmount, collateral)
      setSimulatedHF(hf)
    } else {
      setSimulatedHF(null)
    }
  }

  // Execute supply flow
  const executeSupply = async () => {
    if (!isConnected || !selection || !inputAmount) return

    try {
      const amount = parseUnits(inputAmount, 18)
      const isBorrow = selection === 'UPETH_BORROW'

      if (isBorrow) {
        if (!collateralAmount) {
          alert('담보 금액을 입력하세요')
          return
        }
        const collateralAmt = parseUnits(collateralAmount, 18)
        approvedCollateralRef.current = collateralAmt
        borrowAmountRef.current = amount
        setTxStep('approving')
        writeContract({
          address: ADDRESSES.UPKRW,
          abi: erc20Abi,
          functionName: 'approve',
          args: [ADDRESSES.MORPHO, collateralAmt],
        })
      } else {
        const token = selection === 'UPKRW' ? ADDRESSES.UPKRW : ADDRESSES.UPETH
        approvedCollateralRef.current = amount
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
      setTxStep('idle')
    }
  }

  // Execute withdraw flow (no approve needed)
  const executeWithdraw = async () => {
    if (!isConnected || !selection || !inputAmount) return

    try {
      const amount = parseUnits(inputAmount, 18)

      if (selection === 'UPETH') {
        // Withdraw supplied UPETH
        setTxStep('executing')
        writeContract({
          address: ADDRESSES.MORPHO,
          abi: morphoAbi,
          functionName: 'withdraw',
          args: [marketParams, amount, 0n, address!, address!],
        })
      } else if (selection === 'UPKRW') {
        // Withdraw collateral UPKRW - check Health Factor first
        if (userPosition.borrowAssets > 0 && oraclePrice) {
          const remainingCollateral = userPosition.collateral - amount
          if (remainingCollateral < 0n) {
            alert('인출 금액이 담보보다 큽니다')
            return
          }
          const existingBorrow = parseUnits(userPosition.borrowAssets.toString(), 18)
          const lltv = marketParams.lltv
          const maxBorrow = (remainingCollateral * oraclePrice * lltv) / (ORACLE_PRICE_SCALE * WAD)
          if (existingBorrow > maxBorrow) {
            alert('Health Factor가 1 미만이 됩니다. 먼저 대출을 상환하세요.')
            return
          }
        }
        setTxStep('executing')
        writeContract({
          address: ADDRESSES.MORPHO,
          abi: morphoAbi,
          functionName: 'withdrawCollateral',
          args: [marketParams, amount, address!, address!],
        })
      } else if (selection === 'UPETH_BORROW') {
        // Repay borrowed UPETH (needs approve first)
        approvedCollateralRef.current = amount
        setTxStep('approving')
        writeContract({
          address: ADDRESSES.UPETH,
          abi: erc20Abi,
          functionName: 'approve',
          args: [ADDRESSES.MORPHO, amount],
        })
      }
    } catch (error) {
      console.error('Withdraw failed:', error)
      setTxStep('idle')
    }
  }

  const executeAfterApprove = async () => {
    if (!isConnected || !selection) return
    
    const amount = approvedCollateralRef.current
    if (amount === 0n) {
      console.error('No approved amount stored')
      return
    }

    try {
      if (actionMode === 'withdraw' && selection === 'UPETH_BORROW') {
        // Repay borrowed UPETH
        setTxStep('executing')
        writeContract({
          address: ADDRESSES.MORPHO,
          abi: morphoAbi,
          functionName: 'repay',
          args: [marketParams, amount, 0n, address!, '0x' as `0x${string}`],
        })
      } else if (selection === 'UPETH') {
        setTxStep('executing')
        writeContract({
          address: ADDRESSES.MORPHO,
          abi: morphoAbi,
          functionName: 'supply',
          args: [marketParams, amount, 0n, address!, '0x' as `0x${string}`],
        })
      } else if (selection === 'UPKRW') {
        setTxStep('executing')
        writeContract({
          address: ADDRESSES.MORPHO,
          abi: morphoAbi,
          functionName: 'supplyCollateral',
          args: [marketParams, amount, address!, '0x' as `0x${string}`],
        })
      } else if (selection === 'UPETH_BORROW') {
        setTxStep('supplying_collateral')
        writeContract({
          address: ADDRESSES.MORPHO,
          abi: morphoAbi,
          functionName: 'supplyCollateral',
          args: [marketParams, amount, address!, '0x' as `0x${string}`],
        })
      }
    } catch (error) {
      console.error('Execute failed:', error)
      setTxStep('idle')
      setExecutionStatus('idle')
    }
  }

  const executeBorrow = async () => {
    if (!isConnected || selection !== 'UPETH_BORROW') return
    
    const borrowAmount = borrowAmountRef.current
    if (borrowAmount === 0n) {
      console.error('No borrow amount stored')
      return
    }

    setTxStep('borrowing')

    try {
      writeContract({
        address: ADDRESSES.MORPHO,
        abi: morphoAbi,
        functionName: 'borrow',
        args: [marketParams, borrowAmount, 0n, address!, address!],
      })
    } catch (error) {
      console.error('Borrow failed:', error)
      setTxStep('idle')
      setExecutionStatus('idle')
    }
  }

  const getPanelMode = () => {
    if (!selection) return 'IDLE'
    if (selection === 'UPETH_BORROW') {
      return actionMode === 'withdraw' ? 'REPAY UPETH' : 'BORROW UPETH'
    }
    return actionMode === 'withdraw' ? `WITHDRAW ${selection}` : `SUPPLY ${selection}`
  }

  const getPanelAsset = () => {
    if (!selection) return null
    if (selection === 'UPETH_BORROW') return 'UPETH'
    return selection
  }

  const getButtonText = () => {
    if (!isConnected) return 'Connect Wallet'
    
    if (actionMode === 'withdraw') {
      if (selection === 'UPETH_BORROW') {
        switch (txStep) {
          case 'approving': return 'APPROVING...'
          case 'approved': return '2. Confirm Repay'
          case 'executing': return 'REPAYING...'
          default: return '1. Approve UPETH'
        }
      } else {
        switch (txStep) {
          case 'executing': return 'WITHDRAWING...'
          default: return 'Withdraw'
        }
      }
    }
    
    if (selection === 'UPETH_BORROW') {
      switch (txStep) {
        case 'approving': return 'APPROVING...'
        case 'approved': return '2. Supply Collateral'
        case 'supplying_collateral': return 'SUPPLYING...'
        case 'collateral_supplied': return '3. Borrow UPETH'
        case 'borrowing': return 'BORROWING...'
        default: return '1. Approve Collateral'
      }
    } else {
      switch (txStep) {
        case 'approving': return 'APPROVING...'
        case 'approved': return '2. Confirm Supply'
        case 'executing': return 'EXECUTING...'
        default: return '1. Approve Token'
      }
    }
  }

  const handleButtonClick = () => {
    if (actionMode === 'withdraw') {
      if (txStep === 'approved') {
        executeAfterApprove()
      } else if (txStep === 'idle') {
        executeWithdraw()
      }
    } else {
      if (txStep === 'approved') {
        executeAfterApprove()
      } else if (txStep === 'collateral_supplied') {
        executeBorrow()
      } else if (txStep === 'idle') {
        executeSupply()
      }
    }
  }

  const isButtonDisabled = () => {
    if (!isConnected) return true
    if (isTxPending) return true
    if (txStep === 'approving' || txStep === 'supplying_collateral' || txStep === 'borrowing' || txStep === 'executing') return true
    if (executionStatus === 'confirmed') return true
    return false
  }

  const getMaxAmount = () => {
    if (actionMode === 'withdraw') {
      if (selection === 'UPETH') return userPosition.supplyAssets
      if (selection === 'UPKRW') return Number(userPosition.collateral) / 1e18
      if (selection === 'UPETH_BORROW') return userPosition.borrowAssets
    } else {
      if (selection === 'UPETH' || selection === 'UPETH_BORROW') return upethBalance
      if (selection === 'UPKRW') return upkrwBalance
    }
    return 0
  }

  // ============ RENDER ============
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,700;1,400;1,700&family=Inter:wght@300;400;500;600&display=swap');
        .font-serif { font-family: 'Cormorant Garamond', Georgia, serif; }
        .font-sans { font-family: 'Inter', system-ui, sans-serif; }
        @keyframes scanline { 0% { transform: translateY(-100%); } 100% { transform: translateY(100vh); } }
        @keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-scanline { animation: scanline 8s linear infinite; }
        .fade-in { animation: fade-in 0.5s ease-out forwards; }
        .noise-overlay { position: fixed; inset: 0; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%' height='100%' filter='url(%23noise)'/%3E%3C/svg%3E"); opacity: 0.03; pointer-events: none; z-index: 50; }
        .bg-grid-pattern { background-image: linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px); }
        .bg-eclipse-glow { background: radial-gradient(ellipse 80% 50% at 50% -20%, rgba(212, 255, 0, 0.15), transparent); }
        .scroll-hide::-webkit-scrollbar { width: 4px; }
        .scroll-hide::-webkit-scrollbar-track { background: transparent; }
        .scroll-hide::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
      `}</style>

      <div className="h-screen w-full overflow-hidden flex flex-col bg-[#0A0A0A] text-white selection:bg-[#D4FF00] selection:text-black">
        <div className="noise-overlay" />
        <div className="fixed inset-0 bg-grid-pattern bg-[length:40px_40px] opacity-20 pointer-events-none z-0" />
        <div className="fixed top-0 left-0 w-full h-[500px] bg-eclipse-glow opacity-60 pointer-events-none z-0" />

        {/* Navigation */}
        <nav className="h-16 border-b border-white/10 flex items-center justify-between px-6 z-40 bg-[#030303]/80 backdrop-blur-sm sticky top-0">
          <div className="flex items-baseline space-x-2">
            <span className="font-serif italic text-2xl tracking-wide font-bold text-white">Coin Billigi</span>
            <span className="font-mono text-[10px] text-[#888888] tracking-widest uppercase">by koracle</span>
          </div>
          
          <div className="hidden md:flex items-center space-x-8 text-sm font-medium text-[#888888] font-mono">
            <button onClick={() => navigate('dashboard')} className={`hover:text-[#D4FF00] transition-colors ${currentView === 'dashboard' ? 'text-white' : ''}`}>PROTOCOL</button>
            <button onClick={() => navigate('liquidate')} className={`hover:text-[#D4FF00] transition-colors ${currentView === 'liquidate' ? 'text-white' : ''}`}>LIQUIDATION <span className="text-[10px] text-[#FF6B6B] align-top ml-0.5">●</span></button>
            <button className="hover:text-[#D4FF00] transition-colors">DOCS</button>
          </div>

          <div className="flex items-center space-x-4">
            <div className="hidden lg:flex items-center px-3 py-1 border border-white/10 rounded-sm bg-white/5 space-x-3">
              <div className="flex items-center space-x-1.5">
                <div className={`w-1 h-1 rounded-full ${isKimchiRisk ? 'bg-[#FF6B6B]' : 'bg-[#D4FF00]'} animate-pulse`} />
                <span className="text-[10px] uppercase tracking-wider text-[#888888]">Kimchi Prem.</span>
              </div>
              <span className={`text-xs font-mono border-l border-white/10 pl-3 ${isKimchiRisk ? 'text-[#FF6B6B]' : 'text-[#D4FF00]'}`}>{kimchi.toFixed(1)}%</span>
            </div>
            <appkit-button />
          </div>
        </nav>

        {/* Main Layout */}
        <main className="flex-1 flex overflow-hidden z-10 relative">
          {/* Center Stage (Content) */}
          <div className="flex-1 overflow-y-auto scroll-hide scroll-smooth relative">
            <div className="max-w-[1400px] mx-auto p-6 md:p-12 pb-32">
              <div className="space-y-12">
                
                {currentView === 'dashboard' && (
                  <div className="fade-in space-y-16">
                    {/* Hero */}
                    <section className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-end border-b border-white/5 pb-12">
                      <div className="lg:col-span-7">
                        <h1 className="text-6xl lg:text-8xl font-serif italic mb-6 leading-[0.9] tracking-tight">
                          Trustless <br />
                          <span className="not-italic font-sans font-light text-[#888888] tracking-normal text-5xl lg:text-7xl">Liquidity</span>
                        </h1>
                        <div className="flex space-x-12 font-mono text-xs tracking-widest text-[#888888] mt-8">
                          <div className="flex flex-col">
                            <span className="mb-2 uppercase opacity-50">Market Size</span>
                            <span className="text-2xl text-white font-light">{fmt(tvl)} KRW</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="mb-2 uppercase opacity-50">Kimchi Premium</span>
                            <span className={`text-2xl font-light ${isKimchiRisk ? 'text-[#FF6B6B]' : 'text-[#D4FF00]'}`}>{kimchi.toFixed(1)}%</span>
                          </div>
                        </div>
                      </div>

                      <div className="lg:col-span-5 flex flex-col justify-end space-y-4">
                        <div className="w-full h-32 border border-white/10 bg-white/[0.02] relative overflow-hidden group hover:border-[#D4FF00]/30 transition-colors">
                          <div className="absolute inset-0 flex items-center justify-between px-8">
                            <div className="text-left">
                              <div className="font-mono text-[10px] uppercase text-[#888888] mb-1">Supply APY</div>
                              <div className="text-4xl font-mono text-white">{supplyApy}%</div>
                            </div>
                            <div className="h-12 w-px bg-white/10" />
                            <div className="text-right">
                              <div className="font-mono text-[10px] uppercase text-[#888888] mb-1">Borrow APY</div>
                              <div className="text-4xl font-mono text-[#D4FF00]">{borrowApy}%</div>
                            </div>
                          </div>
                          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/5 to-transparent h-1 w-full animate-scanline pointer-events-none" />
                        </div>
                      </div>
                    </section>

                    {/* Market Grid */}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-16">
                      {/* Earn */}
                      <div className="space-y-8">
                        <div className="flex items-center justify-between border-b border-white/10 pb-4">
                          <h2 className="font-sans font-medium text-2xl flex items-center">
                            <span className="w-2 h-2 bg-[#D4FF00] rounded-full mr-3" />Earn
                          </h2>
                          <span className="font-mono text-[10px] uppercase text-[#888888]">Asset to Supply</span>
                        </div>

                        <div>
                          <div className="grid grid-cols-4 font-mono text-[10px] uppercase text-[#888888] px-4 pb-4 opacity-50">
                            <span>Asset</span><span className="text-right">APY</span><span className="text-right">Balance</span><span />
                          </div>

                          <div onClick={() => selectMarket('UPETH')} className={`group grid grid-cols-4 items-center p-5 border cursor-pointer transition-all ${selection === 'UPETH' ? 'border-[#D4FF00] bg-white/[0.04]' : 'border-white/5 hover:border-[#D4FF00] bg-white/[0.02] hover:bg-white/[0.04]'}`}>
                            <div className="flex items-center space-x-4">
                              <svg className="w-6 h-6" viewBox="0 0 32 32"><g fill="none" fillRule="evenodd"><circle cx="16" cy="16" r="16" fill="#627EEA"/><path fill="#FFF" fillOpacity=".602" d="M16.498 4v8.87l7.497 3.35z"/><path fill="#FFF" d="M16.498 4L9 16.22l7.498-3.35z"/><path fill="#FFF" fillOpacity=".602" d="M16.498 21.968l7.497-4.353-7.497-3.348z"/><path fill="#FFF" d="M9 17.615l7.498 4.353v-7.701z"/><path fill="#FFF" fillOpacity=".2" d="M16.498 20.573l7.497-4.353-7.497 10.291z"/><path fill="#FFF" fillOpacity=".602" d="M9 16.22l7.498 4.353v1.791z"/></g></svg>
                              <span className="font-bold text-lg">UPETH</span>
                            </div>
                            <div className="text-right font-mono text-[#D4FF00] text-lg">{supplyApy}%</div>
                            <div className="text-right font-mono text-[#888888]">{isConnected ? upethBalance.toFixed(4) : '-'}</div>
                            <div className="flex justify-end"><span className="material-symbols-outlined text-[#888888] group-hover:text-[#D4FF00] transition-colors">arrow_forward</span></div>
                          </div>

                          <div onClick={() => selectMarket('UPKRW')} className={`group grid grid-cols-4 items-center p-5 border-b border-x cursor-pointer transition-all mt-[-1px] ${selection === 'UPKRW' ? 'border-[#D4FF00] bg-white/[0.04]' : 'border-white/5 hover:border-white/20 bg-white/[0.01]'}`}>
                            <div className="flex items-center space-x-4">
                              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-red-500 to-blue-600 flex items-center justify-center text-[10px] font-bold text-white border border-white/10">₩</div>
                              <span className="font-bold text-lg">UPKRW</span>
                            </div>
                            <div className="text-right font-mono text-white text-lg">2.1%</div>
                            <div className="text-right font-mono text-[#888888]">{isConnected ? fmt(upkrwBalance) : '-'}</div>
                            <div className="flex justify-end"><span className="material-symbols-outlined text-[#888888] group-hover:text-white transition-colors">arrow_forward</span></div>
                          </div>
                        </div>
                      </div>

                      {/* Borrow */}
                      <div className="space-y-8">
                        <div className="flex items-center justify-between border-b border-white/10 pb-4">
                          <h2 className="font-sans font-medium text-2xl flex items-center">
                            <span className="w-2 h-2 bg-white rounded-full mr-3" />Borrow
                          </h2>
                          <span className="font-mono text-[10px] uppercase text-[#888888]">Asset to Borrow</span>
                        </div>

                        <div>
                          <div className="grid grid-cols-4 font-mono text-[10px] uppercase text-[#888888] px-4 pb-4 opacity-50">
                            <span>Asset</span><span className="text-right">Max LTV</span><span className="text-right">Liquidity</span><span />
                          </div>

                          <div onClick={() => selectMarket('UPETH_BORROW')} className={`group grid grid-cols-4 items-center p-5 border cursor-pointer transition-all ${selection === 'UPETH_BORROW' ? 'border-white bg-white/[0.05]' : 'border-white/5 hover:border-white hover:bg-white/[0.05] bg-white/[0.02]'}`}>
                            <div className="flex items-center space-x-4">
                              <svg className="w-6 h-6" viewBox="0 0 32 32"><g fill="none" fillRule="evenodd"><circle cx="16" cy="16" r="16" fill="#627EEA"/><path fill="#FFF" fillOpacity=".602" d="M16.498 4v8.87l7.497 3.35z"/><path fill="#FFF" d="M16.498 4L9 16.22l7.498-3.35z"/><path fill="#FFF" fillOpacity=".602" d="M16.498 21.968l7.497-4.353-7.497-3.348z"/><path fill="#FFF" d="M9 17.615l7.498 4.353v-7.701z"/><path fill="#FFF" fillOpacity=".2" d="M16.498 20.573l7.497-4.353-7.497 10.291z"/><path fill="#FFF" fillOpacity=".602" d="M9 16.22l7.498 4.353v1.791z"/></g></svg>
                              <span className="font-bold text-lg">UPETH</span>
                            </div>
                            <div className="text-right font-mono text-[#888888] text-lg">92%</div>
                            <div className="text-right font-mono text-green-400 text-xs uppercase tracking-widest pt-1">Deep</div>
                            <div className="flex justify-end"><span className="material-symbols-outlined text-[#888888] group-hover:text-white transition-colors">arrow_forward</span></div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* System Status */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-8 border-t border-white/5">
                      <div className="p-4 border border-white/5 bg-white/[0.01] flex items-center space-x-4">
                        <span className="material-symbols-outlined text-[#888888]">security</span>
                        <div><div className="text-xs text-[#888888] uppercase tracking-wider mb-1">Audit Status</div><div className="text-sm font-mono text-white">Secured by Morpho Blue</div></div>
                      </div>
                      <div className="p-4 border border-white/5 bg-white/[0.01] flex items-center space-x-4">
                        <span className="material-symbols-outlined text-[#888888]">public</span>
                        <div><div className="text-xs text-[#888888] uppercase tracking-wider mb-1">Oracle</div><div className="text-sm font-mono text-white">Chainlink + KRW Aggregator</div></div>
                      </div>
                      <div className="p-4 border border-white/5 bg-white/[0.01] flex items-center space-x-4">
                        <span className="material-symbols-outlined text-[#FF6B6B]">warning</span>
                        <div><div className="text-xs text-[#888888] uppercase tracking-wider mb-1">Risk Parameter</div><div className="text-sm font-mono text-[#FF6B6B]">Dynamic LTV Active</div></div>
                      </div>
                    </div>
                  </div>
                )}

                {currentView === 'liquidate' && (
                  <div className="fade-in space-y-8">
                    <div className="border-b border-white/10 pb-6 flex flex-col md:flex-row justify-between md:items-end gap-4">
                      <div>
                        <h1 className="text-4xl font-serif italic mb-2">Liquidation <span className="not-italic font-sans font-light text-[#888888]">Terminal</span></h1>
                        <p className="font-mono text-xs text-[#888888] max-w-md mt-2">Monitor undercollateralized positions.<br /><span className="text-[#FF6B6B]">Kimchi Premium affects liquidation thresholds.</span></p>
                      </div>
                      <div className="text-left md:text-right">
                        <div className="font-mono text-xs text-[#888888] mb-1">ORACLE PRICE</div>
                        <div className="font-mono text-xl text-white">1 ETH = {fmt(ethPrice)} KRW</div>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>

          {/* Right Action Panel (Contextual Terminal) */}
          <aside className="w-[420px] border-l border-white/10 bg-[#080808] flex-col hidden lg:flex shadow-[-20px_0_40px_rgba(0,0,0,0.5)] z-20">
            <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/[0.02]">
              <h3 className="font-mono text-xs uppercase tracking-widest text-[#888888] flex items-center">
                <span className="material-symbols-outlined text-sm mr-2 text-[#D4FF00]">terminal</span>
                Terminal // <span className={`ml-1 ${selection ? (actionMode === 'withdraw' ? 'text-[#FF6B6B]' : 'text-[#D4FF00]') : 'text-white'}`}>{getPanelMode()}</span>
              </h3>
              <div className="flex space-x-1 opacity-50">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
              </div>
            </div>
            {/* Panel Content */}
            <div className="flex-1 p-8 relative flex flex-col">
              {!selection ? (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-30 space-y-6">
                  <div className="w-16 h-16 border border-dashed border-white rounded-full flex items-center justify-center">
                    <span className="material-symbols-outlined text-3xl font-light">data_exploration</span>
                  </div>
                  <p className="font-mono text-xs max-w-[200px] leading-relaxed">Select a market from the protocol dashboard.</p>
                </div>
              ) : (
                <div className="fade-in h-full flex flex-col pt-2">
                  {/* Action Mode Toggle */}
                  <div className="flex mb-6 border border-white/10">
                    <button onClick={() => { setActionMode('supply'); setInputAmount(''); setTxStep('idle'); }} className={`flex-1 py-2 text-xs font-mono uppercase transition-colors ${actionMode === 'supply' ? 'bg-[#D4FF00] text-black' : 'text-[#888888] hover:text-white'}`}>
                      {selection === 'UPETH_BORROW' ? 'Borrow' : 'Supply'}
                    </button>
                    <button onClick={() => { setActionMode('withdraw'); setInputAmount(''); setTxStep('idle'); }} className={`flex-1 py-2 text-xs font-mono uppercase transition-colors ${actionMode === 'withdraw' ? 'bg-[#FF6B6B] text-black' : 'text-[#888888] hover:text-white'}`}>
                      {selection === 'UPETH_BORROW' ? 'Repay' : 'Withdraw'}
                    </button>
                  </div>

                  {/* Asset Info */}
                  <div className="flex items-center space-x-4 mb-8">
                    <div className="w-12 h-12 flex items-center justify-center border border-white/10 rounded-full bg-white/5">
                      {getPanelAsset() === 'UPETH' ? (
                        <svg className="w-8 h-8" viewBox="0 0 32 32"><g fill="none" fillRule="evenodd"><circle cx="16" cy="16" r="16" fill="#627EEA"/><path fill="#FFF" fillOpacity=".602" d="M16.498 4v8.87l7.497 3.35z"/><path fill="#FFF" d="M16.498 4L9 16.22l7.498-3.35z"/></g></svg>
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-red-500 to-blue-600 flex items-center justify-center text-xs font-bold text-white">₩</div>
                      )}
                    </div>
                    <div>
                      <h4 className="font-bold text-xl">{getPanelAsset()}</h4>
                      <div className="text-[10px] font-mono text-[#888888] uppercase tracking-widest">{getPanelAsset() === 'UPETH' ? 'Ethereum' : 'KRW Stablecoin'}</div>
                    </div>
                  </div>

                  {/* Amount Input */}
                  <div className="relative group mb-8">
                    <div className="flex justify-between font-mono text-[10px] text-[#888888] mb-2 uppercase">
                      <label>{selection === 'UPETH_BORROW' && actionMode === 'supply' ? 'Borrow Amount' : 'Amount'}</label>
                      <span>{actionMode === 'withdraw' ? 'Position' : 'Wallet'}: {getMaxAmount().toFixed(4)}</span>
                    </div>
                    <div className="relative">
                      <input type="number" value={inputAmount} onChange={(e) => simulate(e.target.value)} className="w-full bg-transparent border-b border-white/20 py-4 text-4xl font-mono text-white focus:outline-none focus:border-[#D4FF00] transition-colors placeholder-white/10" placeholder="0.00" />
                      <button onClick={() => simulate(getMaxAmount().toString())} className="absolute right-0 top-1/2 -translate-y-1/2 text-[10px] font-bold bg-white/10 hover:bg-white/20 text-white px-2 py-1 uppercase transition-colors">MAX</button>
                    </div>
                  </div>

                  {/* Collateral Input for Borrow */}
                  {selection === 'UPETH_BORROW' && actionMode === 'supply' && (
                    <div className="relative group mb-8 fade-in">
                      <div className="flex justify-between font-mono text-[10px] text-[#888888] mb-2 uppercase">
                        <label>Collateral (UPKRW)</label>
                        <span>Wallet: {fmt(upkrwBalance)}</span>
                      </div>
                      <div className="flex items-center space-x-2 border-b border-white/20 pb-2">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-red-500 to-blue-600 flex items-center justify-center text-[10px] font-bold text-white">₩</div>
                        <input type="number" value={collateralAmount} onChange={(e) => { setCollateralAmount(e.target.value); if (inputAmount) { setSimulatedHF(calculateHealthFactor(parseFloat(inputAmount), parseFloat(e.target.value) || 0)); } }} className="w-full bg-transparent py-2 text-xl font-mono text-white focus:outline-none placeholder-white/10" placeholder="0" />
                        <button onClick={() => { setCollateralAmount(upkrwBalance.toString()); if (inputAmount) { setSimulatedHF(calculateHealthFactor(parseFloat(inputAmount), upkrwBalance)); } }} className="text-[10px] font-bold bg-white/10 hover:bg-white/20 text-white px-2 py-1 uppercase transition-colors">MAX</button>
                      </div>
                    </div>
                  )}

                  {/* Info Box */}
                  <div className="space-y-4 mb-auto bg-white/[0.02] p-4 border border-white/5">
                    <div className="flex justify-between text-sm">
                      <span className="text-[#888888] font-mono text-xs uppercase">Est. APY</span>
                      <span className="font-mono text-white">{selection === 'UPETH_BORROW' ? borrowApy : supplyApy}%</span>
                    </div>
                    
                    {selection === 'UPETH_BORROW' && actionMode === 'supply' && (
                      <>
                        <div className="h-px bg-white/10 my-2" />
                        <div className="flex justify-between text-sm">
                          <span className="text-[#888888] font-mono text-xs uppercase">Health Factor</span>
                          <span className={`font-mono ${simulatedHF === null ? 'text-white' : simulatedHF < 1.0 ? 'text-red-500' : simulatedHF < 1.1 ? 'text-orange-500' : simulatedHF < 1.5 ? 'text-yellow-500' : 'text-green-400'}`}>
                            {simulatedHF ? simulatedHF.toFixed(2) : '--'}
                          </span>
                        </div>
                        <div className="w-full h-1 bg-zinc-800 mt-2">
                          <div className={`h-full transition-all duration-500 ${simulatedHF === null ? 'bg-zinc-600' : simulatedHF < 1.0 ? 'bg-red-500' : simulatedHF < 1.1 ? 'bg-orange-500' : simulatedHF < 1.5 ? 'bg-yellow-500' : 'bg-green-400'}`} style={{ width: simulatedHF ? `${Math.min(simulatedHF / 2 * 100, 100)}%` : '0%' }} />
                        </div>
                      </>
                    )}
                  </div>

                  {/* Position Display */}
                  {isConnected && (userPosition.supplyAssets > 0 || userPosition.borrowAssets > 0 || userPosition.collateral > 0n) && (
                    <div className="mb-4 p-3 border border-[#D4FF00]/30 bg-[#D4FF00]/5">
                      <div className="font-mono text-[10px] uppercase text-[#D4FF00] mb-2">My Position</div>
                      <div className="space-y-1 text-xs">
                        {userPosition.supplyAssets > 0 && <div className="flex justify-between"><span className="text-[#888888]">Supplied</span><span className="text-white">{userPosition.supplyAssets.toFixed(4)} UPETH</span></div>}
                        {userPosition.borrowAssets > 0 && <div className="flex justify-between"><span className="text-[#888888]">Borrowed</span><span className="text-white">{userPosition.borrowAssets.toFixed(4)} UPETH</span></div>}
                        {userPosition.collateral > 0n && <div className="flex justify-between"><span className="text-[#888888]">Collateral</span><span className="text-white">{fmt(Number(userPosition.collateral) / 1e18)} UPKRW</span></div>}
                      </div>
                    </div>
                  )}

                  {/* Action Button */}
                  <div className="mt-8 space-y-3">
                    <button onClick={handleButtonClick} disabled={isButtonDisabled()} className={`w-full py-5 font-bold font-mono uppercase tracking-widest text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${executionStatus === 'confirmed' ? 'bg-[#D4FF00] text-black' : actionMode === 'withdraw' ? 'bg-[#FF6B6B] text-black hover:bg-red-400' : 'bg-white text-black hover:bg-[#D4FF00]'}`}>
                      {executionStatus === 'confirmed' ? 'CONFIRMED' : getButtonText()}
                    </button>
                    
                    {selection === 'UPETH_BORROW' && actionMode === 'supply' && (
                      <div className="text-[10px] text-center text-[#888888] mt-2 font-mono">
                        <p className="text-[#D4FF00]">
                          {txStep === 'idle' && 'Step 1/3: Approve collateral'}
                          {txStep === 'approved' && 'Step 2/3: Supply collateral'}
                          {txStep === 'collateral_supplied' && 'Step 3/3: Borrow UPETH'}
                        </p>
                      </div>
                    )}

                    <button onClick={() => selectMarket(null)} className="w-full py-2 text-xs text-[#888888] hover:text-white transition-colors font-mono">[ Cancel ]</button>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </main>
      </div>
    </>
  )
}
