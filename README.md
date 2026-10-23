# PayProof

PayProof is a Stacks testnet payment-verification app for sellers who need to confirm that a buyer paid the correct recipient, amount, and asset.

It verifies payment evidence from the Stacks blockchain rather than trusting screenshots or buyer-submitted claims. A successful transaction is not automatically a valid payment for an order: the transaction must also match the registered request.

## Current status

- Network: **Stacks testnet**
- Frontend: Next.js and React
- Contract: Clarity v6 payment-request registry
- Blockchain data: Hiro Stacks API
- Supported payment type: native STX transfers
- Contract address: `ST26C7Y2APM6CNQJAR8YRFSS5EWA3A8FN0210V9AZ.payproof`
- [View the contract on the Stacks testnet explorer](https://explorer.hiro.so/address/ST26C7Y2APM6CNQJAR8YRFSS5EWA3A8FN0210V9AZ?chain=testnet)
- Deployment transaction: [`0x5c1bd424961231d65676527e77296fab109e8b33d0b716299623e746f3e452ff`](https://explorer.hiro.so/txid/0x5c1bd424961231d65676527e77296fab109e8b33d0b716299623e746f3e452ff?chain=testnet)

## Features

- Seller payment-request registration with an exact amount, asset, recipient, and expiry.
- Wallet-based request creation; the connected seller becomes the registered recipient.
- Transaction lookup using a Stacks transaction ID.
- Matching checks for execution status, recipient, exact amount, asset, transaction type, confirmations, request lifecycle, and duplicate claims.
- Clear outcomes for verified, mismatch, pending, failed, not found, unsupported, and unavailable verification.
- Explorer links and copy actions for transaction IDs and addresses.
- Responsive, keyboard-accessible interface with visible status text and screen-reader feedback.
- Server-side verification route so the browser is not the authority for payment verification.

## Verification model

The frontend sends a transaction ID and, optionally, a registered request ID to `/api/verify`. The server retrieves the transaction from the configured Stacks API, validates the response, and compares the observed transfer with the registered request.

The verification service requires all of the following for a verified payment:

1. The transaction exists on the selected network.
2. The transaction execution succeeded.
3. The transaction has enough confirmations.
4. The transfer is a supported transaction structure.
5. The recipient matches the request seller.
6. The exact requested amount and asset match.
7. The request is still active and has not been cancelled or expired.
8. The transaction has not already been claimed for another request.

The `payproof` contract stores payment-request state and prevents unauthorized request changes. It does not independently inspect arbitrary historical transactions. Its `mark-verified` function is restricted to the configured verifier principal, which must independently perform the checks above before submitting an on-chain status update.

Without a server verifier key, PayProof can still perform and display accurate off-chain verification. The matching request remains `pending` on-chain because no authorized signer has called `mark-verified`.

## Contract interface

Contract file: `contracts/contracts/payproof.clar`

Public functions:

- `register-request(request-id, amount, asset, expires-at)`
- `update-request(request-id, amount, asset, expires-at)`
- `cancel-request(request-id)`
- `expire-request(request-id)`
- `mark-verified(request-id, tx-id)`
- `set-verifier(verifier)`

Read-only functions:

- `get-verifier()`
- `get-request(request-id)`
- `get-claimed-request(tx-id)`

Request IDs are UTF-8 strings up to 64 bytes, such as `order-124` or `invoice-2026-0001`. They must be unique for the seller's registry.

## Requirements

- Node.js 18 or newer
- npm
- Scaffold Stacks CLI (`stacksdapp`)
- Clarinet for contract checks and tests
- A Stacks-compatible browser wallet for creating testnet requests

Install dependencies from the repository root:

```bash
npm install
cd contracts && npm install
cd ../frontend && npm install
cd ..
```

## Environment variables

Copy the example file for local frontend development:

```bash
cp frontend/env.local.example frontend/.env.local
```

For a testnet frontend, set:

```env
NEXT_PUBLIC_NETWORK=testnet
```

Optional values include `NEXT_PUBLIC_STACKS_NODE_URL` and `NEXT_PUBLIC_HIRO_API_KEY`.

`PAYPROOF_VERIFIER_PRIVATE_KEY` is server-only and is not required for transaction inspection. It is only needed if a trusted backend verifier should submit `mark-verified` to the contract. Never prefix it with `NEXT_PUBLIC_`, commit it, or place it in client-side code.

The deployed contract does not require a deployer key to be present in the frontend. Deployment credentials belong in the local or CI deployment environment only.

## Run locally

Start the application against Stacks testnet:

```bash
stacksdapp dev --network testnet
```

Or start the frontend directly:

```bash
cd frontend
npm run dev
```

The app is normally available at `http://localhost:3000`.

## Checks and tests

Run the scaffold checks from the repository root:

```bash
stacksdapp check
stacksdapp generate
stacksdapp test
```

Run frontend checks directly:

```bash
cd frontend
npm test
npm run typecheck
npm run build
```

The test suites cover matching payments, wrong recipients, wrong amounts, wrong assets, pending and failed transactions, invalid hashes, unsupported structures, insufficient confirmations, expired and cancelled requests, duplicate claims, authorization, API failures, retries, and accessibility-oriented form behavior.

## Contract deployment

Deploy only to testnet unless mainnet deployment has been explicitly approved:

```bash
stacksdapp deploy --network testnet --yes
```

The deployer mnemonic must be supplied locally through the supported deployment settings or deployment environment. Do not commit a real mnemonic to `contracts/settings/Testnet.toml` or any other file.

After a contract change, regenerate bindings:

```bash
stacksdapp check
stacksdapp generate
stacksdapp test
```

Generated files under `frontend/src/generated/` should be regenerated by the CLI rather than edited manually.

## Deploy the frontend to Vercel

This repository contains the application in the `frontend` directory. In Vercel:

1. Import the GitHub repository.
2. Set **Root Directory** to `frontend`.
3. Keep the framework as **Next.js**.
4. Use `npm install` as the install command.
5. Use `npm run build` as the build command.
6. Add `NEXT_PUBLIC_NETWORK=testnet` in the Vercel environment variables.
7. Add `NEXT_PUBLIC_STACKS_NODE_URL` only if using a custom Stacks API endpoint.
8. Add `NEXT_PUBLIC_HIRO_API_KEY` only if you have a suitable Hiro API key.
9. Add `PAYPROOF_VERIFIER_PRIVATE_KEY` only for a secured server-side verifier deployment.

Do not add a mnemonic, private key, or API secret as a `NEXT_PUBLIC_` variable. Vercel environment variables should be configured separately for Preview and Production as appropriate.

## Security and limitations

- PayProof never asks users for wallet recovery phrases or private keys.
- Users sign wallet actions through their wallet provider.
- Transaction verification is intentionally conservative. Ambiguous or unsupported transfer structures are not marked verified.
- The initial implementation requires an exact native STX transfer. SIP-010 token verification requires an explicit supported-token policy before it should be enabled.
- The verifier key is a trust boundary for on-chain status updates. It must be protected by backend key management in production.
- Testnet transactions and testnet contract state have no production payment value.
- A Vercel deployment hosts the frontend and server route; it does not redeploy or replace the already-deployed Stacks contract.

## Repository layout

```text
contracts/contracts/payproof.clar       Clarity payment-request registry
contracts/tests/payproof.test.ts       Contract tests
frontend/src/app/page.tsx               PayProof interface
frontend/src/app/api/verify/route.ts    Server-side verification endpoint
frontend/src/lib/payment-verification.ts Blockchain response validation and matching
frontend/src/components/RequestCreator.tsx Seller request workflow
frontend/src/generated/                 Scaffold-generated contract bindings
```

