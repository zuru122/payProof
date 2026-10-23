import { scaffoldConfig } from '../scaffold.config';

export const REQUIRED_CONFIRMATIONS = 3;
export type VerificationOutcome = 'verified' | 'mismatch' | 'pending' | 'failed' | 'not_found' | 'unsupported' | 'unavailable';
export type VerificationInput = { txId: string; requestId?: string; recipient?: string; amount?: string; amountBaseUnits?: string; asset?: string };
export type MatchCheck = { label: string; expected?: string; actual?: string; state: 'matched' | 'mismatch' | 'unchecked' | 'unavailable' };
export type PaymentVerification = { outcome: VerificationOutcome; txId: string; txType?: string; txStatus?: string; sender?: string; recipient?: string; amount?: string; asset?: string; blockHeight?: number; confirmations: number; requiredConfirmations: number; explorerUrl: string; checks: MatchCheck[]; explanation: string; nextStep: string };

type HiroTransaction = { tx_id?: string; tx_type?: string; tx_status?: string; sender_address?: string; block_height?: number; token_transfer?: { recipient?: string; recipient_address?: string; amount?: string | number; asset_identifier?: string } };
type HiroInfo = { stacks_tip_height?: number };

export class PaymentVerificationError extends Error {
  constructor(readonly kind: 'not_found' | 'unavailable', message: string) { super(message); }
}

function trimValue(value?: string) { return value?.trim() || undefined; }

