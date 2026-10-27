/**
 * bd-sex15q.17 — every RM address. A path id is a coach's users.id only (coaches are staff, not the protected party;
 * API §1); never a teacher key, code, code_id or name (B1, B21).
 */
export const RM_BASE = "/portal/rm";

export const rmPaths = {
  sector: RM_BASE,
  coaches: `${RM_BASE}/coaches`,
  coach: (coachUserId: string) => `${RM_BASE}/coach/${encodeURIComponent(coachUserId)}`,
  circle: `${RM_BASE}/circle`,
  stats: `${RM_BASE}/stats`,
} as const;

export type RmNavKey = "sector" | "coaches" | "circle" | "stats";

export const RM_NAV: readonly { key: RmNavKey; to: string; copy: "nav.rm.sector" | "nav.rm.coaches" | "nav.rm.circle" | "nav.rm.stats" }[] = [
  { key: "sector", to: rmPaths.sector, copy: "nav.rm.sector" },
  { key: "coaches", to: rmPaths.coaches, copy: "nav.rm.coaches" },
  { key: "circle", to: rmPaths.circle, copy: "nav.rm.circle" },
  { key: "stats", to: rmPaths.stats, copy: "nav.rm.stats" },
];

/** One coach's page belongs to Coaches; anything else under /portal/rm that is not a tab is the Sector. */
export function currentRmItem(pathname: string): RmNavKey | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === rmPaths.coaches || p.startsWith(`${RM_BASE}/coach/`)) return "coaches";
  if (p === rmPaths.circle) return "circle";
  if (p === rmPaths.stats) return "stats";
  if (p === RM_BASE) return "sector";
  return null;
}
