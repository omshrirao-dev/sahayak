import { randomUUID } from "node:crypto";
import { EventBus } from "./events/eventBus.js";
import { InMemoryEventStore, type AppendEventInput } from "./events/eventStore.js";
import { CareStageService, type CareStage } from "./state-machine/careStage.js";
import { computeRiskLevel, type RiskLevelResult } from "./state-machine/riskLevel.js";
import { computeEngagementStatus, type EngagementResult } from "./state-machine/engagement.js";
import type { BaseEvent, EventType } from "./events/eventTypes.js";

export * from "./events/eventTypes.js";
export * from "./events/eventBus.js";
export * from "./events/eventStore.js";
export * from "./state-machine/careStage.js";
export * from "./state-machine/riskLevel.js";
export * from "./state-machine/engagement.js";
export * from "./agents/actionSchema.js";
export * from "./agents/agentTypes.js";
export * from "./agents/orchestrator.js";
export * from "./agents/checkInAgent.js";
export * from "./agents/patternFlagAgent.js";
export * from "./agents/escalationAgent.js";
export * from "./agents/contradictionAgent.js";
export * from "./actions/actionStateMachine.js";
export * from "./actions/idempotency.js";
export * from "./actions/overrideMemory.js";
export * from "./actions/triageQueue.js";
export * from "./state-machine/staleness.js";
export * from "./safety/safetyClient.js";
export * from "./safety/phiAccessControl.js";
export * from "./safety/auditLog.js";

export interface Patient {
  id: string;
  displayName: string;
  synthetic: true;
}

/**
 * Wires the three world-state dimensions together for a set of
 * patients: explicit care_stage (XState), plus live-computed
 * risk_level and engagement_status. This is the Phase 1 in-process
 * stand-in for what will eventually be a Postgres-backed service
 * behind the dashboard API (Phase 6).
 */
export class World {
  readonly bus = new EventBus();
  readonly store = new InMemoryEventStore();
  private patients = new Map<string, Patient>();
  private careStages = new Map<string, CareStageService>();

  admitPatient(displayName: string, initialStage: CareStage = "Intake"): Patient {
    const patient: Patient = { id: randomUUID(), displayName, synthetic: true };
    this.patients.set(patient.id, patient);
    this.careStages.set(patient.id, new CareStageService(patient.id, initialStage));
    this.recordEvent({
      patientId: patient.id,
      eventType: "PATIENT_ADMITTED",
      payload: { displayName },
      source: "system",
    });
    return patient;
  }

  getPatient(patientId: string): Patient | undefined {
    return this.patients.get(patientId);
  }

  listPatients(): Patient[] {
    return [...this.patients.values()];
  }

  recordEvent<P = Record<string, unknown>>(input: AppendEventInput<P>): BaseEvent<EventType, P> {
    const event = this.store.append(input);
    this.bus.publish(event as BaseEvent);
    return event;
  }

  requestCareStageTransition(
    patientId: string,
    toStage: CareStage,
    reason: string,
    changedBy: string,
  ): boolean {
    const service = this.careStages.get(patientId);
    if (!service) throw new Error(`Unknown patient: ${patientId}`);
    return service.requestTransition(toStage, reason, changedBy);
  }

  getCareStage(patientId: string): CareStage {
    const service = this.careStages.get(patientId);
    if (!service) throw new Error(`Unknown patient: ${patientId}`);
    return service.currentStage;
  }

  getRiskLevel(patientId: string, now?: Date): RiskLevelResult {
    return computeRiskLevel(this.store.getByPatient(patientId), now);
  }

  getEngagementStatus(patientId: string): EngagementResult {
    return computeEngagementStatus(this.store.getByPatient(patientId));
  }

  /** Full world-state snapshot for a patient -- what the dashboard reads. */
  getSnapshot(patientId: string) {
    const patient = this.getPatient(patientId);
    if (!patient) throw new Error(`Unknown patient: ${patientId}`);
    return {
      patient,
      careStage: this.getCareStage(patientId),
      risk: this.getRiskLevel(patientId),
      engagement: this.getEngagementStatus(patientId),
    };
  }
}
