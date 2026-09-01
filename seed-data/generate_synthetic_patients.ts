/**
 * Generates 20+ clearly-synthetic patient journeys exercising all
 * three world-state dimensions (care_stage x risk_level x
 * engagement_status) independently, so the parallel-track model
 * (spec 2.1) has real event streams to compute against.
 *
 * ALL names, notes, and messages below are obviously fabricated --
 * this is a portfolio/demo dataset, never real PHI.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { World } from "../core/src/index.js";

const SYNTHETIC_FIRST_NAMES = [
  "Synthetic", "Demo", "Sample", "Fixture", "Placeholder", "Mock", "Test", "Fake",
];
const SYNTHETIC_LAST_LABELS = [
  "Subject-A", "Subject-B", "Case-01", "Case-02", "Case-03", "Case-04", "Case-05",
  "Case-06", "Case-07", "Case-08", "Case-09", "Case-10", "Case-11", "Case-12",
  "Case-13", "Case-14", "Case-15", "Case-16", "Case-17", "Case-18", "Case-19", "Case-20",
];

type JourneyScript = (world: World, patientId: string, day: (n: number) => string) => void;

function dayOffset(baseIso: string) {
  const base = new Date(baseIso).getTime();
  return (n: number) => new Date(base + n * 24 * 60 * 60 * 1000).toISOString();
}

/** Stable, engaged patient in early Intake. */
const journeyStableIntake: JourneyScript = (world, id, day) => {
  world.recordEvent({ patientId: id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 8, responded: true }, source: "patient", occurredAt: day(1) });
  world.recordEvent({ patientId: id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 7, responded: true }, source: "patient", occurredAt: day(2) });
};

/** Active Care, Watch risk from a declining mood-score trend. */
const journeyWatchActiveCare: JourneyScript = (world, id, day) => {
  world.requestCareStageTransition(id, "Active Care", "began treatment plan", "clinician:demo-1");
  world.recordEvent({ patientId: id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 8, responded: true }, source: "patient", occurredAt: day(1) });
  world.recordEvent({ patientId: id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 6, responded: true }, source: "patient", occurredAt: day(3) });
  world.recordEvent({ patientId: id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 4, responded: true }, source: "patient", occurredAt: day(5) });
};

/** Maintenance stage but Crisis risk -- proves dimensions are independent. */
const journeyCrisisDuringMaintenance: JourneyScript = (world, id, day) => {
  world.requestCareStageTransition(id, "Active Care", "began treatment plan", "clinician:demo-1");
  world.requestCareStageTransition(id, "Maintenance", "stabilized over 6 months", "clinician:demo-1");
  world.recordEvent({ patientId: id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 8, responded: true }, source: "patient", occurredAt: day(1) });
  world.recordEvent({
    patientId: id,
    eventType: "PATIENT_MESSAGE_RECEIVED",
    payload: { text: "[SYNTHETIC] I don't think I can keep doing this anymore.", crisisClassifierFlag: true },
    source: "patient",
    occurredAt: day(10),
  });
  world.recordEvent({
    patientId: id,
    eventType: "CRISIS_FLAG_RAISED",
    payload: { severity: "high", reason: "crisis-classifier flagged inbound message", raisedBy: "agent" },
    source: "agent",
    occurredAt: day(10),
  });
};

/** Crisis flag that gets resolved as a false positive (sarcasm). */
const journeyFalsePositiveCrisis: JourneyScript = (world, id, day) => {
  world.requestCareStageTransition(id, "Active Care", "began treatment plan", "clinician:demo-1");
  const flag = world.recordEvent({
    patientId: id,
    eventType: "PATIENT_MESSAGE_RECEIVED",
    payload: { text: "[SYNTHETIC] Ugh, I could just die of embarrassment from that meeting.", crisisClassifierFlag: true },
    source: "patient",
    occurredAt: day(2),
  });
  const raised = world.recordEvent({
    patientId: id,
    eventType: "CRISIS_FLAG_RAISED",
    payload: { severity: "low", reason: "crisis-classifier flagged sarcastic phrase", raisedBy: "agent" },
    source: "agent",
    occurredAt: day(2),
  });
  world.recordEvent({
    patientId: id,
    eventType: "CRISIS_FLAG_RESOLVED",
    payload: { resolution: "confirmed_false_positive", resolvedBy: "clinician:demo-1", relatedFlagEventId: raised.id },
    source: "clinician",
    occurredAt: day(2),
  });
  void flag;
};

/** Disengaged patient: repeated missed check-ins, still in Active Care. */
const journeyDisengaged: JourneyScript = (world, id, day) => {
  world.requestCareStageTransition(id, "Active Care", "began treatment plan", "clinician:demo-1");
  for (let i = 1; i <= 4; i++) {
    world.recordEvent({ patientId: id, eventType: "CHECK_IN_MISSED", payload: { scheduledFor: day(i) }, source: "system", occurredAt: day(i) });
  }
};

