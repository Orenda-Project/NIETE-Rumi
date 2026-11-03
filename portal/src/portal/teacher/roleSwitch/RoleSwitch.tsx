import { useEffect, useState } from "react";
import { BookOpen, CircleAlert, Repeat, School, UserCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import api from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import { readConfigShared } from "../../lib/useNewUi";
import { homeFor } from "../../lib/homeRoute";
import { useCopy } from "../i18n";
import { ConfirmTray, ListRow, StatusChip } from "../ui";
import { ROLE_SWITCH } from "./copy";
import { leave } from "./leave";

/**
 * bd-tacnwy — "Profile type": an internal tester switches her OWN users.role between teacher, coach and principal,
 * so the operator no longer flips it by hand every time she tests the other side.
 *
 * Drawn ONLY when GET /config says features.roleSwitch (the server's list, app_settings.portal_role_switch,
 * list-only and fail-closed): every real teacher and coach gets nothing at all, and POST /me/role is a 404 for them
 * (dashboard/routes/portal-role-switch.routes.js). A /config that cannot be read is off.
 *
 * The rows are the server's (`roleSwitchRoles`); hers is selected. Another one asks first (the kit's ConfirmTray,
 * with the warning to finish any recording: a recording half-way through belongs to the old type), then posts and
 * reloads the whole app into the new type's home (lib/homeRoute homeFor, as sign-in does), which reads her new role
 * from /dashboard and forwards her into that type's app.
 * The role is read once per load, so nothing short of a reload would move her.
 *
 * Placed on every app a tester can land in, so she can always switch back: the teacher's My profile, the coach's
 * My profile, and My Patch (where a principal lands).
 */

type Role = "teacher" | "coach" | "principal";
const KNOWN: readonly Role[] = ["teacher", "coach", "principal"];
const GLYPH: Record<Role, LucideIcon> = { teacher: BookOpen, coach: UserCheck, principal: School };

const isRole = (v: unknown): v is Role => typeof v === "string" && (KNOWN as readonly string[]).includes(v);


/** The server's offer for this user: null while reading, [] when off or unreadable. */
function useRoleSwitchRoles(): Role[] | null {
  const [roles, setRoles] = useState<Role[] | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => readConfigShared())
      .then((cfg) => {
        const on = cfg?.features?.roleSwitch === true;
        const list = on && Array.isArray(cfg?.roleSwitchRoles) ? cfg.roleSwitchRoles.filter(isRole) : [];
        if (live) setRoles(list);
      })
      .catch(() => { if (live) setRoles([]); });
    return () => { live = false; };
  }, []);
  return roles;
}

/** `className` places it on a page whose frame is not the teacher kit's (My Patch); nothing is drawn when off. */
export default function RoleSwitch({ className }: { className?: string } = {}) {
  const C = useCopy(ROLE_SWITCH);
  const { user } = useAuth();
  const roles = useRoleSwitchRoles();
  const current = String(user?.role || "").trim().toLowerCase();
  const [asking, setAsking] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!roles || roles.length === 0) return null;

  const confirm = async () => {
    if (!asking || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await api.post("/me/role", { role: asking });
      // The new role's home, exactly as sign-in picks it (leader family → My Patch, which forwards a coach to the coach
      // app; a teacher → the dashboard, which forwards to the teacher app). A bare /portal is not a route.
      leave.to(homeFor({ role: asking }));
    } catch {
      setFailed(true);
      setAsking(null);
      setBusy(false);
    }
  };

  return (
    <div data-testid="role-switch" className={cn("flex flex-col gap-1.5 pt-1", className)}>
      <div className="flex items-center gap-2 px-1">
        <span id="role-switch-title" className="text-[13px] font-semibold text-[#6b7280]">{C.title}</span>
        <StatusChip text={C.testers} tone="waiting" />
        <Repeat className="ms-auto h-4 w-4 text-[#9ca3af]" aria-hidden="true" />
      </div>
      <div role="group" aria-labelledby="role-switch-title" className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
        {roles.map((role, i) => {
          const Glyph = GLYPH[role];
          const mine = role === current;
          return (
            <ListRow
              key={role}
              variant="row"
              first={i === 0}
              glyph={<Glyph className="h-6 w-6" aria-hidden="true" />}
              label={C.roles[role]}
              state={mine ? "selected" : "default"}
              onPress={() => {
                if (mine || busy) return;
                setFailed(false);
                setAsking(role);
              }}
            />
          );
        })}
      </div>
      {failed && (
        <span data-testid="role-switch-error" className="inline-flex h-[26px] w-fit items-center gap-1.5 rounded-full bg-[#fee4e2] px-2.5 text-[12px] font-semibold text-[#c8331f]">
          <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />{C.failed}
        </span>
      )}
      <ConfirmTray
        open={asking !== null}
        title={asking ? C.switchTo(C.roles[asking]) : ""}
        onClose={() => { if (!busy) setAsking(null); }}
        warning={C.warning}
        confirmLabel={C.switch}
        confirmIcon={Repeat}
        onConfirm={() => { void confirm(); }}
        cancelLabel={C.cancel}
        testId="role-switch-confirm"
      />
    </div>
  );
}
