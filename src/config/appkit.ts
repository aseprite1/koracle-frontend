import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { QueryClient } from '@tanstack/react-query'
import type { AppKitNetwork } from '@reown/appkit/networks'

// Giwa Sepolia configuration
export const giwaSepoliaNetwork = {
  id: 91342,
  name: 'GIWA Sepolia',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: ['https://sepolia-rpc.giwa.io'] },
    public: { http: ['https://sepolia-rpc.giwa.io'] },
  },
  blockExplorers: {
    default: { name: 'GIWA Explorer', url: 'https://sepolia-explorer.giwa.io' },
  },
  testnet: true,
} as const satisfies AppKitNetwork

// Project ID from Reown Dashboard
export const projectId = '51a18daee71282dd511b5b7b65cc904e'

// Query client for React Query
export const queryClient = new QueryClient()

// Metadata
const metadata = {
  name: 'Koracle Lending',
  description: 'Lending protocol with kimchi premium liquidation on Giwa Chain',
  url: 'https://koracle.finance',
  icons: ['https://koracle.finance/icon.png']
}

// Networks
const networks = [giwaSepoliaNetwork]

// Wagmi Adapter
export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: false
})

// Create AppKit instance
createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata,
  features: {
    analytics: false,
    email: false,
    socials: [],
    swaps: false,
    onramp: false,
  },
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#D4FF00',
    '--w3m-color-mix': '#000000',
    '--w3m-border-radius-master': '0px',
  }
})
