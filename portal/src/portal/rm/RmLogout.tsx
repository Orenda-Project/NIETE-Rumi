import { useEffect, useRef, useState } from "react";
import { EllipsisVertical, LogOut } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useLogoutGuard } from "../lib/recordingSession";
import { TEACHER_FRAME } from "../teacher/copy";
import { useCopy } from "../teacher/i18n";

/**
 * fix-r5 s6 (a), GO_PACKAGE v5 §0.4 a (qa-rm 102038, COS-deputy 102124): the RM's way to end the session. A pure RM
 * never reaches the coach's More, and RMs work on shared office laptops, so every RM page carries Log out: on a laptop
 * as a row in the rail's foot under EN | اردو (RmLogoutRow), on a phone in the bar's overflow beside the toggle
 * (RmOverflow: ⋮ → a one-item menu, so a stray tap beside the toggle never ends the session). Both call the app's one
 * logout (useAuth → POST /api/portal/logout → /portal/login) through the recording guard, as the coach's More does.
 * The words are the kit's own ("Log out" / "لاگ آؤٹ", "More" / "مزید"): no new copy.
 */
function useRmLogout(): () => void {
  const { logout } = useAuth();
  return useLogoutGuard(logout);
}

export function RmLogoutRow() {
  const C = useCopy(TEACHER_FRAME);
  const logout = useRmLogout();
  return (
    <button
      type="button"
      data-testid="rm-logout"
      onClick={logout}
      className="flex min-h-[44px] items-center gap-3 whitespace-nowrap rounded-[10px] px-3 text-start text-[15px] font-medium text-cp-ink-2 outline-none hover:bg-cp-ground hover:text-cp-ink focus-visible:ring-[3px] focus-visible:ring-cp-green"
    >
      <LogOut size={20} strokeWidth={1.5} aria-hidden="true" />
      <span>{C.more.logout}</span>
    </button>
  );
}

export function RmOverflow({ tone = "light" }: { tone?: "light" | "dark" }) {
  const C = useCopy(TEACHER_FRAME);
  const logout = useRmLogout();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        data-testid="rm-more"
        aria-label={C.nav.more}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-11 w-11 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green ${tone === "dark" ? "bg-white/10 text-white" : "border border-cp-hairline bg-white text-cp-ink-2"}`}
      >
        <EllipsisVertical size={20} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" data-testid="rm-more-menu" className="absolute end-0 top-[calc(100%+6px)] z-50 min-w-[180px] rounded-[12px] border border-cp-hairline bg-white p-1 shadow-[0_4px_16px_rgba(51,55,72,0.12)]">
          <button
            type="button"
            role="menuitem"
            data-testid="rm-logout"
            onClick={() => { setOpen(false); logout(); }}
            className="flex min-h-[44px] w-full items-center gap-3 whitespace-nowrap rounded-[10px] px-3 text-start text-[15px] font-semibold text-cp-ink outline-none hover:bg-cp-ground focus-visible:ring-[3px] focus-visible:ring-cp-green"
          >
            <LogOut size={20} strokeWidth={1.5} aria-hidden="true" className="text-cp-navy" />
            <span>{C.more.logout}</span>
          </button>
        </div>
      )}
    </div>
  );
}
