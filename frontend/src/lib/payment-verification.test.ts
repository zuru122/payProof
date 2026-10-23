import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyPayment } from './payment-verification';

const txId = `0x${'a'.repeat(64)}`;
const recipient = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM';
const sender = 'ST2JXKMSH7J5Q4K2E4YQ5W2B8Z7QXH6QXH2T8V3ZP';
function response(body: unknown, status = 200) { return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response); }
function mockApi(tx: Record<string, unknown>, tip = 103) { vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/v2/info') ? response({ stacks_tip_height: tip }) : response({ tx_id: txId, tx_type: 'token_transfer', tx_status: 'success', sender_address: sender, block_height: 100, token_transfer: { recipient, amount: '1250000', asset_identifier: 'STX' }, ...tx }))); }

describe('verifyPayment', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('verifies a matching STX payment', async () => { mockApi({}); expect((await verifyPayment({ txId, recipient, amount: '1.25', asset: 'STX' })).outcome).toBe('verified'); });
  it.each([
    [{ token_transfer: { recipient: 'ST2WRONG', amount: '1250000', asset_identifier: 'STX' } }, { recipient }, 'mismatch'],
    [{ token_transfer: { recipient, amount: '1000000', asset_identifier: 'STX' } }, { recipient, amount: '1.25' }, 'mismatch'],
    [{ token_transfer: { recipient, amount: '1250000', asset_identifier: 'SPTOKEN.token::USDC' } }, { recipient, amount: '1250000', asset: 'STX' }, 'mismatch'],
  ])('returns mismatch for invalid expected details', async (tx, expected, outcome) => { mockApi(tx); expect((await verifyPayment({ txId, ...expected })).outcome).toBe(outcome); });
  it('returns pending for a pending transaction', async () => { mockApi({ tx_status: 'pending', block_height: 0 }); expect((await verifyPayment({ txId })).outcome).toBe('pending'); });
  it('returns pending when confirmations are insufficient', async () => { mockApi({}, 101); expect((await verifyPayment({ txId })).outcome).toBe('pending'); });
  it('returns failed, unsupported, and not found outcomes', async () => { mockApi({ tx_status: 'abort_by_response' }); expect((await verifyPayment({ txId })).outcome).toBe('failed'); mockApi({ tx_type: 'contract_call', token_transfer: undefined }); expect((await verifyPayment({ txId })).outcome).toBe('unsupported'); vi.stubGlobal('fetch', vi.fn(() => response({}, 404))); expect((await verifyPayment({ txId })).outcome).toBe('not_found'); });
  it('handles network failures and duplicate submissions deterministically', async () => { const fetchMock = vi.fn(() => Promise.reject(new TypeError('network down'))); vi.stubGlobal('fetch', fetchMock); expect((await verifyPayment({ txId })).outcome).toBe('unavailable'); expect((await verifyPayment({ txId })).outcome).toBe('unavailable'); expect(fetchMock).toHaveBeenCalledTimes(2); });
  it('rejects malformed transaction IDs', async () => { await expect(verifyPayment({ txId: 'not-a-hash' })).rejects.toThrow('valid 32-byte'); });
});
