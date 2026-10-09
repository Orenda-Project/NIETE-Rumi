import { useEffect, useState } from "react";
import { isLeader, resolveRole } from "../lib/leaderRole";
import { forgetConfig, readConfigShared } from "../lib/useNewUi";

/**
 * bd-fmf24g.1 — is the teacher app v2 (portal_teacher_v2) on for this user?
 *
 * Read like useCoachV2: null while /config is read, then true only for a real
 * `true`. Fail-CLOSED: an unreadable config, or a client that throws, is off,
 * and every page renders exactly what it rendered before.
 *
 * It remembers the last answer for the SAME user (memory only, never stored),
 * so the menu does not flash the old items on every tap. A fresh read still
 * happens on every mount, and an "off" replaces an "on".
 */

let remembered: { userKey: string; on: boolean } | null = null;

/** Shares the layout's and the navigation's one /config read (lib/useNewUi). */
function readTeacherV2(): Promise<boolean> {
  return readConfigShared().then((cfg) => cfg?.features?.teacherV2 === true).catch(() => false);
}

function rememberedFor(userKey?: string | null): boolean | null {
  return userKey && remembered && remembered.userKey === userKey ? remembered.on : null;
}

/**
 * @param userKey whose answer to remember (her phone number; memory only)
 * @param ready   false while the caller cannot ask yet
 */
export function useTeacherV2(userKey?: string | null, ready = true): boolean | null {
  const [on, setOn] = useState<boolean | null>(() => rememberedFor(userKey));

  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    readTeacherV2().then((value) => {
      if (userKey) remembered = { userKey, on: value };
      if (live) setOn(value);
    });
    return () => { live = false; };
  }, [userKey, ready]);

  return on;
}

/**
 * v2 is for teachers AND principals: the flag on AND either not in the leader family or a
 * principal (operator, 2026-10-09: a principal gets the teacher app exactly as a teacher does,
 * plus her school's analytics). Coach, AEO, supervisor and school leader stay out (the coach has
 * her own app, useCoachV2). A user with no role recorded counts as a teacher — the pilot list
 * already names her. Loading or unknown is no.
 */
export function isTeacherV2For(user: { role?: string | null } | null | undefined, flag: boolean | null): boolean {
  return flag === true && !!user && (!isLeader(user) || resolveRole(user) === "principal");
}

/** Tests only: forget the remembered answer. */
export function resetTeacherV2Memory(): void {
  remembered = null;
  forgetConfig();
}
