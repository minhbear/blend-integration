import {
  PoolContractV2,
  Request,
  RequestType,
} from "@blend-capital/blend-sdk";
import {
  Transaction,
  TransactionBuilder,
  xdr,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { network, server } from "./lib";

export interface BuildSubmitParams {
  poolId: string;
  from: string; // the acting account's public key (G...)
  requests: Request[];
}

/**
 * Generic builder: wrap one or more pool `Request`s into a single `pool.submit`
 * transaction. All requests execute atomically inside one contract call.
 */
export async function buildSubmitTx({
  poolId,
  from,
  requests,
}: BuildSubmitParams): Promise<Transaction> {
  const op = xdr.Operation.fromXDR(
    new PoolContractV2(poolId).submit({ from, spender: from, to: from, requests }),
    "base64"
  );

  const account = await server.getAccount(from);
  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: network.passphrase,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();
}

export interface BuildActionParams {
  poolId: string;
  from: string;
  assetId: string; // token contract id of the reserve
  amount: bigint; // base units
}

export function buildDepositTx(p: BuildActionParams): Promise<Transaction> {
  return buildSubmitTx({
    poolId: p.poolId,
    from: p.from,
    requests: [{ amount: p.amount, request_type: RequestType.SupplyCollateral, address: p.assetId }],
  });
}

export function buildWithdrawTx(p: BuildActionParams): Promise<Transaction> {
  return buildSubmitTx({
    poolId: p.poolId,
    from: p.from,
    requests: [{ amount: p.amount, request_type: RequestType.WithdrawCollateral, address: p.assetId }],
  });
}

export function buildBorrowTx(p: BuildActionParams): Promise<Transaction> {
  return buildSubmitTx({
    poolId: p.poolId,
    from: p.from,
    requests: [{ amount: p.amount, request_type: RequestType.Borrow, address: p.assetId }],
  });
}

export function buildRepayTx(p: BuildActionParams): Promise<Transaction> {
  return buildSubmitTx({
    poolId: p.poolId,
    from: p.from,
    requests: [{ amount: p.amount, request_type: RequestType.Repay, address: p.assetId }],
  });
}
