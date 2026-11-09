// bd-2434 (Leader Portal P1, NIETE port of upstream bd-2389): role gating for
// the school-leader dashboard.
//
// The leader dashboard shows ONLY to the school-leader role family; teachers
// keep today's portal experience byte-for-byte. This mirrors the bot's
// LEADER_ROLES (bot/shared/services/observe/observe-gate.js) so the portal and
// the WhatsApp /observe flow agree on exactly who is a "leader".
//
// NIETE's family is FIVE roles — no cluster_coordinator (upstream-only role).
// Keep in lock-step with the bot file AND dashboard/lib/leader-role.js.

/** The five NIETE leader-family roles (same set the bot's /observe gate uses). */
export const LEADER_ROLES: ReadonlySet<string> = new Set([
  "school_leader",
  "aeo",
  "supervisor",
  "coach",
  "principal",
]);

/** Loose shape of what we need off the authenticated user (User satisfies it). */
export interface RoleUserLike {
  role?: string | null;
}

/** Canonical lowercase role (trimmed) or null. */
export function resolveRole(user?: RoleUserLike | null): string | null {
  const r = user?.role;
  if (r == null) return null;
  const norm = String(r).trim().toLowerCase();
  return norm === "" ? null : norm;
}

/** True only for the leader-family roles — never for teachers / unknown / null. */
export function isLeader(user?: RoleUserLike | null): boolean {
  const role = resolveRole(user);
  return role != null && LEADER_ROLES.has(role);
}

/**
 * bd-33wxxi.1 — is this user a principal? The ONE place the portal asks (mirrors dashboard/lib/leader-role.js
 * isPrincipalRole). "Principal" is something a person is at a school: when roles move to their own table, only this
 * changes. Whether a principal is on the principal app is the server's (/config features.principalApp), never this.
 */
export function principalOf(user?: RoleUserLike | null): boolean {
  return resolveRole(user) === "principal";
}
