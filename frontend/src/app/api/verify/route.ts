import { NextRequest, NextResponse } from 'next/server';
import { Cl, PostConditionMode, broadcastTransaction, fetchCallReadOnlyFunction, makeContractCall } from '@stacks/transactions';
import deployments from '@/generated/deployments.json';
import { getReadOnlyNetwork, scaffoldConfig } from '@/scaffold.config';
import { readClarity } from '@/lib/clarity';
import { normalizeTxId, verifyPayment, type PaymentVerification } from '@/lib/payment-verification';

export const runtime = 'nodejs';

type RegistryRequest = { seller: string; amount: bigint; asset: string; status: bigint; createdAt: bigint; expiresAt: bigint };

function readRegistryValue(value: unknown): RegistryRequest | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.seller !== 'string' || typeof record.asset !== 'string' || typeof record.amount !== 'bigint') return null;
  if (typeof record['created-at'] !== 'bigint' || typeof record['expires-at'] !== 'bigint') return null;
  return { seller: record.seller, amount: record.amount, asset: record.asset, status: typeof record.status === 'bigint' ? record.status : 0n, createdAt: record['created-at'], expiresAt: record['expires-at'] };
}

async function markVerified(requestId: string, txId: string) {
  const contractId = (deployments as { contracts?: Record<string, { contract_id?: string }> }).contracts?.payproof?.contract_id;
  const privateKey = process.env.PAYPROOF_VERIFIER_PRIVATE_KEY;
  if (!contractId || !privateKey) return { status: 'not_configured' as const };
  const separator = contractId.lastIndexOf('.');
  if (separator < 1) return { status: 'unavailable' as const, message: 'Invalid payproof deployment metadata.' };
  const transaction = await makeContractCall({
    contractAddress: contractId.slice(0, separator),
    contractName: contractId.slice(separator + 1),
    functionName: 'mark-verified',
    functionArgs: [Cl.bufferFromUtf8(requestId), Cl.bufferFromHex(txId.slice(2))],
    senderKey: privateKey,
    network: scaffoldConfig.targetNetwork,
    postConditionMode: PostConditionMode.Deny,
    validateWithAbi: true,
  });
  const broadcast = await broadcastTransaction({ transaction, network: scaffoldConfig.targetNetwork });
  if ('error' in broadcast || !broadcast.txid) return { status: 'unavailable' as const, message: 'The contract update was rejected by the network.' };
  return { status: 'submitted' as const, txid: broadcast.txid };
}

export async function POST(request: NextRequest) {
  if (!scaffoldConfig.isTestnet) return NextResponse.json({ error: 'PayProof request verification is restricted to Stacks testnet.' }, { status: 400 });
  const body = await request.json().catch(() => null) as { requestId?: string; txId?: string } | null;
  const requestId = body?.requestId?.trim();
  if (!requestId || requestId.length > 64) return NextResponse.json({ error: 'A request ID between 1 and 64 characters is required.' }, { status: 400 });
  let txId: string;
  try { txId = normalizeTxId(body?.txId ?? ''); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid transaction ID.' }, { status: 400 }); }

  const deployment = (deployments as { contracts?: Record<string, { contract_id?: string }> }).contracts?.payproof?.contract_id;
  if (!deployment) return NextResponse.json({ error: 'The payproof contract is not deployed on the configured network.' }, { status: 503 });
  const separator = deployment.lastIndexOf('.');
  const contractAddress = deployment.slice(0, separator);
  const contractName = deployment.slice(separator + 1);
  const registryResponse = readClarity(await fetchCallReadOnlyFunction({ contractAddress, contractName, functionName: 'get-request', functionArgs: [Cl.bufferFromUtf8(requestId)], network: getReadOnlyNetwork(), senderAddress: contractAddress }));
  if (!registryResponse || typeof registryResponse !== 'object' || !('ok' in registryResponse) || !(registryResponse as { ok: boolean }).ok) return NextResponse.json({ error: 'Payment request was not found on the configured Stacks testnet contract.' }, { status: 404 });
  const registry = readRegistryValue((registryResponse as unknown as { value: unknown }).value);
  if (!registry) return NextResponse.json({ error: 'The registered payment request has an invalid shape.' }, { status: 503 });
  if (registry.status === 2n) return NextResponse.json({ error: 'This payment request has expired.' }, { status: 410 });
  if (registry.status === 3n) return NextResponse.json({ error: 'This payment request has been cancelled.' }, { status: 410 });
  if (registry.status === 1n) return NextResponse.json({ error: 'This payment request is already verified.' }, { status: 409 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let verification: PaymentVerification;
  try { verification = await verifyPayment({ txId, recipient: registry.seller, amountBaseUnits: registry.amount.toString(), asset: registry.asset }, controller.signal); }
  finally { clearTimeout(timeout); }
  if (verification.blockHeight !== undefined && BigInt(verification.blockHeight) < registry.createdAt) {
    return NextResponse.json({ verification: { ...verification, outcome: 'mismatch', explanation: 'The transaction succeeded, but it was confirmed before this payment request was created.', nextStep: 'Create a new request before sending a new payment.' }, contractUpdate: { status: 'not_submitted' } });
  }
  if (verification.outcome !== 'verified') return NextResponse.json({ verification, contractUpdate: { status: 'not_submitted' } });

  try {
    const contractUpdate = await markVerified(requestId, txId);
    if (contractUpdate.status === 'not_configured') {
      return NextResponse.json({ verification: { ...verification, nextStep: 'The transfer matches the registered request. The server verifier key is not configured, so the on-chain request remains pending.' }, contractUpdate });
    }
    return NextResponse.json({ verification, contractUpdate });
  } catch (error) {
    return NextResponse.json({ verification, contractUpdate: { status: 'unavailable', message: error instanceof Error ? error.message : 'Unable to submit the registry update.' } });
  }
}
