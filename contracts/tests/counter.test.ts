import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;

describe("counter", () => {
  it("increments", () => {
    const { result } = simnet.callPublicFn("counter", "increment", [], deployer);
    expect(result).toBeOk(Cl.uint(1));
  });
  it("get-count returns current value", () => {
    simnet.callPublicFn("counter", "increment", [], deployer);
    const { result } = simnet.callReadOnlyFn("counter", "get-count", [], deployer);
    expect(result).toBeOk(Cl.uint(1));
  });
  it("decrement", () => {
    simnet.callPublicFn("counter", "increment", [], deployer);
    const { result } = simnet.callPublicFn("counter", "decrement", [], deployer);
    expect(result).toBeOk(Cl.uint(0));
  });
});
