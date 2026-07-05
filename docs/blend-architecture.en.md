# Blend Protocol — On-Chain System Design

> A reference for understanding how Blend structures a **lending pool** on Stellar/Soroban.
> Source: [Blend tech docs](https://docs.blend.capital) + the `@blend-capital/blend-sdk` types used in this repo.

---

## 1. Mental Model

Blend is a **pool-based, isolated lending protocol**. Anyone can permissionlessly deploy an isolated lending pool. Each pool has its own reserves, risk parameters, oracle, and its own **backstop** slot (first-loss insurance). Risk in one pool **cannot spill into another**.

Only the **Pool** contract is user-facing for lend/borrow. The other six contracts are shared infrastructure that a Pool depends on, but they don't know about each other's internals — each has exactly one job.

```
                         ┌──────────────┐
                         │   Emitter    │  mints 1 BLND / second, forever
                         │ (BLND faucet)│
                         └──────┬───────┘
                                │ 100% of emissions, protocol-wide
                                ▼
     ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
     │ Pool Factory │───▶│    Backstop  │◀──▶│    Comet     │
     │ deploys pools│    │ insurance +  │    │ 80/20 BLND:  │
     └──────┬───────┘    │ emission hub │    │ USDC AMM (LP)│
            │            └──────┬───────┘    └──────────────┘
            │ creates           │ gates Active/On-Ice/Frozen
            ▼                   │ take-rate interest in
     ┌──────────────────────────┴───────────────────┐
     │                   POOL (isolated)             │
     │  reserves · bTokens/dTokens · positions ·     │
     │  interest model · auctions · status           │
     └───────────────┬───────────────────────────────┘
                     │ price queries
                     ▼
              ┌────────────────┐
              │ Oracle (SEP-40)│  USD prices, immutable per pool
              └────────────────┘
```

The diagram shows *what* is connected. §2 below walks through concrete sequences — *when* and *why* each arrow actually fires.

---

## 2. End-to-End Flows — How the Contracts Depend on Each Other

This is the part a static contract list can't show: the order of calls, and what one contract needs from another before it will act.

### 2.1 Bootstrapping a Pool: Factory → Pool → Backstop

1. Someone calls **Pool Factory** to deploy: `(admin, name, oracle, backstop_take_rate, max_positions, min_collateral)` → a new **Pool** is created with status `Setup` — nothing works yet.
2. Admin adds reserves (assets + CF/LF/rate params). The pool still has **zero backstop deposits**.
3. Per the status rule (§10), a pool **cannot become `Active` with a backstop below threshold** — so at this point, lenders/borrowers still can't do anything, even though reserves are configured.
4. Backstop depositors must show up: they deposit **Comet LP tokens (80/20 BLND:USDC)** into *this pool's* slot inside the shared **Backstop** contract.
5. Once backstop deposits cross the threshold (and < 50% is queued for withdrawal), the Pool reads that state and flips its own status to `Active`.
6. Only now can `Supply` / `SupplyCollateral` / `Borrow` succeed.

**The dependency in one sentence:** the Pool contract *reads* the Backstop's per-pool deposit total + withdrawal-queue % to decide its own status — that's the only thing Backstop knows about a Pool. Backstop has no concept of "reserves," "collateral factor," or "bToken"; it only tracks one LP-deposit number and a queue, per pool.

### 2.2 Everyday Lending Loop (Pool ↔ Oracle)

1. User calls `Pool.submit({ request_type: SupplyCollateral, ... })`.
2. Pool debits the user's wallet for the asset, mints bTokens.
3. On a `Borrow` request, Pool calls **Oracle.lastprice()** for every asset the user holds or wants to borrow, computes Health Factor, and only proceeds if `HF > 1.0`.
4. Backstop and Comet are **not involved** in this loop at all — they only enter the picture when interest is generated (§2.3) or a position goes unhealthy (§2.4).

### 2.3 The Emission Loop — and Why BLND's Price Isn't Automatically Defended

This is the flow behind the question *"Emitter mints 1 BLND/sec forever, so the BLND sitting in Backstop keeps growing — how is the price maintained with no new USDC coming in?"* Traced second-by-second:

**Every second, forever:**
```
Emitter mints 1 BLND ──▶ sent to the Backstop contract (protocol-wide, not per-pool)
```
Backstop splits that 1 BLND/sec across every pool currently in the **reward zone**, proportional to each pool's backstop size, then splits each pool's share **70% to that pool's backstop depositors / 30% to that pool's lenders & borrowers**.

**What happens when a backstop depositor claims their 70% share?**
The claimed BLND is auto-deposited into Comet **single-sided** (BLND only, no matching USDC) to mint new LP tokens, which are re-deposited into the depositor's backstop position. A single-sided deposit into an 80/20 weighted pool is **mathematically identical to partially selling that asset into the pool** — this falls directly out of the AMM's constant-value invariant; it isn't a design choice Blend can switch off.

Concrete numbers. Say Comet's BLND:USDC pool currently holds:
```
BLND balance: 800,000          USDC balance: 50,000
spot price of BLND = (USDC/0.2) / (BLND/0.8) = (50,000/0.2) / (800,000/0.8) = 0.25 USDC/BLND
check: 800,000 × 0.25 = 200,000 USD of BLND vs 50,000 USD of USDC → 80/20 ✓
```
Suppose over one day this pool's backstop depositors collectively accrue and claim **10,000 BLND** in emissions (auto-deposited single-sided, per the mechanism above):
```
New BLND balance: 810,000      USDC balance: unchanged, 50,000
New spot price = (50,000/0.2) / (810,000/0.8) = 250,000 / 1,012,500 ≈ 0.2469 USDC/BLND
```
**BLND's price inside Comet just dropped ~1.2%** — purely from claiming and auto-compounding the emission. This repeats **every single day, forever**, because the Emitter never stops. Nothing in Pool, Backstop, or Comet burns BLND or buys it back to offset this.

**What pushes back against it?**
Only **new capital entering from outside** — someone becoming a *new* backstop depositor via a **single-sided USDC deposit** (they don't hold BLND yet, so Comet converts for them):
```
Someone deposits 5,000 fresh USDC, single-sided, into the same pool (BLND: 800,000 / USDC: 50,000):
New USDC balance: 55,000       BLND balance: unchanged, 800,000
New spot price = (55,000/0.2) / (800,000/0.8) = 275,000 / 1,000,000 = 0.275 USDC/BLND (+10%)
```
This is the "buy pressure" mentioned in earlier discussion — but note it is the **opposite direction** from the emission-compounding flow above, and the two are not the same mechanism:

| | Direction | Trigger |
|---|---|---|
| Emission auto-compound (BLND single-sided into Comet) | pushes BLND price **down** | automatic, every second, guaranteed |
| New backstop depositor (USDC single-sided into Comet) | pushes BLND price **up** | voluntary, only if someone chooses to join |

**Honest conclusion:** Blend's contracts do not defend BLND's price. It's a race between a **guaranteed, continuous supply-side dilution** (1 BLND/sec forever, auto-compounded) and a **voluntary, demand-side inflow** (new backstop depositors, which only shows up if a pool's real yield — driven by take-rate interest, §7 — looks attractive enough). If pool growth doesn't keep pulling in new backstop capital faster than emissions dilute, the mechanical dilution wins by default. This is the same dynamic as most emission-funded governance tokens — nothing Blend-specific compensates for it on-chain.

**The other 30%** (pool users' share) is simpler: paid straight to the lender/borrower's wallet as raw BLND — no auto-deposit into Comet. Whether it gets sold, held, or used to *become* a fresh backstop depositor (adding buy pressure) is entirely up to that user.

### 2.4 Liquidation & Bad-Debt Flow: Pool → Backstop → Comet

1. A borrower's Health Factor drops below 1.0 (oracle price move, or debt interest accrual).
2. **Anyone** calls `Pool.submit({ request_type: FillUserLiquidationAuction, ... })`. The Pool runs the ~400-block Dutch auction itself — Backstop isn't involved yet.
3. If the borrower's collateral is fully consumed by the liquidation but debt remains (**bad debt**), that debt moves out of the Pool and onto the **Backstop**'s books for that pool.
4. Backstop starts a **bad-debt auction (type 7)**: it puts up its own Comet LP holdings as the lot; a liquidator repays the bad debt to receive them.
5. Only if the Backstop's own deposits are insufficient to cover the shortfall does the remainder get **socialized across the pool's lenders** (a haircut on lender bToken value) — the last-resort step, triggered only after the Backstop layer is already exhausted.

---

## 3. Contract Reference

Quick lookup for the 7 contracts — see §2 for how they actually interact.

| Contract | One-line role | Key state | SDK |
|----------|---------------|-----------|-----|
| **Pool** | Isolated lend/borrow market; the only user-facing contract | reserves, positions, status, admin, oracle addr | `PoolV2`, `PoolContractV2`, `PoolMetadata` |
| **Pool Factory** | Permissionlessly deploys new pools (§2.1) | registry of deployed pool addresses | `PoolFactoryContractV2` |
| **Backstop** | First-loss insurance + emission router; gates pool status (§2.1, §2.4) | per-pool LP deposit total, withdrawal queue, reward-zone membership | `BackstopContractV2`, `BackstopPoolV2` |
| **Emitter** | Mints exactly 1 BLND/sec to the Backstop, nothing else (§2.3) | emission rate (fixed), current Backstop recipient | — |
| **BLND** | Governance token; required as 80% of backstop LP deposits | supply | — |
| **Comet** | 80/20 BLND:USDC weighted AMM; the only way to mint backstop LP tokens (§2.3) | BLND/USDC reserve balances | — |
| **Oracle (SEP-40)** | USD price feed, `lastprice()`/`decimals()`, immutable per pool (§2.2) | — | — |

---

## 4. Asset Accounting: Reserves, bTokens, dTokens

### Reserve
One supported asset inside a pool, with its own config:

| Param | Meaning |
|-------|---------|
| Collateral Factor (CF) | How much of this asset's value counts as collateral `[0–1]` |
| Liability Factor (LF) | Risk weighting applied to borrows of this asset `[0–1]` |
| Target Utilization `U_T` | Desired borrow/supply ratio `[0–0.95]` |
| Rate params | `R_base, R_1, R_2, R_3`, reactivity constant |
| Utilization cap | Max borrowable % (protects collateral-only assets) |
| Supply cap | Max total supply (protects vs. issuer/mint risk) |
| Enabled | Active flag |

### bTokens — the **supply** side
When you supply, you receive **bTokens**: `bTokens = amount / bTokenRate`.
`bTokenRate` starts at `1.0` and **grows as interest accrues** (rate `1.1` ⇒ each bToken is worth 1.1 underlying). Interest is accrued **discretely** per second-elapsed to save gas.

### dTokens — the **debt** side
When you borrow, you owe **dTokens** (non-transferable, removed only by repayment):
`dTokenRate = (bTokenTotalSupply × bTokenRate − PoolAssetBalance) / dTokenTotalSupply`, and `dTokens = amount / dTokenRate`.

In the SDK these appear as `reserve.totalSupplyFloat()`, `reserve.totalLiabilitiesFloat()`, `reserve.getUtilizationFloat()`, and per-user `getCollateralFloat / getSupplyFloat / getLiabilitiesFloat`.

---

## 5. `submit()` Request Types

Every user action is a `Request` fed to `Pool.submit({ from, spender, to, requests: [...] })`. The `request_type` enum (matches `RequestType` in the SDK):

| # | Type | Effect |
|---|------|--------|
| 0 | **Supply** | Deposit asset → mint bTokens. Earns interest; withdrawable anytime if liquidity exists. Not usable as collateral. |
| 1 | **Withdraw** | Burn bTokens → get asset + accrued interest back. |
| 2 | **SupplyCollateral** | Like Supply, but the position is tagged as collateral → enables borrowing. |
| 3 | **WithdrawCollateral** | Burn collateral bTokens → get asset back. Reverts if it would drop you below your borrow requirement. |
| 4 | **Borrow** | Mint dTokens, receive asset. Requires Health Factor > 1.0. |
| 5 | **Repay** | Burn dTokens, pay back principal + interest. Partial repay allowed. |
| 6–9 | Auction fills | `FillUserLiquidationAuction`, `FillBadDebtAuction`, `FillInterestAuction`, `DeleteLiquidationAuction` — flow traced in §2.4, mechanics in §9. |

**In this repo:** `deposit.ts` builds a request with `RequestType.SupplyCollateral`; `get-position.ts` reads the resulting position back.

---

## 6. Interest Rate Model (three-leg + reactive)

Borrow APR is a piecewise function of utilization `U`, scaled by a **Rate Modifier (RM)**:

- **Leg 1** (`U ≤ U_T`): `IR = RM × (R_base + (U/U_T)·R_1)`
- **Leg 2** (`U_T < U ≤ 0.95`): `IR = RM × (R_base + R_1 + ((U−U_T)/(0.95−U_T))·R_2)`
- **Leg 3** (`U > 0.95`, crisis): `IR = RM × (R_base + R_1 + R_2) + ((U−0.95)/0.05)·R_3`

**Rate Modifier** is the self-tuning part: `RM_t = (ΔSeconds × (U_T − U)) × reactivity + RM_{t−1}`, bounded `[0.1, 100]`. If utilization stays above target, RM climbs and pushes rates up until borrowers repay / lenders arrive; below target it falls. This keeps each market near its target utilization **without governance intervention**.

Set `U_T` **high** for assets meant to be borrowed (e.g. USDC), **low** for pure collateral assets.

---

## 7. Backstop Take Rate

`BackstopRewardAmount = BorrowerInterestPaid × BackstopTakeRate`.
Set at pool creation, immutable, capped at 100%. This is the interest flow labeled "take-rate interest in" in the §1 diagram — it's the real, non-emission revenue that's supposed to make backstop deposits worth it (see the demand-side half of §2.3). Higher-risk pools set a higher take rate to attract insurance capital; low-risk pools set it low.

---

## 8. Emissions — Quick Reference

Full mechanism and the dilution question are traced in **§2.3**. Summary:

- 1 BLND/sec, split **70% backstop depositors / 30% pool users**, only for **reward-zone** pools (top ~10 by backstop size, +1 slot every 97 days).
- Backstop depositor claims auto-compound through Comet (§2.3) — dilutive to BLND price, mechanically.
- Pool user claims go straight to wallet — user decides what to do with it.
- Feedback loop: backstop bigger than TVL → more emissions to users → more activity → TVL grows → more take-rate interest to backstop → more backstop deposits attracted. Self-balancing, but purely demand-driven (see §2.3).

---

## 9. Health Factor & Auction Mechanics

**Borrow Limit** = `Σ(collateralValue × CF) − Σ(liabilityValue / LF)`.
**Health Factor** = `Borrow Limit / Current Liabilities`.
- `HF > 1.0` → healthy. `HF < 1.0` → liquidatable by anyone (flow: §2.4).

Three Dutch-style auction types (all fill via `submit`):

- **Liquidation auction (type 6):** started when `HF < 1.0`. Initiator picks a liability % such that post-liquidation HF lands in ~`1.03–1.15`. Auction runs ~400 blocks: **blocks 0–200** the collateral lot ramps 0→100% (bid = full liability); **blocks 200–400** the required bid ramps down to 0 (lot = full collateral). Partial fills allowed.
- **Bad-debt auction (type 7):** Backstop auctions its Comet LP holdings to cover debt that survived liquidation (§2.4).
- **Interest auction (type 8):** distributes the backstop's accrued interest back to depositors (bid = backstop LP, lot = accrued pool assets), proceeds re-deposited.

---

## 10. Pool Status

| Status | Supply | Borrow | Withdraw | Repay |
|--------|:------:|:------:|:--------:|:-----:|
| **Active** | ✅ | ✅ | ✅ | ✅ |
| **On-Ice** | ✅ | ❌ | ✅ | ✅ |
| **Frozen** | ❌ | ❌ | ✅ | ✅ |

Status is driven by **backstop health** (§2.1) — admin may only make it *more* restrictive:
- → **Active:** backstop ≥ threshold AND < 50% queued for withdrawal.
- → **On-Ice:** backstop < threshold OR ≥ 50% queued.
- → **Frozen:** ≥ 75% queued.

**Standard pools** = fully immutable (params change only via migration). **Owned pools** = admin may tweak most params *except oracle & take rate*.

In the SDK, `PoolMetadata.status` / `PoolV2` expose this as a `u8` (`0 = Active`, ...).

---

## 11. How This Maps to the SDK (this repo)

| Goal | SDK call | File |
|------|----------|------|
| List a pool + reserves | `PoolMetadata.load`, `PoolV2.load` | `list-pool.ts` |
| Deposit as collateral | `PoolContractV2.submit` + `RequestType.SupplyCollateral` | `deposit.ts` |
| Read a user position | `PoolV2.loadUser` → `getCollateralFloat / getLiabilitiesFloat` | `get-position.ts` |

Key gotcha learned here: a **pool id** and an **asset (token) id** are different contracts. Loading a token contract with `PoolMetadata.load` throws `LedgerEntryParseError: ... should not contain METADATA`, because the pool loader expects the V2 pool storage layout, not a token's. Testnet V2 pool: `CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF`.

---

## 12. One-Line Summaries

- **Pool** — isolated lend/borrow market; the only user-facing contract.
- **Pool Factory** — permissionlessly deploys pools.
- **Backstop** — first-loss insurance + emissions router; gates pool status.
- **Emitter** — mints 1 BLND/sec to the Backstop; nothing else.
- **BLND** — governance token, 80% of backstop LP.
- **Comet** — 80/20 BLND:USDC AMM producing backstop LP tokens; where emission dilution and fresh-capital buy pressure actually happen (§2.3).
- **Oracle** — SEP-40 USD price feed, immutable per pool.
