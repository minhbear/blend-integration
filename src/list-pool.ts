import { PoolMetadata, PoolV2 } from "@blend-capital/blend-sdk";
import { Network, networks, pools, assets } from "./constant";

const network = networks[Network.TESTNET];

// Reverse lookup: asset contract id -> symbol, so reserves print readably.
const symbolByAsset = Object.fromEntries(
  Object.entries(assets[Network.TESTNET]).map(([sym, id]) => [id, sym])
);

(async () => {
  const poolId = pools[Network.TESTNET].TestnetV2;

  // 1) Lightweight metadata (name, oracle, reserve list, status).
  const metadata = await PoolMetadata.load(network, poolId);
  console.log("=== Pool Metadata ===");
  console.log("name:        ", metadata.name);
  console.log("status:      ", metadata.status);
  console.log("oracle:      ", metadata.oracle);
  console.log("backstop:    ", metadata.backstop);
  console.log("maxPositions:", metadata.maxPositions);
  console.log("reserves:    ", metadata.reserveList.length);

  // 2) Full pool with reserve details (rates, supply/borrow, etc.).
  const pool = await PoolV2.load(network, poolId);
  console.log("\n=== Reserves ===");
  for (const [assetId, reserve] of pool.reserves) {
    const symbol = symbolByAsset[assetId] ?? assetId;
    console.log(`\n[${symbol}] ${assetId}`);
    console.log("  supplyApr:   ", reserve.estSupplyApy);
    console.log("  borrowApr:   ", reserve.estBorrowApy);
    console.log("  totalSupply: ", reserve.totalSupplyFloat());
    console.log("  totalBorrow: ", reserve.totalLiabilitiesFloat());
    console.log("  utilization: ", reserve.getUtilizationFloat());
  }
})();
