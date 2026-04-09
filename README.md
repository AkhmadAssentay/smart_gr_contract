# Multi-Signature Treasury for Student Clubs

> **CSCI 435 — Blockchain Project**
> A 2-of-3 multi-signature wallet for student organizations where any spending must be approved by at least 2 out of 3 executives.

**Author:** Akhmed Assentay (Student ID: 201842715)

---

## Overview

Student clubs handle shared budgets but often lack transparent financial controls. This project implements a **multi-signature treasury smart contract** on Ethereum that enforces collective decision-making: no single executive can spend club funds alone.

```
┌─────────────────────────────────────────────────────────────┐
│                    STUDENT CLUB TREASURY                     │
│                                                              │
│  Anyone can deposit ETH ──► Treasury Balance                 │
│                                                              │
│  SPENDING FLOW (2-of-3 Multi-Sig)                            │
│                                                              │
│  1. Executive proposes:  "Buy T-shirts — 0.5 ETH"           │
│                  ↓  (proposer auto-approved)                 │
│  2. Executive A: Approve   (1/2)                             │
│     Executive B: Approve   (2/2) <- threshold reached        │
│                  ↓                                           │
│  3. Any executive executes -> ETH sent to recipient          │
│                                                              │
│  3 Executives: President | Vice-President | Treasurer        │
└─────────────────────────────────────────────────────────────┘
```

---

## Features

| Feature | Description |
|---------|-------------|
| 2-of-3 multi-sig | No single executive controls funds |
| Proposer auto-approval | Proposer's vote counts immediately (1/2 from the start) |
| Revocable approvals | Executives can change their mind before execution |
| 7-day proposal expiry | Stale proposals can be cancelled after one week |
| Per-category budget caps | Set spending limits per category (e.g. Events, Equipment) |
| Emergency pause | 2-of-3 vote pauses all spending; 2-of-3 to unpause |
| Executive replacement | Replace a wallet address via 2-of-3 approval |
| Executive aliases | Pseudonymity — display a name instead of a raw wallet address |
| Donor leaderboard | On-chain tracking of top contributors |
| Open deposits | Anyone (members, sponsors) can fund the treasury |
| Full event logging | Every action emits an event for auditability |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contract | Solidity ^0.8.20 |
| Framework | Hardhat |
| Testing | Chai + Hardhat Network (75 tests) |
| Frontend | HTML + CSS + ethers.js v6 |
| Network | Hardhat local / Ethereum Sepolia Testnet |
| Wallet | MetaMask |

---

## Project Structure

```
smart_gr_contract/
├── contracts/
│   └── MultiSigTreasury.sol      # Core smart contract
├── test/
│   └── MultiSigTreasury.test.js  # 75 automated tests
├── scripts/
│   └── deploy.js                 # Deployment script
├── frontend/
│   └── index.html                # Single-page DApp
├── docs/
│   ├── documentation.tex         # LaTeX report source
│   └── documentation.pdf         # Compiled report (16 pages)
├── hardhat.config.js
└── package.json
```

---

