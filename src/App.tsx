import { WagmiProvider } from 'wagmi'
import { QueryClientProvider } from '@tanstack/react-query'
import { wagmiAdapter, queryClient } from './config/appkit'
import Dashboard from './components/Dashboard'
import './App.css'

function App() {
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <Dashboard />
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export default App
