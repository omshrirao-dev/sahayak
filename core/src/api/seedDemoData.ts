/**
 * Demo data for the clinician dashboard (Phase 6). Unlike
 * seed-data/generate_synthetic_patients.ts (Phase 1, which only
 * builds World state), every event here is driven THROUGH the real
 * Orchestrator so the dashboard's approval queue, fast triage queue,
 * and action timelines have genuine content -- not just care_stage/
 * risk_level/engagement_status.
 *
 * Requires the real safety service running (the orchestrator's
 * SafetyClient is real HTTP, not a fake) -- this is deliberate, same
 * fail-closed posture as the rest of the system.
 */
import type { World, Orchestrator } from "../index.js";

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

export async function seedDemoData(world: World, orchestrator: Orchestrator): Promise<void> {
  // 1. Stable patient, early in Intake -- nothing needs attention.
  {
    const patient = world.admitPatient("Synthetic Subject — Stable Intake [SYNTHETIC]");
    const e1 = world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 8, responded: true }, source: "patient", occurredAt: daysAgo(2) });
    const e2 = world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 7, responded: true }, source: "patient", occurredAt: daysAgo(1) });
    await orchestrator.handleEvent(e1);
    await orchestrator.handleEvent(e2);
  }

  // 2. Watch / MEDIUM-tier patient -- a declining mood-score pattern
  // auto-executes a FLAG_MOOD_PATTERN, flagged for clinician review.
  {
    const patient = world.admitPatient("Synthetic Subject — Declining Pattern [SYNTHETIC]");
    await orchestrator.handleEvent(
      world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 8, responded: true }, source: "patient", occurredAt: daysAgo(6) }),
    );
    await orchestrator.handleEvent(
      world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 5, responded: true }, source: "patient", occurredAt: daysAgo(4) }),
    );
    const last = world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 3, responded: true }, source: "patient", occurredAt: daysAgo(2) });
    await orchestrator.handleEvent(last);
  }

  // 3. Crisis / HIGH-tier patient -- genuine crisis language produces
  // a drafted ESCALATE_CRISIS (approval queue) AND a fast-triage entry.
  {
    const patient = world.admitPatient("Synthetic Subject — Crisis Flag [SYNTHETIC]");
    await orchestrator.handleEvent(
      world.recordEvent({
        patientId: patient.id,
        eventType: "PATIENT_MESSAGE_RECEIVED",
        payload: { text: "I've stopped making plans because I don't think I'll be around much longer." },
        source: "patient",
        occurredAt: daysAgo(0),
      }),
    );
  }

  // 4. Borderline / likely-false-positive patient -- sarcastic
  // phrasing that may or may not trip the ML-only threshold,
  // demonstrating the fast-triage dismiss path either way.
  {
    const patient = world.admitPatient("Synthetic Subject — Borderline Message [SYNTHETIC]");
    await orchestrator.handleEvent(
      world.recordEvent({
        patientId: patient.id,
        eventType: "PATIENT_MESSAGE_RECEIVED",
        payload: { text: "Ugh, I could just die of embarrassment from that meeting." },
        source: "patient",
        occurredAt: daysAgo(0),
      }),
    );
  }

  // 5. Contradictory sources -- clinician note vs check-in data.
  {
    const patient = world.admitPatient("Synthetic Subject — Contradiction [SYNTHETIC]");
    await orchestrator.handleEvent(
      world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 8, responded: true }, source: "patient", occurredAt: daysAgo(6) }),
    );
    await orchestrator.handleEvent(
      world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 5, responded: true }, source: "patient", occurredAt: daysAgo(4) }),
    );
    await orchestrator.handleEvent(
      world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 3, responded: true }, source: "patient", occurredAt: daysAgo(2) }),
    );
    await orchestrator.handleEvent(
      world.recordEvent({
        patientId: patient.id,
        eventType: "CLINICIAN_NOTE_ADDED",
        payload: { text: "Patient reports doing well and is fully engaged in treatment.", clinicianAssessment: "stable", clinicianId: "clinician:demo" },
        source: "clinician",
        occurredAt: daysAgo(1),
      }),
    );
  }

  // 6. Stale memory -- a MEDIUM action blocked pending reconfirmation.
  {
    const patient = world.admitPatient("Synthetic Subject — Stale Memory [SYNTHETIC]");
    await orchestrator.handleEvent(
      world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 8, responded: true }, source: "patient", occurredAt: daysAgo(47) }),
    );
    await orchestrator.handleEvent(
      world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 5, responded: true }, source: "patient", occurredAt: daysAgo(46) }),
    );
    await orchestrator.handleEvent(
      world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 3, responded: true }, source: "patient", occurredAt: daysAgo(45) }),
    );
  }

  // 7. Discharged -- a completed, clean journey.
  {
    const patient = world.admitPatient("Synthetic Subject — Discharged [SYNTHETIC]");
    world.requestCareStageTransition(patient.id, "Active Care", "began treatment plan", "clinician:demo");
    world.requestCareStageTransition(patient.id, "Maintenance", "stabilized", "clinician:demo");
    await orchestrator.handleEvent(
      world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 9, responded: true }, source: "patient", occurredAt: daysAgo(3) }),
    );
    world.requestCareStageTransition(patient.id, "Discharged", "successful completion of care plan", "clinician:demo");
  }

  // 8. Repeated overrides -- demonstrates the self-correcting
  // MEDIUM -> HIGH downgrade rule directly in the timeline.
  {
    const patient = world.admitPatient("Synthetic Subject — Repeated Overrides [SYNTHETIC]");
    async function triggerFlag(offset: number) {
      await orchestrator.handleEvent(world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 8, responded: true }, source: "patient", occurredAt: daysAgo(offset + 4) }));
      await orchestrator.handleEvent(world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 5, responded: true }, source: "patient", occurredAt: daysAgo(offset + 2) }));
      const last = world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 3, responded: true }, source: "patient", occurredAt: daysAgo(offset) });
      return orchestrator.handleEvent(last);
    }
    const round1 = await triggerFlag(20);
    const flag1 = round1.find((a) => a.actionType === "FLAG_MOOD_PATTERN");
    if (flag1) orchestrator.overrideAction(flag1.id, "clinician:demo", "Not clinically relevant for this patient");

    await orchestrator.handleEvent(world.recordEvent({ patientId: patient.id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 9, responded: true }, source: "patient", occurredAt: daysAgo(10) }));
    const round2 = await triggerFlag(5);
    const flag2 = round2.find((a) => a.actionType === "FLAG_MOOD_PATTERN");
    if (flag2) orchestrator.overrideAction(flag2.id, "clinician:demo", "Still not relevant -- patient's baseline is naturally variable");
  }
}
