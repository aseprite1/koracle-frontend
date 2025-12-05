import { useState, useEffect, useRef, useCallback } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi'
import { formatUnits, parseUnits } from 'viem'
import { ADDRESSES, MARKET_ID, morphoAbi, oracleAbi, erc20Abi, marketParams, liquidateAbi, faucetAbi } from '../config/contracts'
import { giwaSepoliaNetwork } from '../config/appkit'

// ============ TYPES ============
type ViewType = 'dashboard' | 'liquidate' | 'faucet'
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

interface LiquidatablePosition {
  borrower: `0x${string}`
  collateral: bigint
  borrowShares: bigint
  borrowAssets: number
  healthFactor: number
  maxSeizable: bigint
  liquidationIncentive: number
}

// ============ CONSTANTS ============
const ORACLE_PRICE_SCALE = 10n ** 36n
const WAD = 10n ** 18n


// ============ UTILS ============
const fmt = (n: number) => new Intl.NumberFormat('en-US').format(n)

// Compact number formatting for large values
const fmtCompact = (n: number): string => {
  if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T'
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  if (n >= 100) return n.toFixed(0)
  if (n >= 1) return n.toFixed(2)
  return n.toFixed(4)
}

// Safe error logging (Security fix: no sensitive data in production)
const logError = (context: string, error: unknown) => {
  if (import.meta.env.DEV) {
    console.error(context, error)
  }
}

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
  const isFullRepayRef = useRef<boolean>(false)

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
  const [currentHF, setCurrentHF] = useState<number | null>(null)

  // Liquidation State
  const [liquidatablePositions, setLiquidatablePositions] = useState<LiquidatablePosition[]>([])
  const [borrowerToCheck, setBorrowerToCheck] = useState('')
  const [isLoadingPositions, setIsLoadingPositions] = useState(false)
  const [selectedBorrower, setSelectedBorrower] = useState<LiquidatablePosition | null>(null)
  const [liquidateAmount, setLiquidateAmount] = useState('')
  const [liquidateTxStep, setLiquidateTxStep] = useState<'idle' | 'approving' | 'liquidating' | 'success'>('idle')
  const [liquidateTxHash, setLiquidateTxHash] = useState<string | null>(null)

  // Faucet State
  const [faucetTxStep, setFaucetTxStep] = useState<'idle' | 'claiming' | 'claimed'>('idle')

  // Error State (replaces alert())
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  
  // Toast message for general notifications
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  
  const showToast = (message: string) => {
    setToastMessage(message)
    setTimeout(() => setToastMessage(null), 2000)
  }

  // Public client for reading positions
  const publicClient = usePublicClient({ chainId: giwaSepoliaNetwork.id })

  // === Contract Reads ===
  const { data: marketData, refetch: refetchMarket } = useReadContract({
    address: ADDRESSES.MORPHO,
    abi: morphoAbi,
    functionName: 'market',
    args: [MARKET_ID],
    chainId: giwaSepoliaNetwork.id,
    query: { refetchInterval: 5000 }, // Auto-refresh every 5 seconds
  })

  const { data: oraclePrice } = useReadContract({
    address: ADDRESSES.ORACLE,
    abi: oracleAbi,
    functionName: 'price',
    chainId: giwaSepoliaNetwork.id,
    query: { refetchInterval: 10000 }, // Auto-refresh every 10 seconds
  })

  const { data: kimchiPremium } = useReadContract({
    address: ADDRESSES.ORACLE,
    abi: oracleAbi,
    functionName: 'kimchiPremium',
    chainId: giwaSepoliaNetwork.id,
    query: { refetchInterval: 10000 },
  })

  const { data: upethBalanceData, refetch: refetchUpethBalance } = useReadContract({
    address: ADDRESSES.UPETH,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: giwaSepoliaNetwork.id,
    query: { refetchInterval: 5000 },
  })

  const { data: upkrwBalanceData, refetch: refetchUpkrwBalance } = useReadContract({
    address: ADDRESSES.UPKRW,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: giwaSepoliaNetwork.id,
    query: { refetchInterval: 5000 },
  })

  const { data: positionData, refetch: refetchPosition } = useReadContract({
    address: ADDRESSES.MORPHO,
    abi: morphoAbi,
    functionName: 'position',
    args: address ? [MARKET_ID, address] : undefined,
    chainId: giwaSepoliaNetwork.id,
    query: { refetchInterval: 5000 }, // Auto-refresh every 5 seconds
  })

  // Faucet data
  const { data: hasClaimedData, refetch: refetchHasClaimed } = useReadContract({
    address: ADDRESSES.FAUCET,
    abi: faucetAbi,
    functionName: 'hasClaimed',
    args: address ? [address] : undefined,
    chainId: giwaSepoliaNetwork.id,
  })

  const { data: faucetBalanceData } = useReadContract({
    address: ADDRESSES.FAUCET,
    abi: faucetAbi,
    functionName: 'getRemainingBalance',
    chainId: giwaSepoliaNetwork.id,
    query: { refetchInterval: 10000 },
  })

  // === Contract Writes ===
  const { writeContract, data: txHash, reset: resetWrite, error: writeError } = useWriteContract()
  const { isLoading: isTxPending, isSuccess: isTxSuccess, isError: isTxError } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  // === Effects ===

  // Handle write errors (user rejection, etc.)
  useEffect(() => {
    if (writeError) {
      // Reset all transaction states on error
      setTxStep('idle')
      setExecutionStatus('idle')
      setLiquidateTxStep('idle')
      approvedCollateralRef.current = 0n
      borrowAmountRef.current = 0n
      isFullRepayRef.current = false
      resetWrite()
      
      // Show user-friendly error message
      const errorMsg = writeError.message?.includes('User rejected') 
        ? 'Transaction cancelled'
        : 'Transaction failed'
      setErrorMessage(errorMsg)
      setTimeout(() => setErrorMessage(null), 3000)
    }
  }, [writeError, resetWrite])

  // Handle transaction errors (after submission)
  useEffect(() => {
    if (isTxError && txHash) {
      setTxStep('idle')
      setExecutionStatus('idle')
      setLiquidateTxStep('idle')
      setErrorMessage('Transaction failed on chain')
      setTimeout(() => setErrorMessage(null), 4000)
      resetWrite()
    }
  }, [isTxError, txHash, resetWrite])

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
        
        // Immediately refetch all data including market data
        Promise.all([
          refetchPosition(),
          refetchUpethBalance(),
          refetchUpkrwBalance(),
          refetchMarket()
        ]).then(() => {
          // Only reset UI after data is fresh
          setTimeout(() => {
            setExecutionStatus('idle')
            setTxStep('idle')
            setInputAmount('')
            setCollateralAmount('')
            setSimulatedHF(null)
            approvedCollateralRef.current = 0n
            borrowAmountRef.current = 0n
            isFullRepayRef.current = false
            resetWrite()
          }, 1500)
        })
      } else if (faucetTxStep === 'claiming') {
        // Faucet claim success
        setFaucetTxStep('claimed')
        showToast('Tokens claimed successfully!')
        Promise.all([
          refetchHasClaimed(),
          refetchUpethBalance(),
          refetchUpkrwBalance()
        ]).then(() => {
          setTimeout(() => {
            setFaucetTxStep('idle')
            resetWrite()
          }, 1500)
        })
      }
    }
  }, [isTxSuccess, txStep, faucetTxStep, refetchPosition, refetchUpethBalance, refetchUpkrwBalance, refetchMarket, refetchHasClaimed, resetWrite, showToast])

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

  // Calculate current Health Factor for existing position
  useEffect(() => {
    if (oraclePrice && userPosition.collateral > 0n && userPosition.borrowAssets > 0) {
      const collateral = userPosition.collateral
      const borrowAssetsBigInt = parseUnits(userPosition.borrowAssets.toFixed(18), 18)
      
      if (borrowAssetsBigInt > 0n) {
        const lltv = marketParams.lltv
        const maxBorrow = (collateral * oraclePrice * lltv) / (ORACLE_PRICE_SCALE * WAD)
        const hfScaled = (maxBorrow * WAD) / borrowAssetsBigInt
        let hf = Number(hfScaled) / 1e18
        // Bounds checking for NaN/Infinity
        if (!isFinite(hf) || hf > 1000) hf = 1000
        if (hf < 0) hf = 0
        setCurrentHF(hf)
      } else {
        setCurrentHF(null)
      }
    } else {
      setCurrentHF(null)
    }
  }, [oraclePrice, userPosition])

  // === Liquidation Functions ===
  const checkBorrowerPosition = useCallback(async (borrowerAddress: string) => {
    if (!publicClient || !oraclePrice || !marketData || !borrowerAddress) return null
    
    try {
      const position = await publicClient.readContract({
        address: ADDRESSES.MORPHO,
        abi: morphoAbi,
        functionName: 'position',
        args: [MARKET_ID, borrowerAddress as `0x${string}`],
      })

      const [, borrowShares, collateral] = position
      const totalBorrowAssets = marketData[2]
      const totalBorrowShares = marketData[3]

      if (BigInt(borrowShares) === 0n) return null

      const borrowAssets = Number(BigInt(borrowShares) * totalBorrowAssets / totalBorrowShares) / 1e18
      const borrowAssetsBigInt = BigInt(borrowShares) * totalBorrowAssets / totalBorrowShares

      // Calculate Health Factor
      const lltv = marketParams.lltv
      const maxBorrow = (BigInt(collateral) * oraclePrice * lltv) / (ORACLE_PRICE_SCALE * WAD)
      const hfScaled = borrowAssetsBigInt > 0n ? (maxBorrow * WAD) / borrowAssetsBigInt : 0n
      const healthFactor = Number(hfScaled) / 1e18

      // Liquidation incentive (typically 5-15% for Morpho)
      const liquidationIncentive = 1.05 // 5% bonus

      // Max seizable collateral (in UPKRW)
      const maxSeizable = BigInt(collateral)

      return {
        borrower: borrowerAddress as `0x${string}`,
        collateral: BigInt(collateral),
        borrowShares: BigInt(borrowShares),
        borrowAssets,
        healthFactor,
        maxSeizable,
        liquidationIncentive,
      }
    } catch (error) {
      logError('Error checking position:', error)
      return null
    }
  }, [publicClient, oraclePrice, marketData])

  const handleCheckBorrower = async () => {
    if (!borrowerToCheck) return
    setIsLoadingPositions(true)
    
    const position = await checkBorrowerPosition(borrowerToCheck)
    if (position) {
      // Check if already in list
      const exists = liquidatablePositions.find(p => p.borrower.toLowerCase() === position.borrower.toLowerCase())
      if (!exists) {
        setLiquidatablePositions(prev => [...prev, position])
      } else {
        // Update existing
        setLiquidatablePositions(prev => 
          prev.map(p => p.borrower.toLowerCase() === position.borrower.toLowerCase() ? position : p)
        )
      }
    }
    setBorrowerToCheck('')
    setIsLoadingPositions(false)
  }

  const executeLiquidation = async () => {
    if (!selectedBorrower || !liquidateAmount || !isConnected || !oraclePrice) return

    const repayAmount = parseUnits(liquidateAmount, 18) // UPETH to repay
    const maxDebt = parseUnits(selectedBorrower.borrowAssets.toString(), 18)
    
    // Cap approve to actual debt amount (with small margin for interest)
    const approveAmount = repayAmount > maxDebt ? maxDebt + (maxDebt / 100n) : repayAmount + (repayAmount / 100n)
    
    setLiquidateTxStep('approving')
    writeContract({
      address: ADDRESSES.UPETH,
      abi: erc20Abi,
      functionName: 'approve',
      args: [ADDRESSES.MORPHO, approveAmount],
    })
  }

  const executeLiquidationAfterApprove = async () => {
    if (!selectedBorrower || !liquidateAmount || !oraclePrice) return

    // Fetch fresh position data before liquidating
    const freshPosition = await checkBorrowerPosition(selectedBorrower.borrower)
    if (!freshPosition) {
      setErrorMessage('Failed to fetch position data')
      setLiquidateTxStep('idle')
      return
    }

    let repayAmount = parseUnits(liquidateAmount, 18) // UPETH to repay
    const maxRepayAmount = parseUnits(freshPosition.borrowAssets.toString(), 18)
    
    // Cap repayAmount to borrower's actual debt to prevent underflow
    if (repayAmount > maxRepayAmount) {
      repayAmount = maxRepayAmount
    }
    
    // Calculate collateral to seize based on repay amount
    // seizedAssets = repayAmount * liquidationIncentive / oraclePrice * ORACLE_PRICE_SCALE
    const liquidationIncentive = 105n // 1.05 in percentage (105%)
    let seizeAmount = (repayAmount * ORACLE_PRICE_SCALE * liquidationIncentive) / (oraclePrice * 100n)
    
    // Cap seizeAmount to borrower's actual collateral to prevent overflow
    if (seizeAmount > freshPosition.collateral) {
      seizeAmount = freshPosition.collateral
    }

    // Also check if trying to seize more than what exists
    if (seizeAmount === 0n) {
      setErrorMessage('No collateral to seize')
      setLiquidateTxStep('idle')
      return
    }

    // Apply 95% safety margin to avoid edge case overflows in contract
    seizeAmount = (seizeAmount * 95n) / 100n
    
    setLiquidateTxStep('liquidating')
    writeContract({
      address: ADDRESSES.MORPHO,
      abi: [...morphoAbi, ...liquidateAbi],
      functionName: 'liquidate',
      args: [marketParams, selectedBorrower.borrower, seizeAmount, 0n, '0x' as `0x${string}`],
    })
  }

  // Handle liquidation tx success
  useEffect(() => {
    if (isTxSuccess && liquidateTxStep === 'approving') {
      executeLiquidationAfterApprove()
    } else if (isTxSuccess && liquidateTxStep === 'liquidating') {
      // Save borrower address BEFORE clearing state (fix stale closure)
      const borrowerAddress = selectedBorrower?.borrower
      
      // Save tx hash and show success
      if (txHash) {
        setLiquidateTxHash(txHash)
      }
      setLiquidateTxStep('success')
      setSelectedBorrower(null)
      setLiquidateAmount('')
      
      // Refetch all data including market data
      Promise.all([
        refetchUpethBalance(),
        refetchUpkrwBalance(),
        refetchPosition(),
        refetchMarket()
      ]).then(() => {
        // Refresh the liquidated position using saved address
        if (borrowerAddress) {
          checkBorrowerPosition(borrowerAddress).then(pos => {
            if (pos) {
              setLiquidatablePositions(prev => 
                prev.map(p => p.borrower === pos.borrower ? pos : p)
              )
            }
          })
        }
      })
    }
  }, [isTxSuccess, liquidateTxStep, selectedBorrower, refetchUpethBalance, refetchUpkrwBalance, refetchPosition, refetchMarket, checkBorrowerPosition])

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
    isFullRepayRef.current = false
  }

  const calculateHealthFactor = (newBorrowETH: number, newCollateralKRW: number): number | null => {
    if (!oraclePrice) return null

    const existingCollateral = userPosition.collateral
    // borrowAssets is already in ETH units (divided by 1e18), so multiply back
    const existingBorrowBigInt = parseUnits(userPosition.borrowAssets.toFixed(18), 18)

    const newCollateralBigInt = parseUnits(newCollateralKRW.toFixed(18), 18)
    const newBorrowBigInt = parseUnits(newBorrowETH.toFixed(18), 18)

    const totalCollateral = existingCollateral + newCollateralBigInt
    const totalBorrow = existingBorrowBigInt + newBorrowBigInt

    if (totalBorrow <= 0n) return null
    if (totalCollateral <= 0n) return null

    const lltv = marketParams.lltv
    const maxBorrow = (totalCollateral * oraclePrice * lltv) / (ORACLE_PRICE_SCALE * WAD)
    const hfScaled = (maxBorrow * WAD) / totalBorrow
    const hf = Number(hfScaled) / 1e18

    // Bounds checking for NaN/Infinity
    if (!isFinite(hf) || hf > 1000) return 1000
    if (hf < 0) return 0

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
    if (!isConnected || !selection || !inputAmount || !address) return

    try {
      const amount = parseUnits(inputAmount, 18)
      const isBorrow = selection === 'UPETH_BORROW'

      if (isBorrow) {
        const hasExistingCollateral = userPosition.collateral > 0n
        const hasNewCollateral = collateralAmount && parseFloat(collateralAmount) > 0
        
        // 기존 담보도 없고 새 담보도 없으면 에러
        if (!hasExistingCollateral && !hasNewCollateral) {
          setErrorMessage('담보 금액을 입력하세요')
          setTimeout(() => setErrorMessage(null), 4000)
          return
        }
        
        borrowAmountRef.current = amount
        
        // 새 담보가 있으면 approve -> supplyCollateral -> borrow 플로우
        if (hasNewCollateral) {
          const collateralAmt = parseUnits(collateralAmount, 18)
          approvedCollateralRef.current = collateralAmt
          setTxStep('approving')
          writeContract({
            address: ADDRESSES.UPKRW,
            abi: erc20Abi,
            functionName: 'approve',
            args: [ADDRESSES.MORPHO, collateralAmt],
          })
        } else {
          // 기존 담보만 있으면 바로 borrow
          setTxStep('borrowing')
          writeContract({
            address: ADDRESSES.MORPHO,
            abi: morphoAbi,
            functionName: 'borrow',
            args: [marketParams, amount, 0n, address, address],
          })
        }
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
      logError('Transaction failed:', error)
      setTxStep('idle')
    }
  }

  // Execute withdraw flow (no approve needed)
  const executeWithdraw = async () => {
    if (!isConnected || !selection || !inputAmount || !address) return

    try {
      const amount = parseUnits(inputAmount, 18)

      if (selection === 'UPETH') {
        // Withdraw supplied UPETH
        setTxStep('executing')
        writeContract({
          address: ADDRESSES.MORPHO,
          abi: morphoAbi,
          functionName: 'withdraw',
          args: [marketParams, amount, 0n, address, address],
        })
      } else if (selection === 'UPKRW') {
        // Withdraw collateral UPKRW
        // Fetch fresh position to get actual collateral amount
        setTxStep('executing')
        
        const freshPosition = await publicClient?.readContract({
          address: ADDRESSES.MORPHO,
          abi: morphoAbi,
          functionName: 'position',
          args: [MARKET_ID, address],
        })
        
        if (!freshPosition) {
          setErrorMessage('Failed to fetch position')
          setTxStep('idle')
          return
        }
        
        const [, freshBorrowShares, freshCollateral] = freshPosition
        
        // Cap amount to actual collateral to handle floating point precision issues
        let withdrawAmount = amount
        
        // If borrowShares > 0, cannot withdraw all collateral
        if (BigInt(freshBorrowShares) > 0n && withdrawAmount >= freshCollateral) {
          setErrorMessage('부채가 남아있어서 담보를 전부 뺄 수 없습니다. 먼저 부채를 전액 상환하세요.')
          setTxStep('idle')
          return
        }
        
        // Cap to actual collateral if trying to withdraw more
        if (withdrawAmount > freshCollateral) {
          withdrawAmount = freshCollateral
        }
        
        if (withdrawAmount === 0n) {
          setErrorMessage('No collateral to withdraw')
          setTxStep('idle')
          return
        }
        
        // Only check HF if borrow is significant
        if (BigInt(freshBorrowShares) > 0n && oraclePrice && marketData) {
          const totalBorrowAssets = marketData[2]
          const totalBorrowShares = marketData[3]
          const borrowAssets = BigInt(freshBorrowShares) * totalBorrowAssets / totalBorrowShares
          
          // Skip HF check if borrow is dust (< 0.0001 UPETH)
          if (borrowAssets > parseUnits('0.0001', 18)) {
            const remainingCollateral = freshCollateral - withdrawAmount
            const lltv = marketParams.lltv
            const maxBorrow = (remainingCollateral * oraclePrice * lltv) / (ORACLE_PRICE_SCALE * WAD)
            if (borrowAssets > maxBorrow) {
              setErrorMessage('Health Factor가 1 미만이 됩니다. 먼저 대출을 상환하세요.')
              setTimeout(() => setErrorMessage(null), 4000)
              setTxStep('idle')
              return
            }
          }
        }
        
        writeContract({
          address: ADDRESSES.MORPHO,
          abi: morphoAbi,
          functionName: 'withdrawCollateral',
          args: [marketParams, withdrawAmount, address, address],
        })
      } else if (selection === 'UPETH_BORROW') {
        // Repay borrowed UPETH (needs approve first)
        // Check if this is a full repay (to use shares-based repay for clean zero)
        const borrowAssetsWei = parseUnits(userPosition.borrowAssets.toFixed(18), 18)
        isFullRepayRef.current = amount >= borrowAssetsWei
        
        // For full repay, approve a bit extra to cover any accrued interest
        const approveAmount = isFullRepayRef.current ? amount + (amount / 100n) : amount
        approvedCollateralRef.current = amount
        setTxStep('approving')
        writeContract({
          address: ADDRESSES.UPETH,
          abi: erc20Abi,
          functionName: 'approve',
          args: [ADDRESSES.MORPHO, approveAmount],
        })
      }
    } catch (error) {
      logError('Withdraw failed:', error)
      setTxStep('idle')
    }
  }

  const executeAfterApprove = async () => {
    if (!isConnected || !selection || !address) return

    const amount = approvedCollateralRef.current
    if (amount === 0n) {
      logError('No approved amount stored', null)
      return
    }

    try {
      if (actionMode === 'withdraw' && selection === 'UPETH_BORROW') {
        // Repay borrowed UPETH
        setTxStep('executing')
        
        if (isFullRepayRef.current) {
          // Full repay: use shares-based repay for clean zero (no dust)
          // repay(marketParams, 0, shares, onBehalf, data) - assets=0 means use shares
          writeContract({
            address: ADDRESSES.MORPHO,
            abi: morphoAbi,
            functionName: 'repay',
            args: [marketParams, 0n, userPosition.borrowShares, address, '0x' as `0x${string}`],
          })
        } else {
          // Partial repay: use assets-based repay
          writeContract({
            address: ADDRESSES.MORPHO,
            abi: morphoAbi,
            functionName: 'repay',
            args: [marketParams, amount, 0n, address, '0x' as `0x${string}`],
          })
        }
      } else if (selection === 'UPETH') {
        setTxStep('executing')
        writeContract({
          address: ADDRESSES.MORPHO,
          abi: morphoAbi,
          functionName: 'supply',
          args: [marketParams, amount, 0n, address, '0x' as `0x${string}`],
        })
      } else if (selection === 'UPKRW') {
        setTxStep('executing')
        writeContract({
          address: ADDRESSES.MORPHO,
          abi: morphoAbi,
          functionName: 'supplyCollateral',
          args: [marketParams, amount, address, '0x' as `0x${string}`],
        })
      } else if (selection === 'UPETH_BORROW') {
        setTxStep('supplying_collateral')
        writeContract({
          address: ADDRESSES.MORPHO,
          abi: morphoAbi,
          functionName: 'supplyCollateral',
          args: [marketParams, amount, address, '0x' as `0x${string}`],
        })
      }
    } catch (error) {
      logError('Execute failed:', error)
      setTxStep('idle')
      setExecutionStatus('idle')
    }
  }

  const executeBorrow = async () => {
    if (!isConnected || selection !== 'UPETH_BORROW' || !address) return

    const borrowAmount = borrowAmountRef.current
    if (borrowAmount === 0n) {
      logError('No borrow amount stored', null)
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
      logError('Borrow failed:', error)
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
    
    // Block if no input amount
    if (!inputAmount || parseFloat(inputAmount) <= 0) return true
    
    // Block if amount exceeds balance
    const amount = parseFloat(inputAmount)
    const maxAmount = getMaxAmount()
    if (amount > maxAmount) return true
    
    // CRITICAL: Block borrowing if HF < 1
    if (selection === 'UPETH_BORROW' && actionMode === 'supply') {
      if (simulatedHF !== null && simulatedHF < 1.0) return true
      // Block if no collateral (neither existing nor new)
      const hasExistingCollateral = userPosition.collateral > 0n
      const hasNewCollateral = collateralAmount && parseFloat(collateralAmount) > 0
      if (!hasExistingCollateral && !hasNewCollateral) return true
    }
    
    return false
  }
  
  // Get reason why button is disabled
  const getDisabledReason = (): string | null => {
    if (!isConnected) return null
    if (isTxPending || txStep !== 'idle') return null
    
    if (!inputAmount || parseFloat(inputAmount) <= 0) {
      return 'Enter amount'
    }
    
    const amount = parseFloat(inputAmount)
    const maxAmount = getMaxAmount()
    if (amount > maxAmount) {
      return `Insufficient balance (Max: ${fmtCompact(maxAmount)})`
    }
    
    if (selection === 'UPETH_BORROW' && actionMode === 'supply') {
      if (simulatedHF !== null && simulatedHF < 1.0) {
        return `Health Factor ${simulatedHF.toFixed(2)} is below 1.0 - Position would be liquidatable`
      }
      const hasExistingCollateral = userPosition.collateral > 0n
      const hasNewCollateral = collateralAmount && parseFloat(collateralAmount) > 0
      if (!hasExistingCollateral && !hasNewCollateral) {
        return 'Enter collateral amount'
      }
    }
    
    return null
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
            <button onClick={() => navigate('faucet')} className={`hover:text-[#D4FF00] transition-colors ${currentView === 'faucet' ? 'text-white' : ''}`}>FAUCET <span className="text-[10px] text-[#D4FF00] align-top ml-0.5">●</span></button>
            <button onClick={() => showToast('Docs coming soon!')} className="hover:text-[#D4FF00] transition-colors">DOCS</button>
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

        {/* Disclaimer Banner */}
        {!isConnected && (
          <div className="absolute top-16 left-0 right-0 bg-[#1a1a00] border-b border-[#D4FF00]/30 px-4 py-2 text-center z-30">
            <span className="text-[11px] text-[#D4FF00]/80 font-mono">
              TESTNET ONLY - This is a demo on GIWA Sepolia. Do not use real funds or wallets.
            </span>
          </div>
        )}
        </nav>

        {/* Main Layout */}
        <main className="flex-1 flex gap-0 overflow-hidden z-10 relative">
          {/* Center Stage (Content) - Full width */}
          <div className="flex-1 overflow-y-auto scroll-hide scroll-smooth relative">
            <div className="w-full p-6 md:p-12 pb-32">
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

                    {/* My Position Panel */}
                    {isConnected && (userPosition.supplyAssets > 0 || userPosition.borrowAssets > 0 || userPosition.collateral > 0n) && (
                      <section className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                        <div className="lg:col-span-4 flex items-center justify-between border-b border-white/10 pb-4 mb-2">
                          <h2 className="font-sans font-medium text-xl flex items-center">
                            <span className="w-2 h-2 bg-[#D4FF00] rounded-full mr-3" />My Position
                          </h2>
                          <span className="font-mono text-[10px] uppercase text-[#888888]">Real-time Dashboard</span>
                        </div>
                        
                        {/* Supplied */}
                        <div className="p-5 border border-white/10 bg-white/[0.02] overflow-hidden">
                          <div className="font-mono text-[10px] uppercase text-[#888888] mb-2">Supplied</div>
                          <div className="text-2xl font-mono text-white truncate">{fmtCompact(userPosition.supplyAssets)}</div>
                          <div className="text-xs text-[#888888] mt-1">UPETH</div>
                        </div>

                        {/* Collateral */}
                        <div className="p-5 border border-white/10 bg-white/[0.02] overflow-hidden">
                          <div className="font-mono text-[10px] uppercase text-[#888888] mb-2">Collateral</div>
                          <div className="text-2xl font-mono text-white truncate">{fmtCompact(Number(userPosition.collateral) / 1e18)}</div>
                          <div className="text-xs text-[#888888] mt-1">UPKRW</div>
                        </div>

                        {/* Borrowed */}
                        <div className="p-5 border border-white/10 bg-white/[0.02] overflow-hidden">
                          <div className="font-mono text-[10px] uppercase text-[#888888] mb-2">Borrowed</div>
                          <div className="text-2xl font-mono text-white truncate">{fmtCompact(userPosition.borrowAssets)}</div>
                          <div className="text-xs text-[#888888] mt-1">UPETH</div>
                        </div>

                        {/* Health Factor */}
                        <div className={`p-5 border bg-white/[0.02] ${currentHF === null ? 'border-white/10' : currentHF < 1.0 ? 'border-red-500/50 bg-red-500/10' : currentHF < 1.1 ? 'border-orange-500/50 bg-orange-500/10' : currentHF < 1.5 ? 'border-yellow-500/50 bg-yellow-500/10' : 'border-green-500/50 bg-green-500/10'}`}>
                          <div className="font-mono text-[10px] uppercase text-[#888888] mb-2">Health Factor</div>
                          <div className={`text-2xl font-mono ${currentHF === null ? 'text-[#888888]' : currentHF < 1.0 ? 'text-red-500' : currentHF < 1.1 ? 'text-orange-500' : currentHF < 1.5 ? 'text-yellow-500' : 'text-green-400'}`}>
                            {currentHF !== null ? (currentHF > 10 ? '>10' : currentHF.toFixed(2)) : '∞'}
                          </div>
                          <div className="text-xs text-[#888888] mt-1">{currentHF !== null && currentHF < 1.1 ? 'At Risk!' : 'Safe'}</div>
                        </div>

                        {/* Additional Stats Row */}
                        <div className="lg:col-span-2 p-5 border border-white/10 bg-white/[0.02] overflow-hidden">
                          <div className="font-mono text-[10px] uppercase text-[#888888] mb-2">Kimchi Premium</div>
                          <div className="flex items-center justify-between gap-2">
                            <div className={`text-2xl font-mono truncate ${isKimchiRisk ? 'text-[#FF6B6B]' : 'text-[#D4FF00]'}`}>{kimchi.toFixed(2)}%</div>
                            <div className={`text-xs px-2 py-1 rounded whitespace-nowrap ${isKimchiRisk ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                              {isKimchiRisk ? 'HIGH' : 'OK'}
                            </div>
                          </div>
                        </div>

                        <div className="lg:col-span-2 p-5 border border-white/10 bg-white/[0.02] overflow-hidden">
                          <div className="font-mono text-[10px] uppercase text-[#888888] mb-2">Oracle Price</div>
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-2xl font-mono text-white truncate">₩{fmtCompact(ethPrice)}</div>
                            <div className="text-xs text-[#888888] whitespace-nowrap">per ETH</div>
                          </div>
                        </div>
                      </section>
                    )}

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
                          <div className="grid grid-cols-[2fr_1fr_1fr_40px] font-mono text-[10px] uppercase text-[#888888] px-5 pb-4 opacity-50">
                            <span>Asset</span><span className="text-right">APY</span><span className="text-right">Balance</span><span />
                          </div>

                          <div onClick={() => selectMarket('UPETH')} className={`group grid grid-cols-[2fr_1fr_1fr_40px] items-center p-5 border cursor-pointer transition-all ${selection === 'UPETH' ? 'border-[#D4FF00] bg-white/[0.04]' : 'border-white/5 hover:border-[#D4FF00] bg-white/[0.02] hover:bg-white/[0.04]'}`}>
                            <div className="flex items-center space-x-3">
                              <svg className="w-8 h-8 flex-shrink-0" viewBox="0 0 32 32"><g fill="none" fillRule="evenodd"><circle cx="16" cy="16" r="16" fill="#627EEA"/><path fill="#FFF" fillOpacity=".602" d="M16.498 4v8.87l7.497 3.35z"/><path fill="#FFF" d="M16.498 4L9 16.22l7.498-3.35z"/><path fill="#FFF" fillOpacity=".602" d="M16.498 21.968l7.497-4.353-7.497-3.348z"/><path fill="#FFF" d="M9 17.615l7.498 4.353v-7.701z"/><path fill="#FFF" fillOpacity=".2" d="M16.498 20.573l7.497-4.353-7.497 10.291z"/><path fill="#FFF" fillOpacity=".602" d="M9 16.22l7.498 4.353v1.791z"/></g></svg>
                              <span className="font-bold text-lg">UPETH</span>
                            </div>
                            <div className="text-right font-mono text-[#D4FF00] text-lg">{supplyApy}%</div>
                            <div className="text-right font-mono text-[#888888]">{isConnected ? fmtCompact(upethBalance) : '-'}</div>
                            <div className="flex justify-end"><span className="material-symbols-outlined text-[#888888] group-hover:text-[#D4FF00] transition-colors">arrow_forward</span></div>
                          </div>

                          <div onClick={() => selectMarket('UPKRW')} className={`group grid grid-cols-[2fr_1fr_1fr_40px] items-center p-5 border-b border-x cursor-pointer transition-all mt-[-1px] ${selection === 'UPKRW' ? 'border-[#D4FF00] bg-white/[0.04]' : 'border-white/5 hover:border-white/20 bg-white/[0.01]'}`}>
                            <div className="flex items-center space-x-3">
                              <div className="w-8 h-8 flex-shrink-0 rounded-full bg-gradient-to-br from-red-500 to-blue-600 flex items-center justify-center text-xs font-bold text-white border border-white/10">₩</div>
                              <span className="font-bold text-lg">UPKRW</span>
                            </div>
                            <div className="text-right font-mono text-white text-lg">2.1%</div>
                            <div className="text-right font-mono text-[#888888]">{isConnected ? fmtCompact(upkrwBalance) : '-'}</div>
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
                          <div className="grid grid-cols-[2fr_1fr_1fr_40px] font-mono text-[10px] uppercase text-[#888888] px-5 pb-4 opacity-50">
                            <span>Asset</span><span className="text-right">Max LTV</span><span className="text-right">Liquidity</span><span />
                          </div>

                          <div onClick={() => selectMarket('UPETH_BORROW')} className={`group grid grid-cols-[2fr_1fr_1fr_40px] items-center p-5 border cursor-pointer transition-all ${selection === 'UPETH_BORROW' ? 'border-white bg-white/[0.05]' : 'border-white/5 hover:border-white hover:bg-white/[0.05] bg-white/[0.02]'}`}>
                            <div className="flex items-center space-x-3">
                              <svg className="w-8 h-8 flex-shrink-0" viewBox="0 0 32 32"><g fill="none" fillRule="evenodd"><circle cx="16" cy="16" r="16" fill="#627EEA"/><path fill="#FFF" fillOpacity=".602" d="M16.498 4v8.87l7.497 3.35z"/><path fill="#FFF" d="M16.498 4L9 16.22l7.498-3.35z"/><path fill="#FFF" fillOpacity=".602" d="M16.498 21.968l7.497-4.353-7.497-3.348z"/><path fill="#FFF" d="M9 17.615l7.498 4.353v-7.701z"/><path fill="#FFF" fillOpacity=".2" d="M16.498 20.573l7.497-4.353-7.497 10.291z"/><path fill="#FFF" fillOpacity=".602" d="M9 16.22l7.498 4.353v1.791z"/></g></svg>
                              <span className="font-bold text-lg">UPETH</span>
                            </div>
                            <div className="text-right font-mono text-[#888888] text-lg">92%</div>
                            <div className="text-right font-mono text-green-400 text-xs uppercase tracking-widest">Deep</div>
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
                    {/* Header */}
                    <div className="border-b border-white/10 pb-6 flex flex-col md:flex-row justify-between md:items-end gap-4">
                      <div>
                        <h1 className="text-4xl font-serif italic mb-2">Liquidation <span className="not-italic font-sans font-light text-[#888888]">Terminal</span></h1>
                        <p className="font-mono text-xs text-[#888888] max-w-md mt-2">Monitor undercollateralized positions.<br /><span className="text-[#FF6B6B]">Health Factor &lt; 1.0 = Liquidatable</span></p>
                      </div>
                      <div className="text-left md:text-right">
                        <div className="font-mono text-xs text-[#888888] mb-1">ORACLE PRICE</div>
                        <div className="font-mono text-xl text-white">1 ETH = {fmt(ethPrice)} KRW</div>
                      </div>
                    </div>

                    {/* Add Borrower to Check */}
                    <div className="p-6 border border-white/10 bg-white/[0.02]">
                      <div className="font-mono text-[10px] uppercase text-[#888888] mb-4">Check Borrower Position</div>
                      <div className="flex gap-4">
                        <input
                          type="text"
                          value={borrowerToCheck}
                          onChange={(e) => setBorrowerToCheck(e.target.value)}
                          placeholder="0x... borrower address"
                          className="flex-1 bg-transparent border border-white/20 px-4 py-3 font-mono text-sm text-white focus:outline-none focus:border-[#D4FF00] placeholder-white/30"
                        />
                        <button
                          onClick={handleCheckBorrower}
                          disabled={!borrowerToCheck || isLoadingPositions}
                          className="px-6 py-3 bg-[#D4FF00] text-black font-mono text-sm font-bold uppercase hover:bg-[#c4ef00] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {isLoadingPositions ? 'Checking...' : 'Check'}
                        </button>
                      </div>
                      <p className="font-mono text-[10px] text-[#888888] mt-2">Enter a borrower address to check their position and Health Factor</p>
                    </div>

                    {/* Positions Table */}
                    <div className="border border-white/10 bg-white/[0.02]">
                      <div className="p-4 border-b border-white/10 flex justify-between items-center">
                        <div className="font-mono text-[10px] uppercase text-[#888888]">Tracked Positions</div>
                        <div className="font-mono text-[10px] text-[#888888]">{liquidatablePositions.length} positions</div>
                      </div>

                      {liquidatablePositions.length === 0 ? (
                        <div className="p-12 text-center">
                          <span className="material-symbols-outlined text-4xl text-[#888888] mb-4">search</span>
                          <p className="font-mono text-sm text-[#888888]">No positions tracked yet</p>
                          <p className="font-mono text-xs text-[#888888] mt-1">Add a borrower address above to check their position</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-white/5">
                          {/* Table Header */}
                          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_120px] gap-4 px-4 py-3 font-mono text-[10px] uppercase text-[#888888]">
                            <span>Borrower</span>
                            <span className="text-right">Collateral</span>
                            <span className="text-right">Debt</span>
                            <span className="text-right">Health Factor</span>
                            <span className="text-right">Action</span>
                          </div>

                          {/* Position Rows */}
                          {liquidatablePositions.map((pos) => (
                            <div 
                              key={pos.borrower} 
                              className={`grid grid-cols-[2fr_1fr_1fr_1fr_120px] gap-4 px-4 py-4 items-center transition-colors ${
                                pos.healthFactor < 1 ? 'bg-red-500/10' : pos.healthFactor < 1.1 ? 'bg-orange-500/10' : ''
                              }`}
                            >
                              <div className="font-mono text-sm text-white truncate">
                                {pos.borrower.slice(0, 6)}...{pos.borrower.slice(-4)}
                              </div>
                              <div className="text-right font-mono text-sm text-white">
                                {fmtCompact(Number(pos.collateral) / 1e18)} <span className="text-[#888888]">UPKRW</span>
                              </div>
                              <div className="text-right font-mono text-sm text-white">
                                {pos.borrowAssets.toFixed(4)} <span className="text-[#888888]">UPETH</span>
                              </div>
                              <div className={`text-right font-mono text-lg font-bold ${
                                pos.healthFactor < 1 ? 'text-red-500' : 
                                pos.healthFactor < 1.1 ? 'text-orange-500' : 
                                pos.healthFactor < 1.5 ? 'text-yellow-500' : 'text-green-400'
                              }`}>
                                {pos.healthFactor.toFixed(2)}
                              </div>
                              <div className="text-right">
                                {pos.healthFactor < 1 ? (
                                  <button
                                    onClick={() => setSelectedBorrower(pos)}
                                    className="px-3 py-1.5 bg-[#FF6B6B] text-white font-mono text-xs font-bold uppercase hover:bg-red-400 transition-colors"
                                  >
                                    Liquidate
                                  </button>
                                ) : (
                                  <span className="font-mono text-xs text-[#888888]">Healthy</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Liquidation Panel */}
                    {selectedBorrower && (
                      <div className="p-6 border border-[#FF6B6B] bg-red-500/10">
                        <div className="flex justify-between items-start mb-6">
                          <div>
                            <div className="font-mono text-[10px] uppercase text-[#FF6B6B] mb-2">Liquidate Position</div>
                            <div className="font-mono text-lg text-white">{selectedBorrower.borrower.slice(0, 10)}...{selectedBorrower.borrower.slice(-8)}</div>
                          </div>
                          <button onClick={() => setSelectedBorrower(null)} className="text-[#888888] hover:text-white">
                            <span className="material-symbols-outlined">close</span>
                          </button>
                        </div>

                        <div className="grid grid-cols-3 gap-4 mb-6">
                          <div className="p-3 bg-black/20 border border-white/10">
                            <div className="font-mono text-[10px] uppercase text-[#888888] mb-1">Collateral</div>
                            <div className="font-mono text-lg text-white">{fmtCompact(Number(selectedBorrower.collateral) / 1e18)}</div>
                            <div className="font-mono text-xs text-[#888888]">UPKRW</div>
                          </div>
                          <div className="p-3 bg-black/20 border border-white/10">
                            <div className="font-mono text-[10px] uppercase text-[#888888] mb-1">Debt</div>
                            <div className="font-mono text-lg text-white">{selectedBorrower.borrowAssets.toFixed(4)}</div>
                            <div className="font-mono text-xs text-[#888888]">UPETH</div>
                          </div>
                          <div className="p-3 bg-black/20 border border-white/10">
                            <div className="font-mono text-[10px] uppercase text-[#888888] mb-1">Health Factor</div>
                            <div className="font-mono text-lg text-red-500">{selectedBorrower.healthFactor.toFixed(4)}</div>
                            <div className="font-mono text-xs text-[#FF6B6B]">Liquidatable!</div>
                          </div>
                        </div>

                        <div className="mb-6">
                          <div className="flex justify-between font-mono text-[10px] text-[#888888] mb-2 uppercase">
                            <label>Debt to Repay (UPETH)</label>
                            <span>Max Debt: {selectedBorrower.borrowAssets.toFixed(4)} UPETH</span>
                          </div>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={liquidateAmount}
                              onChange={(e) => { const v = e.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) setLiquidateAmount(v); }}
                              placeholder="0.00"
                              className="flex-1 bg-transparent border border-white/20 px-4 py-3 font-mono text-xl text-white focus:outline-none focus:border-[#FF6B6B] placeholder-white/30"
                            />
                            <button 
                              onClick={() => setLiquidateAmount(selectedBorrower.borrowAssets.toFixed(6))}
                              className="px-4 bg-white/10 hover:bg-white/20 text-white font-mono text-xs uppercase transition-colors"
                            >
                              MAX
                            </button>
                          </div>
                        </div>

                        <div className="p-3 bg-black/20 border border-white/10 mb-6">
                          <div className="flex justify-between text-sm mb-2">
                            <span className="font-mono text-[#888888]">Liquidation Incentive</span>
                            <span className="font-mono text-[#D4FF00]">+5%</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="font-mono text-[#888888]">You Receive (UPKRW)</span>
                            <span className="font-mono text-[#D4FF00]">
                              ~{liquidateAmount ? fmtCompact(parseFloat(liquidateAmount) * ethPrice * 1.05) : '0'} UPKRW
                            </span>
                          </div>
                        </div>

                        {liquidateTxStep === 'success' ? (
                          <div className="space-y-3">
                            <div className="p-4 border border-green-500/30 bg-green-500/10 text-center">
                              <span className="material-symbols-outlined text-green-400 text-2xl">check_circle</span>
                              <div className="font-mono text-sm text-green-400 mt-2">Liquidation Successful!</div>
                            </div>
                            {liquidateTxHash && (
                              <a
                                href={`https://sepolia-explorer.giwa.io/tx/${liquidateTxHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block w-full py-3 text-center text-[#D4FF00] border border-[#D4FF00]/30 font-mono text-sm hover:bg-[#D4FF00]/10 transition-colors"
                              >
                                View Transaction ↗
                              </a>
                            )}
                            <button
                              onClick={() => { setLiquidateTxStep('idle'); setLiquidateTxHash(null); }}
                              className="w-full py-2 text-xs text-[#888888] hover:text-white transition-colors font-mono"
                            >
                              [ New Liquidation ]
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={executeLiquidation}
                            disabled={!liquidateAmount || liquidateTxStep !== 'idle' || !isConnected || !oraclePrice}
                            className="w-full py-4 bg-[#FF6B6B] text-white font-mono font-bold uppercase tracking-wider hover:bg-red-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {liquidateTxStep === 'approving' ? 'Approving...' : 
                             liquidateTxStep === 'liquidating' ? 'Liquidating...' : 
                             'Execute Liquidation'}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Info Box */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="p-4 border border-white/10 bg-white/[0.02]">
                        <div className="flex items-start space-x-3">
                          <span className="material-symbols-outlined text-[#D4FF00]">info</span>
                          <div>
                            <div className="font-mono text-sm text-white mb-1">How Liquidation Works</div>
                            <p className="font-mono text-xs text-[#888888] leading-relaxed">
                              When Health Factor drops below 1.0, anyone can repay part of the borrower's debt and seize their collateral at a 5% discount.
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="p-4 border border-white/10 bg-white/[0.02]">
                        <div className="flex items-start space-x-3">
                          <span className="material-symbols-outlined text-[#FF6B6B]">warning</span>
                          <div>
                            <div className="font-mono text-sm text-white mb-1">Kimchi Premium Risk</div>
                            <p className="font-mono text-xs text-[#888888] leading-relaxed">
                              High kimchi premium ({kimchi.toFixed(1)}%) increases liquidation risk as oracle price may move against borrowers.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Faucet View */}
                {currentView === 'faucet' && (
                  <div className="fade-in space-y-8">
                    {/* Faucet Header */}
                    <div className="border-b border-white/10 pb-6">
                      <h1 className="font-serif italic text-4xl mb-2">Test Token Faucet</h1>
                      <p className="font-mono text-xs text-[#888888] max-w-lg">
                        Claim free test tokens to try out the protocol. One claim per wallet address.
                      </p>
                    </div>

                    {/* Faucet Card */}
                    <div className="max-w-xl mx-auto">
                      <div className="border border-[#D4FF00]/30 bg-[#D4FF00]/5 p-8">
                        <div className="text-center mb-8">
                          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#D4FF00]/10 border border-[#D4FF00]/30 mb-4">
                            <span className="material-symbols-outlined text-[#D4FF00] text-3xl">water_drop</span>
                          </div>
                          <h2 className="font-mono text-xl text-white mb-2">Claim Test Tokens</h2>
                          <p className="font-mono text-xs text-[#888888]">
                            Receive tokens instantly to your connected wallet
                          </p>
                        </div>

                        {/* Token Amounts */}
                        <div className="grid grid-cols-2 gap-4 mb-8">
                          <div className="p-4 border border-white/10 bg-white/[0.02] text-center">
                            <div className="flex items-center justify-center space-x-2 mb-2">
                              <svg className="w-6 h-6" viewBox="0 0 32 32"><g fill="none" fillRule="evenodd"><circle cx="16" cy="16" r="16" fill="#627EEA"/><path fill="#FFF" fillOpacity=".602" d="M16.498 4v8.87l7.497 3.35z"/><path fill="#FFF" d="M16.498 4L9 16.22l7.498-3.35z"/></g></svg>
                              <span className="font-mono text-sm text-[#888888]">UPETH</span>
                            </div>
                            <div className="font-mono text-2xl text-[#D4FF00]">10</div>
                          </div>
                          <div className="p-4 border border-white/10 bg-white/[0.02] text-center">
                            <div className="flex items-center justify-center space-x-2 mb-2">
                              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-red-500 to-blue-600 flex items-center justify-center text-[10px] font-bold text-white">₩</div>
                              <span className="font-mono text-sm text-[#888888]">UPKRW</span>
                            </div>
                            <div className="font-mono text-2xl text-[#D4FF00]">50,000,000</div>
                          </div>
                        </div>

                        {/* Claim Button */}
                        {!isConnected ? (
                          <div className="text-center p-4 border border-white/10 bg-white/[0.02]">
                            <span className="font-mono text-sm text-[#888888]">Connect wallet to claim tokens</span>
                          </div>
                        ) : hasClaimedData ? (
                          <div className="text-center p-4 border border-green-500/30 bg-green-500/10">
                            <span className="material-symbols-outlined text-green-400 text-2xl mb-2">check_circle</span>
                            <div className="font-mono text-sm text-green-400">Already Claimed</div>
                            <p className="font-mono text-xs text-[#888888] mt-1">You have already received test tokens</p>
                          </div>
                        ) : (
                          <button
                            onClick={async () => {
                              if (!address) return
                              setFaucetTxStep('claiming')
                              try {
                                writeContract({
                                  address: ADDRESSES.FAUCET,
                                  abi: faucetAbi,
                                  functionName: 'claim',
                                })
                              } catch (err) {
                                logError('Faucet claim error:', err)
                                setFaucetTxStep('idle')
                              }
                            }}
                            disabled={faucetTxStep === 'claiming' || isTxPending}
                            className="w-full py-4 bg-[#D4FF00] text-black font-mono font-bold uppercase tracking-wider hover:bg-[#c4ef00] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {faucetTxStep === 'claiming' || isTxPending ? 'Claiming...' : 'Claim Tokens'}
                          </button>
                        )}

                        {/* Faucet Balance Info */}
                        <div className="mt-6 pt-6 border-t border-white/10">
                          <div className="font-mono text-[10px] uppercase text-[#888888] mb-3">Faucet Remaining Balance</div>
                          <div className="grid grid-cols-2 gap-4 text-center">
                            <div>
                              <div className="font-mono text-sm text-white">
                                {faucetBalanceData ? Number(formatUnits(faucetBalanceData[1] as bigint, 18)).toLocaleString() : '-'}
                              </div>
                              <div className="font-mono text-[10px] text-[#888888]">UPETH</div>
                            </div>
                            <div>
                              <div className="font-mono text-sm text-white">
                                {faucetBalanceData ? Number(formatUnits(faucetBalanceData[0] as bigint, 18)).toLocaleString() : '-'}
                              </div>
                              <div className="font-mono text-[10px] text-[#888888]">UPKRW</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Info */}
                      <div className="mt-6 p-4 border border-white/10 bg-white/[0.02]">
                        <div className="flex items-start space-x-3">
                          <span className="material-symbols-outlined text-[#D4FF00]">info</span>
                          <div>
                            <div className="font-mono text-sm text-white mb-1">Test Tokens Only</div>
                            <p className="font-mono text-xs text-[#888888] leading-relaxed">
                              These tokens have no real value and are for testing purposes only on GIWA Sepolia testnet.
                            </p>
                          </div>
                        </div>
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
                    <button onClick={() => { setActionMode('supply'); setInputAmount(''); setTxStep('idle'); setSimulatedHF(null); }} className={`flex-1 py-2 text-xs font-mono uppercase transition-colors ${actionMode === 'supply' ? 'bg-[#D4FF00] text-black' : 'text-[#888888] hover:text-white'}`}>
                      {selection === 'UPETH_BORROW' ? 'Borrow' : 'Supply'}
                    </button>
                    <button onClick={() => { setActionMode('withdraw'); setInputAmount(''); setTxStep('idle'); setSimulatedHF(null); }} className={`flex-1 py-2 text-xs font-mono uppercase transition-colors ${actionMode === 'withdraw' ? 'bg-[#FF6B6B] text-black' : 'text-[#888888] hover:text-white'}`}>
                      {selection === 'UPETH_BORROW' ? 'Repay' : 'Withdraw'}
                    </button>
                  </div>

                  {/* Asset Info */}
                  <div className="flex items-center space-x-4 mb-8">
                    {getPanelAsset() === 'UPETH' ? (
                      <svg className="w-10 h-10 flex-shrink-0" viewBox="0 0 32 32"><g fill="none" fillRule="evenodd"><circle cx="16" cy="16" r="16" fill="#627EEA"/><path fill="#FFF" fillOpacity=".602" d="M16.498 4v8.87l7.497 3.35z"/><path fill="#FFF" d="M16.498 4L9 16.22l7.498-3.35z"/><path fill="#FFF" fillOpacity=".602" d="M16.498 21.968l7.497-4.353-7.497-3.348z"/><path fill="#FFF" d="M9 17.615l7.498 4.353v-7.701z"/><path fill="#FFF" fillOpacity=".2" d="M16.498 20.573l7.497-4.353-7.497 10.291z"/><path fill="#FFF" fillOpacity=".602" d="M9 16.22l7.498 4.353v1.791z"/></g></svg>
                    ) : (
                      <div className="w-10 h-10 flex-shrink-0 rounded-full bg-gradient-to-br from-red-500 to-blue-600 flex items-center justify-center text-sm font-bold text-white border border-white/10">₩</div>
                    )}
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
                      <input type="text" inputMode="decimal" value={inputAmount} onChange={(e) => { const v = e.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) simulate(v); }} className="w-full bg-transparent border-b border-white/20 py-4 text-4xl font-mono text-white focus:outline-none focus:border-[#D4FF00] transition-colors placeholder-white/10" placeholder="0.00" />
                      <button onClick={() => simulate(getMaxAmount().toString())} disabled={getMaxAmount() === 0 || !isConnected} className="absolute right-0 top-1/2 -translate-y-1/2 text-[10px] font-bold bg-white/10 hover:bg-white/20 text-white px-2 py-1 uppercase transition-colors disabled:opacity-30 disabled:cursor-not-allowed">MAX</button>
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
                        <input type="text" inputMode="decimal" value={collateralAmount} onChange={(e) => { const v = e.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) { setCollateralAmount(v); if (inputAmount) { setSimulatedHF(calculateHealthFactor(parseFloat(inputAmount), parseFloat(v) || 0)); } } }} className={`w-full bg-transparent py-2 text-xl font-mono focus:outline-none placeholder-white/10 ${collateralAmount && parseFloat(collateralAmount) > upkrwBalance ? 'text-red-500' : 'text-white'}`} placeholder="0" />
                        <button onClick={() => { setCollateralAmount(upkrwBalance.toString()); if (inputAmount) { setSimulatedHF(calculateHealthFactor(parseFloat(inputAmount), upkrwBalance)); } }} disabled={upkrwBalance === 0 || !isConnected} className="text-[10px] font-bold bg-white/10 hover:bg-white/20 text-white px-2 py-1 uppercase transition-colors disabled:opacity-30 disabled:cursor-not-allowed">MAX</button>
                      </div>
                      {collateralAmount && parseFloat(collateralAmount) > upkrwBalance && (
                        <div className="text-xs text-red-500 font-mono mt-1">잔액 초과 (최대: {fmtCompact(upkrwBalance)})</div>
                      )}
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

                  {/* General Error Message (replaces alert()) */}
                  {errorMessage && (
                    <div className="mb-4 p-4 border-2 border-red-500 bg-red-500/20">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="material-symbols-outlined text-red-500">error</span>
                          <span className="font-mono text-sm text-red-400">{errorMessage}</span>
                        </div>
                        <button onClick={() => setErrorMessage(null)} className="text-red-400 hover:text-red-300">
                          <span className="material-symbols-outlined text-sm">close</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* CRITICAL: HF Error Messages */}
                  {selection === 'UPETH_BORROW' && actionMode === 'supply' && simulatedHF !== null && simulatedHF < 1.0 && (
                    <div className="mb-4 p-4 border-2 border-red-500 bg-red-500/20">
                      <div className="flex items-start space-x-3">
                        <span className="material-symbols-outlined text-red-500 text-xl">error</span>
                        <div>
                          <div className="font-mono text-sm text-red-500 font-bold mb-1">TRANSACTION BLOCKED</div>
                          <p className="font-mono text-xs text-red-400 leading-relaxed">
                            Health Factor {simulatedHF.toFixed(2)} is below 1.0. Your position would be immediately liquidatable. 
                            Reduce borrow amount or increase collateral.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Warning: HF between 1.0 - 1.1 */}
                  {selection === 'UPETH_BORROW' && actionMode === 'supply' && simulatedHF !== null && simulatedHF >= 1.0 && simulatedHF < 1.1 && (
                    <div className="mb-4 p-4 border border-orange-500 bg-orange-500/10">
                      <div className="flex items-start space-x-3">
                        <span className="material-symbols-outlined text-orange-500">warning</span>
                        <div>
                          <div className="font-mono text-sm text-orange-500 font-bold mb-1">HIGH RISK POSITION</div>
                          <p className="font-mono text-xs text-orange-400 leading-relaxed">
                            Health Factor {simulatedHF.toFixed(2)} is very low. Small price movements could trigger liquidation.
                            Consider adding more collateral for safety.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Disabled Reason Display */}
                  {getDisabledReason() && txStep === 'idle' && (
                    <div className="mb-4 p-3 border border-white/20 bg-white/5">
                      <p className="font-mono text-xs text-[#888888] text-center">
                        {getDisabledReason()}
                      </p>
                    </div>
                  )}

                  {/* Action Button */}
                  <div className="mt-8 space-y-3">
                    <button onClick={handleButtonClick} disabled={isButtonDisabled()} className={`w-full py-5 font-bold font-mono uppercase tracking-widest text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${executionStatus === 'confirmed' ? 'bg-[#D4FF00] text-black' : actionMode === 'withdraw' ? 'bg-[#FF6B6B] text-black hover:bg-red-400' : (actionMode === 'supply' && simulatedHF !== null && simulatedHF < 1.0) ? 'bg-red-900 text-red-300 cursor-not-allowed' : 'bg-white text-black hover:bg-[#D4FF00]'}`}>
                      {executionStatus === 'confirmed' ? 'CONFIRMED' : (actionMode === 'supply' && simulatedHF !== null && simulatedHF < 1.0) ? 'BLOCKED: HF TOO LOW' : getButtonText()}
                    </button>

                    {selection === 'UPETH_BORROW' && actionMode === 'supply' && txStep !== 'idle' && (
                      <div className="text-[10px] text-center text-[#888888] mt-2 font-mono">
                        <p className="text-[#D4FF00]">
                          {txStep === 'approving' && 'Step 1/3: Approving collateral...'}
                          {txStep === 'approved' && 'Step 2/3: Supply collateral'}
                          {txStep === 'supplying_collateral' && 'Step 2/3: Supplying collateral...'}
                          {txStep === 'collateral_supplied' && 'Step 3/3: Borrow UPETH'}
                          {txStep === 'borrowing' && 'Step 3/3: Borrowing...'}
                        </p>
                      </div>
                    )}

                    {/* TX Hash Display */}
                    {txHash && txStep !== 'idle' && (
                      <a 
                        href={`https://sepolia-explorer.giwa.io/tx/${txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[#D4FF00] hover:underline font-mono text-center block"
                      >
                        View transaction ↗
                      </a>
                    )}

                    <button onClick={() => selectMarket(null)} className="w-full py-2 text-xs text-[#888888] hover:text-white transition-colors font-mono">[ Cancel ]</button>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </main>

        {/* Toast Notification */}
        {toastMessage && (
          <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-white/10 backdrop-blur-sm border border-white/20 px-6 py-3 rounded-sm fade-in">
            <span className="font-mono text-sm text-white">{toastMessage}</span>
          </div>
        )}
      </div>
    </>
  )
}
