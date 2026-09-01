import { describe, it, expect, vi } from "vitest";
import { IdempotencyStore } from "../src/actions/idempotency.js";

describe("IdempotencyStore (Edge Case 6)", () => {
  it("executes exactly once for a given key", async () => {
    const store = new IdempotencyStore();
    const execute = vi.fn().mockResolvedValue({ ok: true });
    const verifyCurrentState = vi.fn().mockResolvedValue(null);

    const result1 = await store.run({ key: "k1", verifyCurrentState, execute });
    const result2 = await store.run({ key: "k1", verifyCurrentState, execute });

    expect(result1).toEqual({ ok: true });
    expect(result2).toEqual({ ok: true });
    expect(execute).toHaveBeenCalledTimes(1); // NOT called twice for the same key
  });

  it("verifies current state before retrying instead of blindly re-executing", async () => {
    const store = new IdempotencyStore();
    const execute = vi.fn().mockRejectedValueOnce(new Error("timeout"));
    // Simulate: the first attempt's write actually landed externally
    // even though the response was lost -- verification should catch that.
    const verifyCurrentState = vi
      .fn()
      .mockResolvedValueOnce(null) // nothing yet on first attempt
      .mockResolvedValueOnce({ alreadyApplied: true }); // but it landed by the retry

    await expect(store.run({ key: "k2", verifyCurrentState, execute })).rejects.toThrow("timeout");

    const result = await store.run({ key: "k2", verifyCurrentState, execute });
    expect(result).toEqual({ alreadyApplied: true });
    expect(execute).toHaveBeenCalledTimes(1); // retry found it already applied, never re-executed
  });

  it("tracks attempt counts across retries", async () => {
    const store = new IdempotencyStore();
    const execute = vi.fn().mockRejectedValue(new Error("still failing"));
    const verifyCurrentState = vi.fn().mockResolvedValue(null);

    await expect(store.run({ key: "k3", verifyCurrentState, execute })).rejects.toThrow();
    await expect(store.run({ key: "k3", verifyCurrentState, execute })).rejects.toThrow();

    expect(store.getRecord("k3")?.attempts).toBe(2);
    expect(store.getRecord("k3")?.status).toBe("failed");
  });

  it("isolates records by key", async () => {
    const store = new IdempotencyStore();
    await store.run({ key: "a", verifyCurrentState: async () => null, execute: async () => "A" });
    await store.run({ key: "b", verifyCurrentState: async () => null, execute: async () => "B" });
    expect(store.getRecord("a")?.result).toBe("A");
    expect(store.getRecord("b")?.result).toBe("B");
  });
});
