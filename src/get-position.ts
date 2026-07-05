import "dotenv/config";
import { PoolV2 } from "@blend-capital/blend-sdk";
import { Keypair } from "@stellar/stellar-sdk";
import { Network, networks, pools, assets } from "./constant";

const network = networks[Network.TESTNET];

const POOL_ID = pools[Network.TESTNET].TestnetV2;

// Either pass a public key (G...) directly, or derive it from SECRET_KEY.
const USER_ID =
  process.env.USER_ID ??
  (process.env.SECRET_KEY
    ? Keypair.fromSecret(process.env.SECRET_KEY).publicKey()
    : undefined);

const symbolByAsset = Object.fromEntries(
  Object.entries(assets[Network.TESTNET]).map(([sym, id]) => [id, sym])
);

if (!USER_ID) throw new Error("Set USER_ID (G...) or SECRET_KEY env var");

(async () => {
  const pool = await PoolV2.load(network, POOL_ID);
  const user = await pool.loadUser(USER_ID!);

  console.log(`=== Position for ${USER_ID} in ${pool.metadata.name} ===\n`);

  let hasAny = false;
  // Iterate reserves; the SDK returns 0 for positions the user doesn't hold.
  for (const [assetId, reserve] of pool.reserves) {
    const sym = symbolByAsset[assetId] ?? assetId;
    const collateral = user.getCollateralFloat(reserve);
    const supply = user.getSupplyFloat(reserve);
    const liabilities = user.getLiabilitiesFloat(reserve);
    if (collateral || supply || liabilities) {
      hasAny = true;
      console.log(`[${sym}]`);
      if (collateral) console.log(`  collateral: ${collateral}`);
      if (supply) console.log(`  supply:     ${supply}`);
      if (liabilities) console.log(`  borrowed:   ${liabilities}`);
    }
  }

  if (!hasAny) console.log("(no positions yet — run deposit.ts first)");
})();
