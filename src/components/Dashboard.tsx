import { useAccount, useReadContract } from 'wagmi'
import { formatUnits } from 'viem'
import { ADDRESSES, MARKET_ID, morphoAbi, oracleAbi } from '../config/contracts'
import { giwaSepoliaNetwork } from '../config/appkit'

export default function Dashboard() {
  const { address, isConnected } = useAccount()

  // Read market data
  const { data: marketData } = useReadContract({
    address: ADDRESSES.MORPHO,
    abi: morphoAbi,
    functionName: 'market',
    args: [MARKET_ID],
    chainId: giwaSepoliaNetwork.id,
  })

  // Read ETH price
  const { data: ethPrice } = useReadContract({
    address: ADDRESSES.ORACLE,
    abi: oracleAbi,
    functionName: 'price',
    chainId: giwaSepoliaNetwork.id,
  })

  // Read kimchi premium
  const { data: kimchiPremium } = useReadContract({
    address: ADDRESSES.ORACLE,
    abi: oracleAbi,
    functionName: 'kimchiPremium',
    chainId: giwaSepoliaNetwork.id,
  })

  // Calculate stats
  const totalSupply = marketData ? Number(formatUnits(marketData[0], 18)).toFixed(4) : '0'
  const totalBorrow = marketData ? Number(formatUnits(marketData[2], 18)).toFixed(4) : '0'
  const ethPriceKrw = ethPrice ? Math.round(1 / Number(formatUnits(ethPrice, 18)) * 4566000) : 0
  const kimchiPercent = kimchiPremium ? (Number(formatUnits(kimchiPremium, 18)) * 100).toFixed(2) : '0'

  const utilization = marketData && marketData[0] > 0n
    ? (Number(marketData[2]) / Number(marketData[0]) * 100).toFixed(2)
    : '0'
  const supplyApy = (parseFloat(utilization) * 0.8).toFixed(2)
  const borrowApy = utilization

  const tvlKrw = marketData && ethPrice
    ? Math.round(Number(formatUnits(marketData[0], 18)) * (1 / Number(formatUnits(ethPrice, 18))) * 4566000)
    : 0

  return (
    <div style={{
      minHeight: '100vh',
      background: '#030303',
      color: '#E2E2E2',
      fontFamily: 'monospace',
      padding: '2rem'
    }}>
      {/* Header */}
      <header style={{
        borderBottom: '1px solid #1F1F1F',
        paddingBottom: '2rem',
        marginBottom: '3rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontStyle: 'italic', marginBottom: '0.5rem' }}>
            Koracle Lending
          </h1>
          <p style={{ fontSize: '0.75rem', color: '#888888', textTransform: 'uppercase' }}>
            GIWA CHAIN • KIMCHI PREMIUM LIQUIDATION
          </p>
        </div>
        <appkit-button />
      </header>

      {/* Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '1.5rem',
        marginBottom: '3rem'
      }}>
        <div style={{ background: '#080808', padding: '1.5rem', border: '1px solid #1F1F1F' }}>
          <p style={{ fontSize: '0.625rem', color: '#888888', marginBottom: '0.5rem' }}>TVL (KRW)</p>
          <p style={{ fontSize: '1.5rem' }}>{tvlKrw.toLocaleString()}</p>
        </div>
        <div style={{ background: '#080808', padding: '1.5rem', border: '1px solid #1F1F1F' }}>
          <p style={{ fontSize: '0.625rem', color: '#888888', marginBottom: '0.5rem' }}>ETH PRICE (KRW)</p>
          <p style={{ fontSize: '1.5rem' }}>{ethPriceKrw.toLocaleString()}</p>
        </div>
        <div style={{ background: '#080808', padding: '1.5rem', border: '1px solid #1F1F1F' }}>
          <p style={{ fontSize: '0.625rem', color: '#888888', marginBottom: '0.5rem' }}>KIMCHI PREMIUM</p>
          <p style={{ fontSize: '1.5rem', color: '#D4FF00' }}>{kimchiPercent}%</p>
        </div>
      </div>

      {/* Markets */}
      <div>
        <h2 style={{ fontSize: '0.75rem', color: '#888888', marginBottom: '1.5rem' }}>ACTIVE MARKETS</h2>

        {/* Supply Market */}
        <div style={{
          background: '#080808',
          border: '1px solid #1F1F1F',
          padding: '1.5rem',
          marginBottom: '1rem',
          cursor: 'pointer',
          transition: 'border-color 0.2s'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.125rem', marginBottom: '0.25rem' }}>UPETH</h3>
              <p style={{ fontSize: '0.625rem', color: '#888888' }}>SUPPLY MARKET</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '1.5rem', color: '#00FF88' }}>{supplyApy}%</p>
              <p style={{ fontSize: '0.625rem', color: '#888888' }}>APY</p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
            <div>
              <p style={{ fontSize: '0.625rem', color: '#888888', marginBottom: '0.25rem' }}>TOTAL SUPPLY</p>
              <p>{totalSupply} UPETH</p>
            </div>
            <div>
              <p style={{ fontSize: '0.625rem', color: '#888888', marginBottom: '0.25rem' }}>YOUR SUPPLY</p>
              <p>{isConnected ? '0 UPETH' : '--'}</p>
            </div>
            <div>
              <p style={{ fontSize: '0.625rem', color: '#888888', marginBottom: '0.25rem' }}>AVAILABLE</p>
              <p>{isConnected ? '0 UPETH' : '--'}</p>
            </div>
          </div>
        </div>

        {/* Borrow Market */}
        <div style={{
          background: '#080808',
          border: '1px solid #1F1F1F',
          padding: '1.5rem',
          cursor: 'pointer',
          transition: 'border-color 0.2s'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.125rem', marginBottom: '0.25rem' }}>UPETH</h3>
              <p style={{ fontSize: '0.625rem', color: '#888888' }}>BORROW MARKET (UPKRW COLLATERAL)</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '1.5rem', color: '#FF3366' }}>{borrowApy}%</p>
              <p style={{ fontSize: '0.625rem', color: '#888888' }}>APY</p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
            <div>
              <p style={{ fontSize: '0.625rem', color: '#888888', marginBottom: '0.25rem' }}>TOTAL BORROW</p>
              <p>{totalBorrow} UPETH</p>
            </div>
            <div>
              <p style={{ fontSize: '0.625rem', color: '#888888', marginBottom: '0.25rem' }}>YOUR BORROW</p>
              <p>{isConnected ? '0 UPETH' : '--'}</p>
            </div>
            <div>
              <p style={{ fontSize: '0.625rem', color: '#888888', marginBottom: '0.25rem' }}>MAX LTV</p>
              <p>92%</p>
            </div>
          </div>
        </div>
      </div>

      {!isConnected && (
        <div style={{
          marginTop: '2rem',
          padding: '1rem',
          background: '#080808',
          border: '1px solid #1F1F1F',
          textAlign: 'center',
          color: '#888888'
        }}>
          Connect your wallet to start using Koracle Lending
        </div>
      )}
    </div>
  )
}
