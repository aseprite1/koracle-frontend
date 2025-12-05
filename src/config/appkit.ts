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

// Project ID from Reown Dashboard (via environment variable)
export const projectId = import.meta.env.VITE_REOWN_PROJECT_ID || ''

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
const networks: [AppKitNetwork, ...AppKitNetwork[]] = [giwaSepoliaNetwork]

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
    emailShowWallets: false,
  },
  enableWalletGuide: false,
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#D4FF00',
    '--w3m-color-mix': '#000000',
    '--w3m-border-radius-master': '0px',
  },
  // Custom chain icon for GIWA Sepolia (fixes loading spinner)
  chainImages: {
    91342: '/giwa-logo.png'
  }
})
