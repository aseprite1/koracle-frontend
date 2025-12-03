# Koracle Lending Frontend

Modern React frontend for Koracle Lending Protocol on Giwa Chain with multi-wallet support.

## Features

✅ **Multi-Wallet Support** - MetaMask, Rabby, Coinbase, Trust, OKX, Phantom, Rainbow
✅ **No Wallet Conflicts** - Uses Reown AppKit (WalletConnect) with EIP-6963
✅ **Real-time Data** - Live TVL, ETH price, kimchi premium from blockchain
✅ **Dark Theme** - Custom Koracle brand colors
✅ **TypeScript** - Type-safe contract interactions with wagmi + viem

## Tech Stack

- **React 18** + **TypeScript** + **Vite**
- **Reown AppKit** (WalletConnect v2) - Multi-wallet connection
- **wagmi v2** - React hooks for Ethereum
- **viem** - TypeScript Ethereum library
- **TanStack Query** - Data fetching and caching

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Deployed Contracts (Giwa Sepolia)

- **CustomMorpho**: `0xf31D0A92Ab90096a5d895666B5dEDA3639d185B2`
- **UPETH**: `0xc05bAe1723bd929306B0ab8125062Efc111fb338`
- **UPKRW**: `0x159C54accF62C14C117474B67D2E3De8215F5A72`
- **Oracle**: `0x258d90F00eEd27c69514A934379Aa41Cc03ea875`
- **IRM**: `0xA99676204e008B511dA8662F9bE99e2bfA5afd63`

## Network: Giwa Sepolia

- **Chain ID**: 91342 (0x164de)
- **RPC**: https://sepolia-rpc.giwa.io
- **Explorer**: https://sepolia-explorer.giwa.io

---

# Original Vite Template Notes

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