export function normalizeTxId(value: string) {
  const withPrefix = value.trim().startsWith('0x') ? value.trim() : `0x${value.trim()}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(withPrefix)) throw new Error('Enter a valid 32-byte Stacks transaction ID.');
  return withPrefix.toLowerCase();
}

function amountInMicroStx(value: string) {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}

function compareAmount(expected: string, actual: string, asset: string) {
  if (asset === 'STX') { const microStx = amountInMicroStx(expected); return microStx !== null && microStx.toString() === actual; }
  return /^\d+$/.test(expected) && expected === actual;
}

function explorerUrl(txId: string) { return `${scaffoldConfig.explorerBaseUrl}${txId}${scaffoldConfig.explorerChainQuery}`; }
function baseResult(txId: string, outcome: VerificationOutcome, explanation: string, nextStep: string): PaymentVerification { return { outcome, txId, confirmations: 0, requiredConfirmations: REQUIRED_CONFIRMATIONS, explorerUrl: explorerUrl(txId), checks: [], explanation, nextStep }; }

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: scaffoldConfig.hiroApiKey ? { 'x-api-key': scaffoldConfig.hiroApiKey } : undefined });
  if (response.status === 404) throw new PaymentVerificationError('not_found', 'No transaction was found for that ID.');
  if (!response.ok) throw new PaymentVerificationError('unavailable', `Stacks API returned HTTP ${response.status}.`);
  return response.json() as Promise<T>;
}

export async function verifyPayment(input: VerificationInput, signal?: AbortSignal): Promise<PaymentVerification> {
  const txId = normalizeTxId(input.txId);
  const recipientExpected = trimValue(input.recipient);
  const assetExpected = trimValue(input.asset);
  const amountExpected = trimValue(input.amount);
  const amountBaseUnits = trimValue(input.amountBaseUnits);
  let transaction: HiroTransaction;
  try { transaction = await fetchJson<HiroTransaction>(`${scaffoldConfig.nodeUrl}/extended/v1/tx/${txId}`, signal); }
  catch (error) {
    if (error instanceof PaymentVerificationError && error.kind === 'not_found') return baseResult(txId, 'not_found', 'The Stacks API did not return a transaction with this ID.', 'Check the transaction ID and make sure it was sent on Stacks testnet.');
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return baseResult(txId, 'unavailable', 'The transaction could not be checked because the Stacks API is unavailable right now.', 'Wait a moment and try again.');
  }
  const txStatus = transaction.tx_status ?? 'unknown';
  const txType = transaction.tx_type ?? 'unknown';
  const isSupported = txType === 'token_transfer' && Boolean(transaction.token_transfer);
  const result = baseResult(txId, 'unsupported', '', 'Open the transaction in the explorer to inspect its details.');
  Object.assign(result, { txStatus, txType, sender: transaction.sender_address, blockHeight: transaction.block_height });
  if (!isSupported) { result.explanation = `This transaction is a ${txType.replaceAll('_', ' ')}. PayProof currently verifies native STX and supported token transfer transactions only.`; return result; }
  const transfer = transaction.token_transfer!;
  const actualRecipient = transfer.recipient_address ?? transfer.recipient;
  result.recipient = actualRecipient; result.amount = String(transfer.amount ?? ''); result.asset = transfer.asset_identifier && transfer.asset_identifier !== 'STX' ? transfer.asset_identifier : 'STX';
  let tipHeight: number | undefined;
  try { tipHeight = (await fetchJson<HiroInfo>(`${scaffoldConfig.nodeUrl}/v2/info`, signal)).stacks_tip_height; }
  catch (error) { if (error instanceof DOMException && error.name === 'AbortError') throw error; return { ...result, outcome: 'unavailable', explanation: 'The payment was found, but the current chain tip could not be retrieved to confirm it.', nextStep: 'Try again when the Stacks API is responding normally.' }; }
  const confirmations = transaction.block_height && tipHeight ? Math.max(0, tipHeight - transaction.block_height + 1) : 0;
  result.confirmations = confirmations;
  const checks: MatchCheck[] = [
    { label: 'Transaction succeeded', actual: txStatus, state: txStatus === 'success' ? 'matched' : txStatus === 'pending' ? 'unchecked' : 'mismatch' },
    { label: 'Confirmations', expected: String(REQUIRED_CONFIRMATIONS), actual: String(confirmations), state: confirmations >= REQUIRED_CONFIRMATIONS ? 'matched' : 'unchecked' },
    recipientExpected ? { label: 'Recipient', expected: recipientExpected, actual: actualRecipient, state: actualRecipient === recipientExpected ? 'matched' : 'mismatch' } : { label: 'Recipient', actual: actualRecipient, state: 'unchecked' },
    amountBaseUnits ? { label: 'Amount', expected: amountBaseUnits, actual: result.amount, state: amountBaseUnits === result.amount ? 'matched' : 'mismatch' } : amountExpected ? { label: 'Amount', expected: amountExpected, actual: result.amount, state: compareAmount(amountExpected, result.amount!, assetExpected ?? 'STX') ? 'matched' : 'mismatch' } : { label: 'Amount', actual: result.amount, state: 'unchecked' },
    assetExpected ? { label: 'Asset', expected: assetExpected, actual: result.asset, state: result.asset === assetExpected ? 'matched' : 'mismatch' } : { label: 'Asset', actual: result.asset, state: 'unchecked' },
  ];
  result.checks = checks;
  if (txStatus !== 'success' && (txStatus === 'pending' || txStatus === 'broadcast')) return { ...result, outcome: 'pending', explanation: 'The transaction exists but has not finished successfully yet.', nextStep: 'Wait for the transaction to settle, then verify again.' };
  if (txStatus !== 'success') return { ...result, outcome: 'failed', explanation: 'The transaction execution failed, so it cannot prove a completed payment.', nextStep: 'Ask the customer to retry the payment and share the new transaction ID.' };
  if (confirmations < REQUIRED_CONFIRMATIONS) return { ...result, outcome: 'pending', explanation: `The payment succeeded, but it has only ${confirmations} of ${REQUIRED_CONFIRMATIONS} required confirmations.`, nextStep: 'Wait for more Stacks blocks, then verify again.' };
  if (checks.some((check) => check.state === 'mismatch')) return { ...result, outcome: 'mismatch', explanation: 'The transaction succeeded, but one or more expected payment details do not match.', nextStep: 'Do not release the order until the customer provides a matching payment.' };
  return { ...result, outcome: 'verified', explanation: 'The transaction succeeded, has enough confirmations, and every supplied expectation matches the on-chain transfer.', nextStep: 'You can continue your fulfillment flow based on this verified transaction.' };
}
