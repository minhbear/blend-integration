import { Network, pools } from "./constant";
import { getKeypair, resolveAsset, resolveAmount, loadReserve } from "./lib";
import { buildRepayTx } from "./build-tx";
import { sendTransaction } from "./send-tx";

// Repay borrowed debt. AMOUNT = "max" repays the full outstanding liability
// (the pool caps the request to what you owe). You must hold enough of the
// asset to cover principal + accrued interest.
// SECRET_KEY is read from .env. Edit ASSET / AMOUNT below to change the repay.
const POOL_ID = pools[Network.TESTNET].TestnetV2;
const ASSET = "USDC"; // symbol (XLM, USDC, ...) or a raw contract id
const AMOUNT: number | "max" = "max"; // human units, or "max" for all

(async () => {
  const keypair = getKeypair();
  const from = keypair.publicKey();

  // 1. resolve: number → base units, or "max" → live liability * 1.005
  const assetId = resolveAsset(ASSET);
  const { pool, reserve } = await loadReserve(POOL_ID, assetId);
  const { amount, isMax } = await resolveAmount(pool, reserve, String(AMOUNT), from, "repay");

  // 2. build → 3. send
  const tx = await buildRepayTx({ poolId: POOL_ID, from, assetId, amount });
  await sendTransaction(tx, keypair);
  console.log(`Repaid ${isMax ? "all" : AMOUNT} ${ASSET} debt.`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
