/**
 * Edge Case 7 (PHI leakage through logs/reasoning traces).
 *
 * The single access-control check for a patient's PHI. AuditLog
 * (auditLog.ts) uses this SAME instance/check for reasoning-trace
 * reads -- there is deliberately no separate, looser ACL for
 * "just logs." A side-channel that bypasses patient-record
 * permissions is exactly the leak this edge case exists to prevent.
 */

export class AccessDeniedError extends Error {
  constructor(patientId: string, principalId: string) {
    super(`${principalId} does not have access to patient ${patientId}`);
    this.name = "AccessDeniedError";
  }
}

export class PHIAccessControl {
  private grants = new Map<string, Set<string>>(); // patientId -> set of principalIds

  grantAccess(patientId: string, principalId: string): void {
    const set = this.grants.get(patientId) ?? new Set<string>();
    set.add(principalId);
    this.grants.set(patientId, set);
  }

  revokeAccess(patientId: string, principalId: string): void {
    this.grants.get(patientId)?.delete(principalId);
  }

  hasAccess(patientId: string, principalId: string): boolean {
    return this.grants.get(patientId)?.has(principalId) ?? false;
  }

  /** Throws AccessDeniedError instead of returning false -- for call sites that should fail closed. */
  requireAccess(patientId: string, principalId: string): void {
    if (!this.hasAccess(patientId, principalId)) {
      throw new AccessDeniedError(patientId, principalId);
    }
  }
}
