import { describe, it, expect } from "vitest";
import { OverrideMemory } from "../src/actions/overrideMemory.js";

describe("OverrideMemory (Edge Case 8 + self-correcting downgrade)", () => {
  it("is not downgraded after a single override", () => {
    const mem = new OverrideMemory();
    mem.recordOverride("p1", "FLAG_MOOD_PATTERN", "clinician:1", "not relevant this time", "MEDIUM");
    expect(mem.isDowngraded("p1", "FLAG_MOOD_PATTERN")).toBe(false);
  });

  it("downgrades after 2 consecutive overrides for the same patient + action type", () => {
    const mem = new OverrideMemory();
    mem.recordOverride("p1", "FLAG_MOOD_PATTERN", "clinician:1", "reason 1", "MEDIUM");
    mem.recordOverride("p1", "FLAG_MOOD_PATTERN", "clinician:1", "reason 2", "MEDIUM");
    expect(mem.isDowngraded("p1", "FLAG_MOOD_PATTERN")).toBe(true);
  });

  it("does not downgrade a different patient or a different action type", () => {
    const mem = new OverrideMemory();
    mem.recordOverride("p1", "FLAG_MOOD_PATTERN", "clinician:1", "reason 1", "MEDIUM");
    mem.recordOverride("p1", "FLAG_MOOD_PATTERN", "clinician:1", "reason 2", "MEDIUM");
    expect(mem.isDowngraded("p2", "FLAG_MOOD_PATTERN")).toBe(false);
    expect(mem.isDowngraded("p1", "SUGGEST_FOLLOWUP_FREQUENCY_CHANGE")).toBe(false);
  });

  it("a confirmation (non-override approval) resets the consecutive streak", () => {
    const mem = new OverrideMemory();
    mem.recordOverride("p1", "FLAG_MOOD_PATTERN", "clinician:1", "reason 1", "MEDIUM");
    mem.recordConfirmation("p1", "FLAG_MOOD_PATTERN");
    mem.recordOverride("p1", "FLAG_MOOD_PATTERN", "clinician:1", "reason 2", "MEDIUM");
    // Only 1 in a row since the confirmation broke the streak.
    expect(mem.isDowngraded("p1", "FLAG_MOOD_PATTERN")).toBe(false);
    expect(mem.getConsecutiveOverrideCount("p1", "FLAG_MOOD_PATTERN")).toBe(1);
  });

  it("stays downgraded until a human explicitly restores autonomy", () => {
    const mem = new OverrideMemory();
    mem.recordOverride("p1", "FLAG_MOOD_PATTERN", "clinician:1", "reason 1", "MEDIUM");
    mem.recordOverride("p1", "FLAG_MOOD_PATTERN", "clinician:1", "reason 2", "MEDIUM");
    expect(mem.isDowngraded("p1", "FLAG_MOOD_PATTERN")).toBe(true);

    // A later confirmation resets the streak counter but does NOT
    // un-downgrade -- spec 2.2 requires an explicit manual restore.
    mem.recordConfirmation("p1", "FLAG_MOOD_PATTERN");
    expect(mem.isDowngraded("p1", "FLAG_MOOD_PATTERN")).toBe(true);

    mem.restoreAutonomy("p1", "FLAG_MOOD_PATTERN", "clinician:2");
    expect(mem.isDowngraded("p1", "FLAG_MOOD_PATTERN")).toBe(false);
  });

  it("keeps a permanent, queryable history of overrides for a (patient, actionType) pair", () => {
    const mem = new OverrideMemory();
    mem.recordOverride("p1", "FLAG_MOOD_PATTERN", "clinician:1", "reason 1", "MEDIUM");
    mem.recordOverride("p1", "FLAG_MOOD_PATTERN", "clinician:2", "reason 2", "MEDIUM");
    const history = mem.getOverrideHistory("p1", "FLAG_MOOD_PATTERN");
    expect(history).toHaveLength(2);
    expect(history.map((h) => h.reason)).toEqual(["reason 1", "reason 2"]);
  });
});
