import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { AccessDeniedError, PHIAccessControl } from "./phiAccessControl.js";

/**
 * Edge Case 7 (PHI leakage through logs/reasoning traces).
 *
 * Agent reasoning traces (why an action was proposed, what data it
 * relied on) can themselves contain PHI-adjacent detail -- so this
 * log carries the SAME access control as the patient record itself
 * (PHIAccessControl, shared with whatever reads the record), and
 * every entry is encrypted at rest (AES-256-GCM, matching spec 5's
 * "AES-256 at rest for PHI-adjacent fields"). Every read attempt --
 * allowed or denied -- is itself appended to a separate access
 * ledger, so access to the audit trail is auditable too.
 */

interface EncryptedPayload {
  iv: string; // base64
  authTag: string; // base64
  ciphertext: string; // base64
}

export interface ReasoningTraceEntry {
  id: string;
  patientId: string;
  authorId: string; // agent name or clinician id that produced the trace
  createdAt: string;
  encrypted: EncryptedPayload;
}

export interface AccessLogEntry {
  entryId: string;
  patientId: string;
  requesterId: string;
  at: string;
  granted: boolean;
}

const ALGORITHM = "aes-256-gcm";

export class AuditLog {
  private entries = new Map<string, ReasoningTraceEntry>();
  private accessLog: AccessLogEntry[] = [];
  private key: Buffer;

  constructor(
    private phiAccessControl: PHIAccessControl,
    /** Simulates a KMS-managed key. In production this would come from a secrets manager, never be generated per-instance. */
    key: Buffer = randomBytes(32),
  ) {
    this.key = key;
  }

  private encrypt(plaintext: string): EncryptedPayload {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return {
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  }

  private decrypt(payload: EncryptedPayload): string {
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  }

  /** Writing never requires a permission check -- the agent/orchestrator producing the trace always may. */
  writeReasoningTrace(patientId: string, authorId: string, content: string): ReasoningTraceEntry {
    const entry: ReasoningTraceEntry = {
      id: randomUUID(),
      patientId,
      authorId,
      createdAt: new Date().toISOString(),
      encrypted: this.encrypt(content),
    };
    this.entries.set(entry.id, entry);
    return entry;
  }

  /**
   * Reads (and decrypts) a reasoning trace. Enforces EXACTLY the
   * same PHIAccessControl check as reading the underlying patient
   * record would -- see phiAccessControl.ts. Every attempt, granted
   * or denied, is appended to the access log before this returns
   * (or throws).
   */
  readReasoningTrace(entryId: string, requesterId: string): string {
    const entry = this.entries.get(entryId);
    if (!entry) throw new Error(`Unknown reasoning trace: ${entryId}`);

    const granted = this.phiAccessControl.hasAccess(entry.patientId, requesterId);
    this.accessLog.push({
      entryId,
      patientId: entry.patientId,
      requesterId,
      at: new Date().toISOString(),
      granted,
    });

    if (!granted) {
      throw new AccessDeniedError(entry.patientId, requesterId);
    }
    return this.decrypt(entry.encrypted);
  }

  /** Raw stored record -- for tests/audits proving the content is actually encrypted at rest, never the plaintext. */
  getRawEntry(entryId: string): ReasoningTraceEntry | undefined {
    return this.entries.get(entryId);
  }

  /** Ids (and metadata, never decrypted content) of every trace recorded for a patient -- listing itself needs no access check. */
  listEntriesForPatient(patientId: string): Omit<ReasoningTraceEntry, "encrypted">[] {
    return [...this.entries.values()]
      .filter((e) => e.patientId === patientId)
      .map(({ encrypted: _encrypted, ...meta }) => meta);
  }

  getAccessLog(patientId?: string): AccessLogEntry[] {
    return patientId ? this.accessLog.filter((e) => e.patientId === patientId) : [...this.accessLog];
  }
}
