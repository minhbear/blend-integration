import * as dotenv from "dotenv";
import { Keypair, Transaction, Horizon, xdr } from "@stellar/stellar-sdk";
import { getKeypair, network } from "./lib";

dotenv.config();

const FRIENDBOT = "https://friendbot.stellar.org";
const BLEND_FAUCET = "https://ewqw4hx7oa.execute-api.us-east-1.amazonaws.com/getAssets";
const HORIZON = "https://horizon-testnet.stellar.org";

async function fundXlm(address: string) {
  const resp = await fetch(`${FRIENDBOT}/?addr=${address}`);
  if (resp.status === 200) {
    console.log("Friendbot: funded account with XLM ✅");
  } else {
    // 400 typically means the account already exists / was funded before.
    console.log(`Friendbot: skipped (status ${resp.status} — account likely already funded)`);
  }
}

async function fundBlendAssets(keypair: Keypair) {
  const address = keypair.publicKey();
  const resp = await fetch(`${BLEND_FAUCET}?userId=${address}`, { method: "GET" });
  if (resp.status !== 200) {
    throw new Error(`Blend faucet returned ${resp.status}: ${await resp.text()}`);
  }
  const envelopeXdr = await resp.text();

  // The faucet tx is a classic Stellar tx (changeTrust + payment ops), sourced
  // and pre-signed by the issuer. Add our signature and submit via Horizon.
  const tx = new Transaction(
    xdr.TransactionEnvelope.fromXDR(envelopeXdr, "base64"),
    network.passphrase
  );
  tx.sign(keypair);

  const horizon = new Horizon.Server(HORIZON);
  const res = await horizon.submitTransaction(tx);
  console.log("Blend faucet: received USDC / BLND / wETH / wBTC ✅  (tx", res.hash + ")");
}

(async () => {
  const keypair = getKeypair();
  console.log("account:", keypair.publicKey());
  await fundXlm(keypair.publicKey());
  try {
    await fundBlendAssets(keypair);
  } catch (e: any) {
    // A repeat run may fail if trustlines/balances already exist — not fatal.
    const detail = e?.response?.data?.extras?.result_codes ?? e.message;
    console.log("Blend faucet: skipped/failed —", JSON.stringify(detail));
  }
  console.log("\nDone. Check balances, then run: npm run deposit → borrow → repay → withdraw");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
