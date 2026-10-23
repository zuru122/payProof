'use client';

import { FormEvent, useState } from 'react';
import { Cl } from '@stacks/transactions';
import { usePayproof_RegisterRequest } from '@/generated/hooks';
import { useAtomValue } from 'jotai';
import { addressAtom } from '@/store/wallet';
import { scaffoldConfig } from '@/scaffold.config';

// Nakamoto Stacks blocks are produced roughly every 5 seconds.
const BLOCKS_PER_HOUR = 720;

function parseStx(value: string) {
  if (!/^\d+(\.\d{1,6})?$/.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}

export default function RequestCreator() {
  const address = useAtomValue(addressAtom);
  const { call, loading, txid } = usePayproof_RegisterRequest();
  const [requestId, setRequestId] = useState('');
  const [amount, setAmount] = useState('');
  const [expiryHours, setExpiryHours] = useState('24');
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    const parsedAmount = parseStx(amount);
    const parsedExpiryHours = Number(expiryHours);
    if (!address) return setError('Connect the seller wallet to create a request.');
    if (!requestId.trim() || requestId.trim().length > 64) return setError('Use a request ID between 1 and 64 characters.');
    if (parsedAmount === null || parsedAmount <= 0n) return setError('Enter a positive STX amount with up to 6 decimals.');
    if (!Number.isSafeInteger(parsedExpiryHours) || parsedExpiryHours < 1 || parsedExpiryHours > 24 * 30) return setError('Choose an expiry between 1 hour and 30 days.');
    try {
      const response = await fetch(`${scaffoldConfig.nodeUrl}/v2/info`, { headers: scaffoldConfig.hiroApiKey ? { 'x-api-key': scaffoldConfig.hiroApiKey } : undefined });
      if (!response.ok) throw new Error('Could not read the current Stacks block height.');
      const info = await response.json() as { stacks_tip_height?: number };
      if (typeof info.stacks_tip_height !== 'number') throw new Error('Stacks did not return a usable block height.');
      const expiryBlock = info.stacks_tip_height + parsedExpiryHours * BLOCKS_PER_HOUR;
      await call([Cl.bufferFromUtf8(requestId.trim()), Cl.uint(parsedAmount), Cl.stringAscii('STX'), Cl.uint(expiryBlock)]);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The request could not be submitted.'); }
  }

  return <section className="request-creator"><div><span className="eyebrow">Seller workspace</span><h2>Create a payment request</h2><p className="creator-copy">Register the recipient, exact amount, asset, and expiry on Stacks testnet. The connected seller wallet becomes the recipient.</p></div><form onSubmit={submit} className="creator-form"><label>Request ID<input value={requestId} onChange={(event) => setRequestId(event.target.value)} placeholder="e.g. order-1042" /></label><label>Amount in STX<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="50.00" /></label><label>Request valid for<select value={expiryHours} onChange={(event) => setExpiryHours(event.target.value)}><option value="1">1 hour</option><option value="24">24 hours</option><option value="72">3 days</option><option value="168">7 days</option><option value="720">30 days</option></select></label><button className="primary-button" disabled={loading} type="submit">{loading ? 'Submitting…' : 'Register request →'}</button></form><p className="form-help">Expiry is converted to a future Stacks block height automatically using the current Nakamoto block target.</p>{!address && <p className="form-help">Connect a wallet to create a request. Buyers can verify an existing request without a wallet.</p>}{error && <p className="error-message" role="alert">{error}</p>}{txid && <p className="success-message" role="status">Request submitted. Transaction: <code>{txid}</code></p>}</section>;
}