## Setup & Run (Step by Step)

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- [MetaMask](https://metamask.io/) browser extension
- A terminal / command prompt

### Step 1 — Clone and install dependencies

```bash
git clone https://github.com/AkhmadAssentay/smart_gr_contract.git
cd smart_gr_contract
npm install
```

### Step 2 — Compile the contract

```bash
npx hardhat compile
```

Expected output: `Compiled 1 Solidity file successfully`

### Step 3 — Run the test suite

```bash
npx hardhat test
```

Expected output: `75 passing`

### Step 4 — Start a local blockchain node

Open **Terminal 1** and run:

```bash
npx hardhat node
```

Leave this running. It will print 20 funded accounts with their private keys — copy accounts #0, #1, and #2 to import into MetaMask.

### Step 5 — Deploy the contract

Open **Terminal 2** and run:

```bash
npx hardhat run scripts/deploy.js --network localhost
```

Copy the deployed contract address printed in the output, for example:

```
Deploying MultiSigTreasury...
Deployer (Exec 1): 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Executive 2:       0x70997970C51812dc3A010C7d01b50e0d17dc79C8
Executive 3:       0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC

MultiSigTreasury deployed to: 0x5FbDB2315678afecb367f032d93F642f64180aa3
```

### Step 6 — Configure MetaMask

1. Open MetaMask and add a custom network:
   - **Network name:** Hardhat Local
   - **RPC URL:** `http://127.0.0.1:8545`
   - **Chain ID:** `31337`
   - **Currency symbol:** ETH
2. Import Account #0, #1, and #2 from the Hardhat node output using their private keys (click Import Account in MetaMask, paste the private key).

### Step 7 — Open the DApp

1. Open `frontend/index.html` in your browser
2. At the top of the file, update the `CONTRACT_ADDRESS` variable with the address from Step 5
3. Open the file in your browser (or use `npx serve frontend` for a local server)
4. Click **Connect MetaMask**
5. You are ready to use the treasury

---

## Using the DApp

### Propose a transaction
1. Fill in the recipient address, amount in ETH, category, and description
2. Click **Submit Proposal** — your vote is auto-counted (1/2 reached instantly)

### Approve and execute
1. Switch MetaMask to a second executive account
2. Find the proposal and click **Approve** — now at 2/2
3. Click **Execute** to send the ETH to the recipient

### Set your alias (Pseudonymity)
- Each executive can set a display name (e.g. "President-K") in the **Your Display Alias** panel
- The DApp shows the alias instead of the raw wallet address
- The real address is visible on hover (tooltip)

### Emergency pause
- Any executive clicks **Vote to Pause**
- A second executive clicks **Vote to Pause** — contract is now paused, no spending possible
- Same 2-of-3 process to unpause

### Category budgets
- Set a spending cap per category (e.g. Events: 5 ETH, Equipment: 2 ETH)
- Proposals that would exceed the cap are rejected immediately at submission

### Executive replacement
- Propose replacing an executive wallet address via the Governance panel
- Requires 2 approvals before the swap takes effect

---

## Smart Contract API

| Function | Access | Description |
|----------|--------|-------------|
| `deposit()` | Anyone | Send ETH to the treasury |
| `proposeTransaction(to, value, description, category)` | Executive | Create a proposal (proposer auto-approved) |
| `approveTransaction(txIndex)` | Executive | Approve a proposal |
| `revokeApproval(txIndex)` | Executive | Revoke your approval |
| `executeTransaction(txIndex)` | Executive | Execute (requires 2 approvals) |
| `cancelExpiredTransaction(txIndex)` | Executive | Cancel a proposal older than 7 days |
| `setCategoryBudget(category, amount)` | Executive | Set a spending cap for a category |
| `getCategoryInfo(category)` | Anyone | View budget and spent amount for a category |
| `votePause()` | Executive | Vote to pause all spending |
| `voteUnpause()` | Executive | Vote to unpause |
| `proposeReplacement(oldExec, newExec)` | Executive | Propose swapping an executive address |
| `approveReplacement(id)` | Executive | Approve a replacement proposal |
| `executeReplacement(id)` | Executive | Execute an approved replacement |
| `setAlias(name)` | Executive | Set your display alias |
| `getAliasOrAddress(exec)` | Anyone | Returns alias or hex address |
| `getBalance()` | Anyone | View treasury ETH balance |
| `getTransaction(txIndex)` | Anyone | View proposal details |
| `getExecutives()` | Anyone | List all 3 executive addresses |
| `getDonorCount()` | Anyone | Number of unique donors |
| `getDonor(index)` | Anyone | Donor address and total donated |

---

## Test Coverage

75 tests across 12 groups — all passing:

| Group | Tests |
|-------|-------|
| Deployment | 5 |
| Deposits & Donor Leaderboard | 7 |
| Emergency Pause | 11 |
| Category Budget Caps | 8 |
| Propose Transaction | 5 |
| Approve Transaction | 5 |
| Revoke Approval | 3 |
| Execute Transaction | 7 |
| Transaction Expiry | 5 |
| Executive Replacement | 6 |
| Executive Aliases | 7 |
| End-to-End Scenarios | 5 |
| **Total** | **75** |

---

## Security

1. **Re-entrancy guard** — `executed = true` is set before the external `.call{}`
2. **Access control** — all sensitive functions use the `onlyExecutive` modifier
3. **Double-approve prevention** — `hasApproved` mapping blocks duplicate votes
4. **Budget enforcement** — category cap is checked at proposal time, not execution
5. **Pause circuit-breaker** — halts all spending in case of emergency
6. **Expiry mechanism** — proposals older than 7 days can be cancelled

---

## Deploy to Sepolia Testnet

1. Get Sepolia ETH from a faucet (e.g. sepoliafaucet.com)
2. Create a `.env` file (never commit this file):

```
SEPOLIA_RPC_URL=https://rpc.sepolia.org
PRIVATE_KEY=your_private_key_here
```

3. Deploy:

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

---

## License

MIT
