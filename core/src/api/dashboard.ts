/**
 * REST API for the clinician dashboard (Phase 6). Talks to a single
 * shared World + Orchestrator instance (see server.ts) -- everything
 * here is a thin HTTP wrapper around methods that are already fully
 * tested in isolation (core/tests/, eval-harness/); this layer adds
 * no new business logic of its own.
 *
 * "Real-time updates via Supabase subscriptions" (spec 8 Phase 6) is
 * simulated locally the same way the event system itself is (spec 5:
 * "AWS EventBridge, simulated locally with an in-process event
 * emitter for dev") -- a plain WebSocket broadcast that just tells
 * connected clients "something changed, refetch," rather than a
 * fine-grained diff feed. A production deployment would replace this
 * with real Supabase Realtime subscriptions against Postgres, same
 * swap-the-backend story as eventStore.ts's in-memory implementation.
 */
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import type { WebSocketServer } from "ws";
import type { World } from "../index.js";
import { Orchestrator, AccessDeniedError } from "../index.js";

const DEMO_PRINCIPAL = "clinician:demo";

/** Express 5's ParamsDictionary types route params as string | string[] under noUncheckedIndexedAccess; route patterns here never repeat a param, so this is always a plain string. */
function param(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0]! : (value as string);
}

function broadcastRefresh(wss: WebSocketServer, reason: string): void {
  const message = JSON.stringify({ type: "refresh", reason, at: new Date().toISOString() });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(message);
  }
}

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function createDashboardApp(world: World, orchestrator: Orchestrator, wss: WebSocketServer) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // ---- Patients ----
  app.get("/api/patients", (_req, res) => {
    const snapshots = world.listPatients().map((p) => world.getSnapshot(p.id));
    res.json(snapshots);
  });

  app.get("/api/patients/:id", (req, res) => {
    const patient = world.getPatient(param(req, "id"));
    if (!patient) {
      res.status(404).json({ error: "Patient not found" });
      return;
    }
    res.json(world.getSnapshot(param(req, "id")));
  });

  // ---- Timeline: events + actions + overrides + reasoning-trace metadata, merged chronologically ----
  app.get("/api/patients/:id/timeline", (req, res) => {
    const patientId = param(req, "id");
    const patient = world.getPatient(patientId);
    if (!patient) {
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    const events = world.store.getByPatient(patientId).map((e) => ({
      kind: "event" as const,
      at: e.occurredAt,
      event: e,
    }));
    const actions = orchestrator.actionRegistry.getByPatient(patientId).map((a) => ({
      kind: "action" as const,
      at: a.createdAt,
      action: a,
    }));
    const overrides = orchestrator.overrideMemory.getAllOverridesForPatient(patientId).map((o) => ({
      kind: "override" as const,
      at: o.at,
      override: o,
    }));
    const reasoningTraces = orchestrator.auditLog.listEntriesForPatient(patientId).map((t) => ({
      kind: "reasoning_trace" as const,
      at: t.createdAt,
      trace: t, // metadata only -- content requires GET /api/reasoning-traces/:id (access-controlled)
    }));

    const timeline = [...events, ...actions, ...overrides, ...reasoningTraces].sort((a, b) =>
      a.at.localeCompare(b.at),
    );
    res.json(timeline);
  });

  // ---- Approval queue: everything still "proposed" needing a human, minus items already in fast triage ----
  app.get("/api/approval-queue", (_req, res) => {
    const triagedActionIds = new Set(orchestrator.triageQueue.getPending().map((i) => i.escalationActionId));
    const pending = orchestrator.actionRegistry
      .getAll()
      .filter((a) => a.status === "proposed" && !triagedActionIds.has(a.id))
      .map((a) => ({ action: a, patient: world.getPatient(a.patientId) }))
      .sort((a, b) => a.action.createdAt.localeCompare(b.action.createdAt));
    res.json(pending);
  });

  app.post(
    "/api/actions/:id/approve",
    asyncHandler(async (req, res) => {
      const by = (req.body?.by as string) ?? DEMO_PRINCIPAL;
      const action = await orchestrator.approveAction(param(req, "id"), by);
      broadcastRefresh(wss, "action-approved");
      res.json(action);
    }),
  );

  app.post("/api/actions/:id/override", (req, res) => {
    const by = (req.body?.by as string) ?? DEMO_PRINCIPAL;
    const reason = (req.body?.reason as string) ?? "Overridden via dashboard";
    const action = orchestrator.overrideAction(param(req, "id"), by, reason);
    broadcastRefresh(wss, "action-overridden");
    res.json(action);
  });

  // ---- Fast triage queue (Edge Case 2) ----
  app.get("/api/triage-queue", (_req, res) => {
    const items = orchestrator.triageQueue.getPending().map((item) => ({
      item,
      patient: world.getPatient(item.patientId),
      escalationAction: orchestrator.actionRegistry.getById(item.escalationActionId),
    }));
    res.json(items);
  });

  app.post(
    "/api/triage/:id/confirm",
    asyncHandler(async (req, res) => {
      const by = (req.body?.by as string) ?? DEMO_PRINCIPAL;
      const action = await orchestrator.confirmCrisisFlag(param(req, "id"), by);
      broadcastRefresh(wss, "triage-confirmed");
      res.json(action);
    }),
  );

  app.post("/api/triage/:id/dismiss", (req, res) => {
    const by = (req.body?.by as string) ?? DEMO_PRINCIPAL;
    const note = req.body?.note as string | undefined;
    const action = orchestrator.dismissCrisisFlag(param(req, "id"), by, note);
    broadcastRefresh(wss, "triage-dismissed");
    res.json(action);
  });

  // ---- Reasoning traces (Edge Case 7): access-controlled, decrypted on read only ----
  app.get("/api/reasoning-traces/:entryId", (req, res) => {
    const requesterId = (req.query.requesterId as string) ?? DEMO_PRINCIPAL;
    try {
      const content = orchestrator.readReasoningTrace(param(req, "entryId"), requesterId);
      res.json({ content });
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        res.status(403).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // ---- Demo interactivity: simulate an inbound patient message ----
  app.post(
    "/api/patients/:id/simulate-message",
    asyncHandler(async (req, res) => {
      const patient = world.getPatient(param(req, "id"));
      if (!patient) {
        res.status(404).json({ error: "Patient not found" });
        return;
      }
      const text = (req.body?.text as string) ?? "";
      const event = world.recordEvent({
        patientId: patient.id,
        eventType: "PATIENT_MESSAGE_RECEIVED",
        payload: { text },
        source: "patient",
      });
      const actions = await orchestrator.handleEvent(event);
      broadcastRefresh(wss, "message-simulated");
      res.json({ event, actions });
    }),
  );

  // ---- Full audit trail export (spec 6, "Output": "Full audit trail export") ----
  app.get("/api/patients/:id/audit-log", (req, res) => {
    res.json(orchestrator.auditLog.getAccessLog(param(req, "id")));
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  });

  return app;
}
