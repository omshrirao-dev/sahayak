/**
 * Dashboard API server entry point. Boots a single shared World +
 * Orchestrator, seeds it with demo data driven through the real
 * orchestrator (see seedDemoData.ts), grants the demo clinician
 * access to every patient (a stand-in for real auth -- see
 * docs/DECISIONS.md), and serves the REST API + a WebSocket refresh
 * channel.
 *
 * Requires the Python safety service running first:
 *   cd safety-service && python -m uvicorn app.main:app
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { World, Orchestrator, HttpSafetyClient } from "../index.js";
import { createDashboardApp } from "./dashboard.js";
import { seedDemoData } from "./seedDemoData.js";

const PORT = Number(process.env.PORT ?? 4000);
const SAFETY_URL = process.env.SAHAYAK_SAFETY_URL ?? "http://localhost:8000";
const DEMO_PRINCIPAL = "clinician:demo";

async function main() {
  console.log(`Checking safety service at ${SAFETY_URL} ...`);
  try {
    const health = await fetch(`${SAFETY_URL}/health`);
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
  } catch (err) {
    console.error(
      `Safety service not reachable at ${SAFETY_URL}. Start it first:\n` +
        `  cd safety-service && python -m uvicorn app.main:app\n` +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
    process.exit(1);
  }

  const world = new World();
  const orchestrator = new Orchestrator({ world, safetyClient: new HttpSafetyClient(SAFETY_URL) });

  // Demo stand-in for real auth (spec 5: Supabase Auth in production):
  // grant the one demo clinician principal access to every patient as
  // they're admitted, so the dashboard can read reasoning traces
  // (Edge Case 7) without building a login flow for this portfolio demo.
  world.bus.subscribe("PATIENT_ADMITTED", (event) => {
    orchestrator.phiAccessControl.grantAccess(event.patientId, DEMO_PRINCIPAL);
  });

  console.log("Seeding demo data through the live orchestrator...");
  await seedDemoData(world, orchestrator);
  console.log(`Seeded ${world.listPatients().length} synthetic patients.`);

  // Only start live event-bus wiring AFTER seeding -- seeding uses
  // direct handleEvent() calls for deterministic ordering (same
  // reason core/tests and eval-harness do this; see orchestrator.ts).
  orchestrator.start();

  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const app = createDashboardApp(world, orchestrator, wss);
  httpServer.on("request", app);

  httpServer.listen(PORT, () => {
    console.log(`SAHAYAK dashboard API listening on http://localhost:${PORT}`);
    console.log(`WebSocket refresh channel at ws://localhost:${PORT}/ws`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
