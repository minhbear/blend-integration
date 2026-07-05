import { Keypair, Transaction, rpc } from "@stellar/stellar-sdk";
import { server } from "./lib";

async function pollTx(hash: string): Promise<rpc.Api.GetTransactionResponse> {
  let status = "PENDING";
  let res: rpc.Api.GetTransactionResponse | undefined;
  while (status === "PENDING" || status === "NOT_FOUND") {
    await new Promise((r) => setTimeout(r, 1500));
    res = await server.getTransaction(hash);
    status = res.status;
  }
  return res!;
}

async function sendOne(
  tx: Transaction,
  signer: Keypair
): Promise<rpc.Api.GetTransactionResponse> {
  const prepared = await server.prepareTransaction(tx);

  prepared.sign(signer);

  const sendRes = await server.sendTransaction(prepared);
  console.log("submitted:", sendRes.hash, "| status:", sendRes.status);
  if (sendRes.status === "ERROR") {
    throw new Error("send failed: " + JSON.stringify(sendRes.errorResult, null, 2));
  }

  const final = await pollTx(sendRes.hash);
  if (final.status !== "SUCCESS") {
    throw new Error("tx failed: " + JSON.stringify(final, null, 2));
  }
  console.log("final status: SUCCESS");
  return final;
}


export async function sendTransaction(
  tx: Transaction,
  signer: Keypair
): Promise<rpc.Api.GetTransactionResponse>;
export async function sendTransaction(
  txs: Transaction[],
  signer: Keypair
): Promise<rpc.Api.GetTransactionResponse[]>;
export async function sendTransaction(
  txs: Transaction | Transaction[],
  signer: Keypair
): Promise<rpc.Api.GetTransactionResponse | rpc.Api.GetTransactionResponse[]> {
  if (!Array.isArray(txs)) return sendOne(txs, signer);
  const results: rpc.Api.GetTransactionResponse[] = [];
  for (const tx of txs) results.push(await sendOne(tx, signer));
  return results;
}
