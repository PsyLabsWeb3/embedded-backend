# Embedded Smart Contracts (Base)

This folder contains the treasury contract for the Embedded Miniapp on the Base blockchain.

## What it does

- Holds ETH in a treasury (contract balance)
- Accepts deposits as **entry fees** (`depositEntryFee(matchId)`) or plain ETH transfers
- Allows **owner-only withdrawals** (`withdraw(to, amount)`) for end of season distribution
- Includes `pause/unpause` to stop deposits in emergencies

---

## Setup

```bash
cd embedded-backend/smart-contracts
npm i
cp .env.example .env
```

Fill in `.env`:
- `PRIVATE_KEY` (deployer wallet)
- optionally custom RPC URLs

## Compile & test

```bash
npm run build
npm test
```

## Deploy

### Base Sepolia

```bash
npm run deploy:base-sepolia
```

### Base Mainnet

```bash
npm run deploy:base
```

The deploy script prints the deployed contract address.

---

## Contract API (EmbeddedMiniappTreasury)

- `depositEntryFee(bytes32 matchId)` (payable)
- `withdraw(address payable to, uint256 amount)` (owner-only)
- `pause()` / `unpause()` (owner-only)
- `balance()` view

---