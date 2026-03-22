# 🏦 Multi-Signature Treasury for Student Clubs

> **CSCI 435 — Blockchain Project**
> A 2-of-3 multi-signature wallet for student organizations where any spending must be approved by at least 2 out of 3 executives.

**Group 3:** Akhmed Assentay, Abylay Zhumagaliyev

---

## 📖 Overview

Student clubs handle shared budgets but often lack transparent financial controls. This project implements a **multi-signature treasury smart contract** on Ethereum that enforces collective decision-making: no single executive can spend club funds alone.

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    STUDENT CLUB TREASURY                     │
│                                                              │
│  Anyone can deposit ETH ──► 💰 Treasury Balance              │
│                                                              │
│  ┌──────────────────────────────────────────────────┐       │
│  │  SPENDING FLOW (2-of-3 Multi-Sig)                │       │
│  │                                                    │       │
│  │  1. Executive proposes:  "Buy T-shirts — 0.5 ETH" │       │
│  │                  ↓                                  │       │
│  │  2. Executive A: ✅ Approve   (1/2)                │       │
│  │     Executive B: ✅ Approve   (2/2) ← threshold!  │       │
│  │     Executive C: (not needed)                       │       │
│  │                  ↓                                  │       │
│  │  3. Any executive executes → ETH sent to recipient │       │
│  └──────────────────────────────────────────────────┘       │
│                                                              │
│  3 Executives: President | Vice-President | Treasurer        │
└─────────────────────────────────────────────────────────────┘
```

### Key Features

- **2-of-3 approval threshold** — no single person controls the funds
- **Transparent proposals** — every spend is on-chain with a description
- **Revocable approvals** — executives can change their mind before execution
- **Open deposits** — anyone (club members, sponsors) can fund the treasury
- **Event logging** — all actions emit events for full auditability

---

## 🛠️ Tech Stack

| Layer        | Technology                      |
|-------------|----------------------------------|
| Smart Contract | Solidity ^0.8.20              |
| Framework    | Hardhat                         |
| Testing      | Chai + Hardhat Network          |
| Frontend     | HTML + CSS + ethers.js v6       |
| Network      | Ethereum Sepolia Testnet        |
| Wallet       | MetaMask                        |

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [MetaMask](https://metamask.io/) browser extension
- Sepolia testnet ETH ([faucet](https://sepoliafaucet.com/))

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_REPO/multisig-treasury.git
cd multisig-treasury
npm install
```

### 2. Compile the Contract

```bash
npm run compile
```

### 3. Run Tests

```bash
npm run test
```

You should see all tests passing:

```
  MultiSigTreasury
    Deployment
      ✓ should set 3 executives correctly
      ✓ should mark each address as executive
      ✓ should reject deployment with != 3 executives
      ...
    Execute Transaction
      ✓ should execute with 2 approvals (happy path)
      ✓ should REJECT with only 1 approval
      ...
    End-to-End: Student Club Scenario
      ✓ full workflow: deposit → propose → approve × 2 → execute
      ✓ multiple proposals in parallel
```

### 4. Deploy

**Local (Hardhat Network):**
```bash
# Terminal 1: Start local blockchain
npm run node

# Terminal 2: Deploy
npm run deploy:local
```

**Sepolia Testnet:**
```bash
# Create a .env file (NEVER commit this!)
echo "SEPOLIA_RPC_URL=https://rpc.sepolia.org" >> .env
echo "PRIVATE_KEY=your_private_key_here" >> .env

npm run deploy:sepolia
```

### 5. Launch Frontend

1. Open `frontend/index.html` in your browser
2. Paste your deployed contract address in the `CONTRACT_ADDRESS` variable in the HTML file
3. Click **Connect MetaMask**
4. Start proposing and approving transactions!

---

## 📁 Project Structure

```
multisig-treasury/
├── contracts/
│   └── MultiSigTreasury.sol    # Core smart contract
├── test/
│   └── MultiSigTreasury.test.js # 20+ test cases
├── scripts/
│   └── deploy.js               # Deployment script
├── frontend/
│   └── index.html              # Single-page DApp frontend
├── hardhat.config.js           # Hardhat configuration
├── package.json
└── README.md
```

---

## 📜 Smart Contract API

| Function | Access | Description |
|----------|--------|-------------|
| `deposit()` | Anyone | Send ETH to the treasury |
| `proposeTransaction(to, value, description)` | Executive | Create a new spending proposal |
| `approveTransaction(txIndex)` | Executive | Vote yes on a proposal |
| `revokeApproval(txIndex)` | Executive | Take back your approval |
| `executeTransaction(txIndex)` | Executive | Execute (requires ≥2 approvals) |
| `getBalance()` | Anyone | View treasury balance |
| `getTransaction(txIndex)` | Anyone | View proposal details |
| `getExecutives()` | Anyone | List all 3 executives |

---

## 🧪 Test Coverage

The test suite covers:

- **Deployment** — correct initialization, rejects invalid inputs (duplicates, zero address, wrong count)
- **Deposits** — via `receive()` and `deposit()`, events, zero-value rejection
- **Proposals** — correct storage, events, access control, balance check
- **Approvals** — single approval, double-approval rejection, non-executive rejection
- **Revocation** — undo approval, edge cases
- **Execution** — happy path (2/3), full approval (3/3), rejection (1/3 and 0/3), double-execution prevention
- **End-to-End** — complete student club scenario, parallel proposals

---

## 🔒 Security Considerations

1. **Re-entrancy**: `executed` flag is set *before* the external call
2. **Access control**: All sensitive functions are gated by `onlyExecutive`
3. **Double-approve prevention**: `hasApproved` mapping prevents duplicate votes
4. **Balance check**: Both at proposal time and execution time
5. **Zero address check**: Constructor rejects `address(0)`

---

## 📄 License

MIT
