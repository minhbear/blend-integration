import { Network, pools } from "./constant";
import { getKeypair, resolveAsset, floatToBaseUnits, loadReserve } from "./lib";
import { buildDepositTx } from "./build-tx";
import { sendTransaction } from "./send-tx";

// Supply an asset AS COLLATERAL (enables borrowing against it).
// SECRET_KEY is read from .env. Edit ASSET / AMOUNT below to change the deposit.
const POOL_ID = pools[Network.TESTNET].TestnetV2;
const ASSET = "XLM"; // symbol (XLM, USDC, ...) or a raw contract id
const AMOUNT = 100; // human units

(async () => {
  const keypair = getKeypair();
  const from = keypair.publicKey();

  // 1. resolve: human amount → base units (needs the reserve's decimals)
  const assetId = resolveAsset(ASSET);
  const { reserve } = await loadReserve(POOL_ID, assetId);
  const amount = floatToBaseUnits(AMOUNT, reserve.config.decimals);

  // 2. build the transaction (BE's "build tx" layer)
  const tx = await buildDepositTx({ poolId: POOL_ID, from, assetId, amount });

  // 3. send it (BE's "send tx" layer: simulate → sign → broadcast → confirm)
  await sendTransaction(tx, keypair);
  console.log(`Supplied ${AMOUNT} ${ASSET} as collateral.`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
