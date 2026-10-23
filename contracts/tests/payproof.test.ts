import { Cl } from "@stacks/transactions";
import { describe, expect, it } from "vitest";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const seller = accounts.get("wallet_1")!;
const buyer = accounts.get("wallet_2")!;
const requestId = (value: string) => Cl.bufferFromUtf8(value);
const txId = (value: number) => Cl.bufferFromHex(value.toString(16).padStart(64, "0"));

describe("payproof", () => {
  it("registers a seller-owned request and exposes it", () => {
    const created = simnet.callPublicFn("payproof", "register-request", [requestId("order-1"), Cl.uint(50_000_000), Cl.stringAscii("STX"), Cl.uint(20)], seller);
    expect(created.result).toBeOk(Cl.bool(true));

    const request = simnet.callReadOnlyFn("payproof", "get-request", [requestId("order-1")], seller);
    expect(request.result).toBeOk(Cl.tuple({
      seller: Cl.principal(seller),
      amount: Cl.uint(50_000_000),
      asset: Cl.stringAscii("STX"),
      "created-at": Cl.uint(simnet.blockHeight),
      "expires-at": Cl.uint(20),
      status: Cl.uint(0),
      "tx-id": Cl.none(),
    }));
  });

  it("rejects duplicate IDs, invalid values, and unauthorized updates", () => {
    simnet.callPublicFn("payproof", "register-request", [requestId("order-2"), Cl.uint(1), Cl.stringAscii("STX"), Cl.uint(20)], seller);
    expect(simnet.callPublicFn("payproof", "register-request", [requestId("order-2"), Cl.uint(2), Cl.stringAscii("STX"), Cl.uint(20)], seller).result).toBeErr(Cl.uint(101));
    expect(simnet.callPublicFn("payproof", "register-request", [requestId("order-3"), Cl.uint(0), Cl.stringAscii("STX"), Cl.uint(20)], seller).result).toBeErr(Cl.uint(103));
    expect(simnet.callPublicFn("payproof", "update-request", [requestId("order-2"), Cl.uint(2), Cl.stringAscii("STX"), Cl.uint(20)], buyer).result).toBeErr(Cl.uint(100));
  });

  it("allows only the verifier to mark a request and prevents duplicate claims", () => {
    simnet.callPublicFn("payproof", "register-request", [requestId("order-4"), Cl.uint(50), Cl.stringAscii("STX"), Cl.uint(20)], seller);
    expect(simnet.callPublicFn("payproof", "mark-verified", [requestId("order-4"), txId(4)], buyer).result).toBeErr(Cl.uint(100));
    expect(simnet.callPublicFn("payproof", "mark-verified", [requestId("order-4"), txId(4)], deployer).result).toBeOk(Cl.bool(true));

    simnet.callPublicFn("payproof", "register-request", [requestId("order-5"), Cl.uint(50), Cl.stringAscii("STX"), Cl.uint(20)], seller);
    expect(simnet.callPublicFn("payproof", "mark-verified", [requestId("order-5"), txId(4)], deployer).result).toBeErr(Cl.uint(108));
  });

  it("supports cancellation and expiry as terminal states", () => {
    const expiry = simnet.blockHeight + 2;
    simnet.callPublicFn("payproof", "register-request", [requestId("order-6"), Cl.uint(50), Cl.stringAscii("STX"), Cl.uint(expiry)], seller);
    simnet.mineEmptyBlocks(2);
    expect(simnet.callPublicFn("payproof", "expire-request", [requestId("order-6")], buyer).result).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn("payproof", "cancel-request", [requestId("order-6")], seller).result).toBeErr(Cl.uint(106));
  });
});
