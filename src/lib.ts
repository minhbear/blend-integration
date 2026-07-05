import * as dotenv from "dotenv";
import { PoolV2, Reserve } from "@blend-capital/blend-sdk";
import { Keypair, rpc } from "@stellar/stellar-sdk";
import { Network, networks, assets } from "./constant";

dotenv.config();

export const network = networks[Network.TESTNET];
export const server = new rpc.Server(network.rpc);

export function getKeypair(): Keypair {
  const secret = process.env.SECRET_KEY;
  if (!secret) throw new Error("Set SECRET_KEY env var (Stellar S... secret)");
  return Keypair.fromSecret(secret);
}

export function resolveAsset(symbolOrId: string): string {
  const table = assets[Network.TESTNET];
  return table[symbolOrId] ?? symbolOrId;
}

export function floatToBaseUnits(amount: number, decimals: number): bigint {
  return BigInt(Math.round(amount * 10 ** decimals));
}

export async function resolveAmount(
  pool: PoolV2,
  reserve: Reserve,
  rawAmount: string,
  pubkey: string,
  kind: "repay" | "withdrawCollateral",
): Promise<{ amount: bigint; isMax: boolean }> {
  const decimals = reserve.config.decimals;
  if (rawAmount.toLowerCase() !== "max") {
    return {
      amount: floatToBaseUnits(Number(rawAmount), decimals),
      isMax: false,
    };
  }
  const user = await pool.loadUser(pubkey);
  const outstanding =
    kind === "repay"
      ? user.getLiabilitiesFloat(reserve)
      : user.getCollateralFloat(reserve);
  return {
    amount: floatToBaseUnits(outstanding * 1.005, decimals),
    isMax: true,
  };
}

/** Load the pool and return the reserve for an asset, erroring clearly if absent. */
export async function loadReserve(poolId: string, assetId: string) {
  const pool = await PoolV2.load(network, poolId);
  const reserve = pool.reserves.get(assetId);
  if (!reserve)
    throw new Error(`Asset ${assetId} is not a reserve in pool ${poolId}`);
  return { pool, reserve };
}
