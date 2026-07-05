import { Network, pools } from "./constant";
import { getKeypair, resolveAsset, floatToBaseUnits, loadReserve } from "./lib";
import { buildBorrowTx } from "./build-tx";
import { sendTransaction } from "./send-tx";

// Borrow an asset against your posted collateral. Requires Health Factor > 1.0.
// The borrowed asset is transferred to your wallet.
// SECRET_KEY is read from .env. Edit ASSET / AMOUNT below to change the borrow.
const POOL_ID = pools[Network.TESTNET].TestnetV2;
const ASSET = "USDC"; // symbol (XLM, USDC, ...) or a raw contract id
const AMOUNT = 1; // human units

(async () => {
  const keypair = getKeypair();
  const from = keypair.publicKey();

  // 1. resolve: human amount → base units
  const assetId = resolveAsset(ASSET);
  const { reserve } = await loadReserve(POOL_ID, assetId);
  const amount = floatToBaseUnits(AMOUNT, reserve.config.decimals);

  // 2. build → 3. send
  const tx = await buildBorrowTx({ poolId: POOL_ID, from, assetId, amount });
  await sendTransaction(tx, keypair);
  console.log(`Borrowed ${AMOUNT} ${ASSET}.`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
