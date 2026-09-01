import { describe, it, expect } from "vitest";
import { getActionDefinition, isKnownActionType } from "../src/agents/actionSchema.js";

describe("actionSchema (allow-list)", () => {
  it("classifies known LOW/MEDIUM/HIGH action types explicitly", () => {
    expect(getActionDefinition("SEND_CHECK_IN_REMINDER").tier).toBe("LOW");
    expect(getActionDefinition("FLAG_MOOD_PATTERN").tier).toBe("MEDIUM");
    expect(getActionDefinition("ESCALATE_CRISIS").tier).toBe("HIGH");
  });

  it("defaults any unclassified action type to HIGH (allow-list, not block-list)", () => {
    const def = getActionDefinition("SOME_BRAND_NEW_ACTION_NOBODY_REVIEWED");
    expect(def.tier).toBe("HIGH");
    expect(isKnownActionType("SOME_BRAND_NEW_ACTION_NOBODY_REVIEWED")).toBe(false);
  });

  it("hard-blocks diagnosis, medication changes, and autonomous discharge from ever being proposed", () => {
    expect(getActionDefinition("DIAGNOSE_PATIENT").hardBlock).toBe("never_propose");
    expect(getActionDefinition("ADJUST_MEDICATION").hardBlock).toBe("never_propose");
    expect(getActionDefinition("DISCHARGE_PATIENT_AUTONOMOUSLY").hardBlock).toBe("never_propose");
  });

  it("allows contacting emergency services only as a draft-and-escalate action", () => {
    const def = getActionDefinition("CONTACT_EMERGENCY_SERVICES");
    expect(def.hardBlock).toBe("draft_and_escalate_only");
    expect(def.tier).toBe("HIGH");
  });
});
