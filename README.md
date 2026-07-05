# blend-integration

Reference scripts and reusable helpers for integrating with **[Blend Capital](https://blend.capital)** lending pools on **Stellar / Soroban**.

This repo does two things at once:

1. **Runnable scripts** to exercise a Blend V2 pool on **testnet** — list the pool, fund a wallet, and run the full lending loop (deposit → borrow → repay → withdraw) plus read positions.
2. **A backend reference** — the transaction logic is split into an independent **build** layer and **send** layer, so the same code can be lifted into a backend where building and broadcasting transactions are separate concerns.

Everything targets the Blend **TestnetV2** pool (`CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF`), which holds four reserves: **XLM, USDC, wETH, wBTC**.

---

## Prerequisites

- **Node.js** ≥ 18 (tested on 22)
- **pnpm** (repo uses a `pnpm-lock.yaml`)
- A Stellar **testnet** account secret key (`S...`). One is generated for you below.

---

## Install

```bash
pnpm install
```

---

## Setup

Create a `.env` file at the repo root with your testnet account secret:

```bash
# .env
SECRET_KEY=S...your_testnet_secret...
```

Don't have a keypair yet? Generate one:

```bash
node -e "const {Keypair}=require('@stellar/stellar-sdk');const k=Keypair.random();console.log('SECRET_KEY='+k.secret());console.error('ADDRESS '+k.publicKey())"
```

Then fund it with test assets (XLM via Friendbot; USDC / BLND / wETH / wBTC via Blend's testnet faucet):

```bash
pnpm faucet
```

> `.env` is git-ignored. Never commit a secret key.

---

## Usage

Each script reads `SECRET_KEY` from `.env`. Run any of:

| Command | What it does |
|---------|--------------|
| `pnpm list-pool` | Print pool metadata + every reserve (APY, utilization, totals). No account needed. |
| `pnpm faucet` | Fund the `.env` account with XLM + USDC + BLND + wETH + wBTC. |
| `pnpm deposit` | Supply an asset **as collateral** (default: 100 XLM). |
| `pnpm borrow` | Borrow against your collateral (default: 1 USDC). |
| `pnpm repay` | Repay debt (default: **max** — the full outstanding USDC). |
| `pnpm withdraw` | Withdraw collateral (default: **max** XLM). |
| `pnpm position` | Print your current collateral / supply / debt in the pool. |

### Full test loop

```bash
pnpm faucet       # get test assets
pnpm deposit      # supply 100 XLM as collateral
pnpm borrow       # borrow 1 USDC against it
pnpm position     # → collateral: 100 XLM, borrowed: 1 USDC
pnpm repay        # repay all USDC debt
pnpm withdraw     # withdraw all XLM collateral
pnpm position     # → empty
```

### Changing asset / amount

Amounts and assets are **constants at the top of each script** (not env vars). Edit them directly:

```ts
// src/deposit.ts
const ASSET = "XLM"; // symbol (XLM, USDC, wETH, wBTC) or a raw contract id
const AMOUNT = 100;  // human units
```

For `repay` / `withdraw`, `AMOUNT` also accepts `"max"` to clear the full position.

> Note: `borrow` requires collateral to already be posted, and `withdraw`/`repay` act on an existing position — so run them in an order that makes sense (e.g. deposit before borrow; repay before withdrawing all collateral).

---

## Folder structure

```
blend-integration/
├── src/
│   ├── constant.ts      Network config, pool ids, asset (token) contract ids
│   ├── lib.ts           Shared helpers: env/keypair, asset & amount resolution, reserve loading
│   ├── build-tx.ts      BUILD layer — build*Tx() return unsigned transactions
│   ├── send-tx.ts       SEND layer  — sendTransaction() simulates, signs, broadcasts, confirms
│   │
│   ├── deposit.ts       Script: supply collateral   (resolve → build → send)
│   ├── borrow.ts        Script: borrow
│   ├── repay.ts         Script: repay
│   ├── withdraw.ts      Script: withdraw collateral
│   ├── list-pool.ts     Script: read pool + reserves
│   ├── get-position.ts  Script: read a user's position
│   └── faucet.ts        Script: fund an account with test assets
│
├── docs/
│   └── blend-architecture.en.md   How Blend's on-chain system works (pools, backstop, emissions, ...)
├── .env                 Your SECRET_KEY (git-ignored)
├── .env.example         Template
└── package.json
```

---

## Architecture: build vs send

Transaction logic is deliberately split so it maps onto a backend where the two responsibilities live in different services.

**`build-tx.ts` — build layer.** Turns an intent into an **unsigned** `Transaction`. It does not sign, simulate, or broadcast. Amounts are passed in **base units** (`bigint`); human→base conversion (which needs the reserve's decimals) is the caller's job.

```ts
import { buildDepositTx } from "./build-tx";

const tx = await buildDepositTx({ poolId, from, assetId, amount }); // Promise<Transaction>
```

Builders available: `buildDepositTx`, `buildWithdrawTx`, `buildBorrowTx`, `buildRepayTx`, and the generic `buildSubmitTx({ poolId, from, requests })` for batching multiple requests into one atomic `pool.submit` call.

**`send-tx.ts` — send layer.** Takes a built transaction (or an array) and runs the full network lifecycle: **simulate → sign → broadcast → poll**. It knows nothing about pools or assets.

```ts
import { sendTransaction } from "./send-tx";

await sendTransaction(tx, keypair);        // one tx  → one result
await sendTransaction([tx1, tx2], keypair); // many    → results[]
```

So every action script reads as three clear steps:

```ts
// resolve → build → send
const amount = floatToBaseUnits(AMOUNT, reserve.config.decimals); // resolve
const tx = await buildDepositTx({ poolId, from, assetId, amount }); // build
await sendTransaction(tx, keypair);                                 // send
```

> A Blend `submit` call carries an **array of requests** processed atomically in a single contract invocation — it is one operation, not one-request-per-instruction. Use `buildSubmitTx` to combine actions (e.g. repay + withdraw) in one transaction.

---

## Reference

- `docs/blend-architecture.en.md` — deep dive on Blend's on-chain design (pools, reserves, backstop, Comet, emissions, liquidations).
- [Blend integration docs](https://docs.blend.capital/tech-docs/integrations/integrate-pool)
- [`@blend-capital/blend-sdk`](https://www.npmjs.com/package/@blend-capital/blend-sdk)