/** Unresponsive: two recent misses, not yet fully disengaged. */
const journeyUnresponsive: JourneyScript = (world, id, day) => {
  world.requestCareStageTransition(id, "Active Care", "began treatment plan", "clinician:demo-1");
  world.recordEvent({ patientId: id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 7, responded: true }, source: "patient", occurredAt: day(1) });
  world.recordEvent({ patientId: id, eventType: "CHECK_IN_MISSED", payload: { scheduledFor: day(3) }, source: "system", occurredAt: day(3) });
  world.recordEvent({ patientId: id, eventType: "CHECK_IN_MISSED", payload: { scheduledFor: day(5) }, source: "system", occurredAt: day(5) });
};

/** Contradictory sources: clinician says stable, check-ins show decline (Edge Case 4). */
const journeyContradictorySources: JourneyScript = (world, id, day) => {
  world.requestCareStageTransition(id, "Active Care", "began treatment plan", "clinician:demo-1");
  world.recordEvent({ patientId: id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 5, responded: true }, source: "patient", occurredAt: day(1) });
  world.recordEvent({ patientId: id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 4, responded: true }, source: "patient", occurredAt: day(3) });
  world.recordEvent({ patientId: id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 3, responded: true }, source: "patient", occurredAt: day(5) });
  world.recordEvent({
    patientId: id,
    eventType: "CLINICIAN_NOTE_ADDED",
    payload: { text: "[SYNTHETIC] Patient reports doing well at session.", clinicianAssessment: "stable", clinicianId: "demo-1" },
    source: "clinician",
    occurredAt: day(5),
  });
};

/** Stale clinician note (Edge Case 3): old note should not drive Watch. */
const journeyStaleMemory: JourneyScript = (world, id, day) => {
  world.requestCareStageTransition(id, "Active Care", "began treatment plan", "clinician:demo-1");
  const longAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
  const alreadyExpired = new Date(Date.now() - 1000).toISOString();
  world.recordEvent({
    patientId: id,
    eventType: "CLINICIAN_NOTE_ADDED",
    payload: { text: "[SYNTHETIC] Concerning pattern noted 45 days ago.", clinicianAssessment: "declining", clinicianId: "demo-1" },
    source: "clinician",
    occurredAt: longAgo,
    validUntil: alreadyExpired,
  });
  world.recordEvent({ patientId: id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 8, responded: true }, source: "patient", occurredAt: day(1) });
};

/** Discharged, stable -- end of a clean journey. */
const journeyDischarged: JourneyScript = (world, id, day) => {
  world.requestCareStageTransition(id, "Active Care", "began treatment plan", "clinician:demo-1");
  world.requestCareStageTransition(id, "Maintenance", "stabilized", "clinician:demo-1");
  world.recordEvent({ patientId: id, eventType: "CHECK_IN_SUBMITTED", payload: { moodScore: 9, responded: true }, source: "patient", occurredAt: day(1) });
  world.requestCareStageTransition(id, "Discharged", "successful completion of care plan", "clinician:demo-1");
};

const JOURNEYS: JourneyScript[] = [
  journeyStableIntake,
  journeyWatchActiveCare,
  journeyCrisisDuringMaintenance,
  journeyFalsePositiveCrisis,
  journeyDisengaged,
  journeyUnresponsive,
  journeyContradictorySources,
  journeyStaleMemory,
  journeyDischarged,
];

export function generateSyntheticWorld(patientCount = 22): World {
  const world = new World();
  const baseIso = "2026-06-01T09:00:00.000Z";
  for (let i = 0; i < patientCount; i++) {
    const first = SYNTHETIC_FIRST_NAMES[i % SYNTHETIC_FIRST_NAMES.length];
    const last = SYNTHETIC_LAST_LABELS[i % SYNTHETIC_LAST_LABELS.length];
    const patient = world.admitPatient(`${first} ${last} [SYNTHETIC]`);
    const journey = JOURNEYS[i % JOURNEYS.length]!;
    journey(world, patient.id, dayOffset(baseIso));
  }
  return world;
}

function main() {
  const world = generateSyntheticWorld();
  const snapshots = world.listPatients().map((p) => world.getSnapshot(p.id));

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const outDir = join(__dirname, "output");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "patients.json");
  writeFileSync(outPath, JSON.stringify(snapshots, null, 2));

  console.log(`Generated ${snapshots.length} synthetic patient journeys -> ${outPath}`);
  const byCareStage = tally(snapshots.map((s) => s.careStage));
  const byRisk = tally(snapshots.map((s) => s.risk.riskLevel));
  const byEngagement = tally(snapshots.map((s) => s.engagement.engagementStatus));
  console.log("care_stage distribution:", byCareStage);
  console.log("risk_level distribution:", byRisk);
  console.log("engagement_status distribution:", byEngagement);
}

function tally(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, v) => {
    acc[v] = (acc[v] ?? 0) + 1;
    return acc;
  }, {});
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}
