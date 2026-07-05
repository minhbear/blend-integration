import { Network, pools } from "./constant";
import { getKeypair, resolveAsset, resolveAmount, loadReserve } from "./lib";
import { buildWithdrawTx } from "./build-tx";
import { sendTransaction } from "./send-tx";

// Withdraw supplied COLLATERAL. AMOUNT = "max" withdraws your full collateral
// position (the pool caps to your balance). Reverts if it would drop your
// Health Factor below 1.0 while you still have debt — repay first.
// SECRET_KEY is read from .env. Edit ASSET / AMOUNT below to change the withdraw.
//
// Note: this withdraws a *collateral* position (matches `deposit`). For a plain
// non-collateral supply, use buildSubmitTx with RequestType.Withdraw.
const POOL_ID = pools[Network.TESTNET].TestnetV2;
const ASSET = "XLM"; // symbol (XLM, USDC, ...) or a raw contract id
const AMOUNT: number | "max" = "max"; // human units, or "max" for all

(async () => {
  const keypair = getKeypair();
  const from = keypair.publicKey();

  // 1. resolve: number → base units, or "max" → live collateral * 1.005
  const assetId = resolveAsset(ASSET);
  const { pool, reserve } = await loadReserve(POOL_ID, assetId);
  const { amount, isMax } = await resolveAmount(pool, reserve, String(AMOUNT), from, "withdrawCollateral");

  // 2. build → 3. send
  const tx = await buildWithdrawTx({ poolId: POOL_ID, from, assetId, amount });
  await sendTransaction(tx, keypair);
  console.log(`Withdrew ${isMax ? "all" : AMOUNT} ${ASSET} collateral.`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
