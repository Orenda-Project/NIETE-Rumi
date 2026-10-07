import { ReactNode, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Clock, Search } from "lucide-react";
import PortalLayout from "../components/PortalLayout";
import { coach } from "../services/api";
import CoachGate from "./CoachGate";
import { COACH_COPY as C } from "./copy";
import { splitSlot } from "./time";

/**
 * bd-o15qnr — the coach app v2's building blocks, in the LIVE portal look (not
 * the portal_new_ui kit): grey page, white 16px cards with a #e5e7eb edge, the
 * system font, light-green icon circles, indigo (#33374a) primary buttons, the
 * white bottom bar. Feature colour is only ever on a feature's icon. Every
 * tap target is at least 56px tall.
 */

export const HUE = {
  scheduling: { fg: "#33374a", bg: "#e8e9f0" },
  observe: { fg: "#c8331f", bg: "#fee4e2" },
  schools: { fg: "#1d6fd8", bg: "#e3eefc" },
  training: { fg: "#6e52e0", bg: "#eeeafd" },
  green: { fg: "#48b078", bg: "#eaf6ef" }, // bd-o15qnr.12: the canvas's live accent
  amber: { fg: "#b45309", bg: "#fef3c7" },
  neutral: { fg: "#33374a", bg: "#f3f4f6" },
} as const;
export type Hue = keyof typeof HUE;

const CARD = "bg-white border border-[#e5e7eb] rounded-2xl shadow-[0_1px_2px_rgba(16,24,40,0.05)]";
const TAP = "bg-white border border-[#e5e7eb] rounded-2xl shadow-[0_1px_3px_rgba(16,24,40,0.08)] transition-colors hover:bg-[#f9fafb]";

/** A data loader: null while loading, the error when it failed, `reload` to ask again. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; failed: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  useEffect(() => {
    let live = true;
    setFailed(false);
    run().then((d) => { if (live) setData(d); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [run, tick]);
  return { data, failed, reload: () => setTick((n) => n + 1) };
}

/** A v2 page: the gate, the live layout, a heading, the content, an optional bottom action. */
// ── bd-o15qnr.21 — the pending banner ────────────────────────────────────────
//
// "There should be a banner at the top at all times showing if there are
// reports pending on the coach." Read once and shared by every page for 30 s;
// a failed read (or an API without the route) simply shows nothing.

type Pending = { waiting: number; ids: string[] };
const PENDING_TTL_MS = 30_000;
let pendingCache: { at: number; value: Promise<Pending | null> } | null = null;

function readPending(): Promise<Pending | null> {
  if (pendingCache && Date.now() - pendingCache.at < PENDING_TTL_MS) return pendingCache.value;
  const value = Promise.resolve()
    .then(() => coach.getPending())
    .then((r) => (r && typeof r.waiting === "number" ? { waiting: r.waiting, ids: Array.isArray(r.ids) ? r.ids : [] } : null))
    .catch(() => null);
  pendingCache = { at: Date.now(), value };
  return value;
}

/** Tests only: forget the shared read. */
export function resetPendingCache(): void {
  pendingCache = null;
}

export function PendingBanner() {
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    let live = true;
    readPending().then((p) => { if (live) setPending(p); });
    return () => { live = false; };
  }, []);
  if (!pending || pending.waiting < 1) return null;
  const to = pending.waiting === 1 && pending.ids[0] ? `/portal/coach/observation/${pending.ids[0]}` : "/portal/coach/reports?show=waiting";
  return (
    <Link to={to} data-testid="pending-banner"
      className="mb-1 flex min-h-[56px] items-center gap-2.5 rounded-2xl bg-[#fef3c7] px-4 text-[15px] font-semibold text-[#b45309]">
      <Clock className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="flex-1">{C.reportsWaiting(pending.waiting)}</span>
      <ChevronRight className="h-5 w-5 shrink-0 rtl:rotate-180" aria-hidden="true" />
    </Link>
  );
}

export function CoachPage({
  title, crumb, backTo, onBack, bare = false, banner = true, chips, subtitle, dock, action, children,
}: {
  title: ReactNode; crumb?: ReactNode; backTo?: string;
  /** bd-o15qnr.9: the back arrow runs this instead of leaving (Record live asks first). */
  onBack?: () => void;
  /** bd-o15qnr.9: no menu — a screen where one stray tap must not leave (Record live). */
  bare?: boolean;
  chips?: ReactNode; dock?: ReactNode;
  /** bd-o15qnr.21: the pending banner; off on Record live / Upload / Check and send (and on any bare page). */
  banner?: boolean;
  /** bd-o15qnr.18: a line under a top-level title (Home's full date). */
  subtitle?: ReactNode;
  /** bd-o15qnr.11: a control at the right of an inner page's header (the teacher's Edit). */
  action?: ReactNode;
  children: ReactNode;
}) {
  const circle = (
    <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-[#33374a]">
      <ChevronLeft className="h-5 w-5" aria-hidden="true" />
    </span>
  );
  return (
    <CoachGate>
      <PortalLayout bare={bare}>
        <div className="mx-auto flex w-full max-w-xl flex-col text-[#1d2025]">
          {banner && !bare && <div className="pt-2"><PendingBanner /></div>}
          {backTo || onBack ? (
            <header className="flex items-center gap-1 pb-2 pt-2">
              {onBack
                ? <button type="button" onClick={onBack} aria-label={C.back} className="flex h-14 w-14 shrink-0 items-center justify-center">{circle}</button>
                : <Link to={backTo as string} aria-label={C.back} className="flex h-14 w-14 shrink-0 items-center justify-center">{circle}</Link>}
              <div className="min-w-0 flex-1">
                {crumb && <div className="truncate text-[13px] font-medium text-[#6b7280]">{crumb}</div>}
                <h1 className="truncate text-[26px] font-light leading-tight tracking-[-0.01em]">{title}</h1>
              </div>
              {action}
            </header>
          ) : (
            <header className="flex flex-col gap-3 px-1 pb-2 pt-4">
              <div className="flex flex-col gap-1">
                <h1 className="text-[32px] font-light leading-tight tracking-[-0.015em]">{title}</h1>
                {subtitle && <p data-testid="page-subtitle" className="text-[17px] font-medium text-[#4b5563]">{subtitle}</p>}
              </div>
              {chips && <div className="flex flex-wrap gap-2">{chips}</div>}
            </header>
          )}
          {(backTo || onBack) && chips && <div className="flex flex-wrap gap-2 px-1 pb-2">{chips}</div>}
          <div className="flex flex-col gap-3 pb-4">{children}</div>
          {dock && (
            <div className="sticky bottom-20 z-10 -mx-4 flex gap-2.5 bg-[#f3f4f6]/95 px-4 pb-2 pt-3 md:bottom-4 md:mx-0 md:px-0">{dock}</div>
          )}
        </div>
      </PortalLayout>
    </CoachGate>
  );
}

export function PageChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-[#e5e7eb] bg-white px-3 text-[13px] font-semibold text-[#4b5563]">
      {children}
    </span>
  );
}

/**
 * A section heading. `count` sits straight after the text, 8px on (bd-o15qnr.8,
 * operator: "It should be next to Today's visits so we know that is the
 * count"); `right` is for anything that is NOT a count and goes to the far side.
 */
export function SectionLabel({ children, count, countTone = "info", countStyle = "chip", right }: {
  children: ReactNode; count?: ReactNode; countTone?: ChipTone;
  /** bd-o15qnr.12: "count" is the Reports canvas's pill (white, grey edge, bold); "chip" is Home's. */
  countStyle?: "chip" | "count";
  right?: ReactNode;
}) {
  const pill = countStyle === "count"
    ? <span className={`inline-flex h-6 items-center rounded-full border px-[9px] text-xs font-bold ${countTone === "warn" ? "border-[#fef3c7] bg-[#fef3c7] text-[#b45309]" : "border-[#e5e7eb] bg-white text-[#4b5563]"}`}>{count}</span>
    : <Chip tone={countTone}>{count}</Chip>;
  return (
    <h2 className="mx-1 mt-3 flex items-center gap-2 text-xl font-light">
      <span>{children}</span>
      {count != null && <span data-testid="section-count" className="flex">{pill}</span>}
      {right != null && <span className="ms-auto">{right}</span>}
    </h2>
  );
}

/** A small day heading inside a list ("MON 5 OCT  3"), its count beside it. */
export function DayLabel({ children, count }: { children: ReactNode; count?: ReactNode }) {
  return (
    <h3 className="mx-1 mt-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#6b7280]">
      <span>{children}</span>
      {count != null && <span data-testid="section-count" className="tabular-nums text-[#9ca3af]">{count}</span>}
    </h3>
  );
}

export function Card({ children, className = "", ...rest }: { children: ReactNode; className?: string } & Record<string, unknown>) {
  return <section className={`${CARD} ${className}`} {...rest}>{children}</section>;
}

type ChipTone = "info" | "done" | "warn" | "rec";
const CHIP: Record<ChipTone, string> = {
  info: "bg-[#f3f4f6] text-[#374151]",
  done: "bg-[#eaf6ef] text-[#2f7a52]",
  warn: "bg-[#fef3c7] text-[#b45309]",
  rec: "bg-[#fee4e2] text-[#c8331f]",
};
export function Chip({ tone = "info", children }: { tone?: ChipTone; children: ReactNode }) {
  return <span className={`inline-flex h-[26px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold ${CHIP[tone]}`}>{children}</span>;
}

export function IconCircle({ hue = "green", size = 44, children }: { hue?: Hue; size?: number; children: ReactNode }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full" style={{ width: size, height: size, background: HUE[hue].bg, color: HUE[hue].fg }} aria-hidden="true">
      {children}
    </span>
  );
}

/** bd-o15qnr.12 — the canvas's school tile (.sic): a 12px-rounded square, not a circle. */
export function IconTile({ hue = "schools", size = 44, children, testId }: { hue?: Hue; size?: number; children: ReactNode; testId?: string }) {
  return (
    <span data-testid={testId} className="flex shrink-0 items-center justify-center rounded-xl" style={{ width: size, height: size, background: HUE[hue].bg, color: HUE[hue].fg }} aria-hidden="true">
      {children}
    </span>
  );
}

export function Chevron() {
  return <ChevronRight className="h-5 w-5 shrink-0 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />;
}

/** "9:00" over "AM" in a square tile; `tone` colours it for done / next / overdue. */
export function TimeTile({ slot, tone = "neutral", size = 60 }: { slot: string | null; tone?: "neutral" | "done" | "next" | "overdue"; size?: number }) {
  const { time, meridiem } = splitSlot(slot);
  const colors = {
    neutral: { background: "#f3f4f6", color: "#33374a" },
    done: { background: "#eaf6ef", color: "#2f7a52" },
    next: { background: "#33374a", color: "#ffffff" },
    overdue: { background: "#fef3c7", color: "#b45309" },
  }[tone];
  return (
    <span className="flex shrink-0 flex-col items-center justify-center rounded-xl font-bold tabular-nums" style={{ width: size, height: size, fontSize: size >= 60 ? 16 : 14, ...colors }}>
      {time}
      {meridiem && <small className="text-[10px] font-bold tracking-wide opacity-75">{meridiem}</small>}
    </span>
  );
}

export function Initials({ name, size = 48 }: { name: string | null | undefined; size?: number }) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  const text = parts.length ? `${parts[0][0]}${parts.length > 1 ? parts[parts.length - 1][0] : ""}`.toUpperCase() : "·";
  return (
    <span className="flex shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[15px] font-bold text-[#33374a]" style={{ width: size, height: size }} aria-hidden="true">
      {text}
    </span>
  );
}

/** A tappable row card (a link with ›). */
export function TapRow({ to, children, emphasis = false, muted = false, testId }: { to: string; children: ReactNode; emphasis?: boolean; muted?: boolean; testId?: string }) {
  // bd-o15qnr.12: one set of edge/fill/shadow per state. Adding the state's
  // classes on top of TAP left two border colours (and two fills) in the class
  // list, and Tailwind's own order — not ours — picked TAP's grey.
  const look = emphasis
    ? "rounded-2xl border-2 border-[#33374a] bg-white shadow-[0_4px_14px_rgba(51,55,74,0.14)] transition-colors hover:bg-[#f9fafb]"
    : muted
      ? "rounded-2xl border border-[#e5e7eb] bg-[#f9fafb] shadow-none [&_[data-testid=name]]:text-[#6b7280]"
      : TAP;
  return (
    <Link to={to} data-testid={testId}
      className={`${look} flex min-h-[84px] items-center gap-3.5 p-3 pe-3.5`}>
      {children}
      <Chevron />
    </Link>
  );
}

/** Name over a muted line, filling the row. */
export function RowText({ name, sub }: { name: ReactNode; sub?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="truncate text-[17px] font-semibold" data-testid="name">{name}</span>
      {sub != null && <span className="truncate text-[13px] text-[#6b7280]">{sub}</span>}
    </span>
  );
}

/** A big sub-feature tile on a feature page (Scheduling, Observe). */
export function HubTile({ to, icon, hue, title, chips }: { to: string; icon: ReactNode; hue: Hue; title: string; chips?: ReactNode }) {
  return (
    <Link to={to} className="flex min-h-[112px] items-center gap-4 rounded-[18px] border border-[#e5e7eb] bg-white p-4 shadow-[0_1px_3px_rgba(16,24,40,0.08)] transition-colors hover:bg-[#f9fafb]">
      <IconCircle hue={hue} size={64}>{icon}</IconCircle>
      <span className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <b className="text-xl font-semibold leading-tight">{title}</b>
        {chips && <span className="flex flex-wrap gap-1.5">{chips}</span>}
      </span>
      <Chevron />
    </Link>
  );
}

/** A row of flat numbers under a card's top (information, never tappable). */
export function Stats({ items, testId }: { items: { value: ReactNode; label: string }[]; testId?: string }) {
  return (
    <span className="grid border-t border-[#e5e7eb] bg-[#f9fafb]" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }} data-testid={testId}>
      {items.map((it, i) => (
        <span key={it.label} className={`flex flex-col gap-px py-2.5 ${items.length >= 5 ? "px-2" : "px-3"} ${i > 0 ? "border-s border-[#eef0f3]" : ""}`}>
          <b className="text-[17px] font-bold tabular-nums">{it.value}</b>
          <span className="text-[11px] leading-tight text-[#6b7280]">{it.label}</span>
        </span>
      ))}
    </span>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex min-h-[56px] items-center gap-2.5 rounded-2xl border border-[#e5e7eb] bg-white px-4 text-[#6b7280]">
      <Search className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="sr-only">{placeholder}</span>
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="min-h-[54px] flex-1 border-0 bg-transparent text-base text-[#1d2025] outline-none" />
    </label>
  );
}

/** A native select (accessible, big): School / Coach filters. */
export function SelectBox({ label, value, onChange, options, icon }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; icon?: ReactNode;
}) {
  return (
    <label className="flex min-h-[52px] items-center gap-2.5 rounded-[14px] border border-[#e5e7eb] bg-white px-3.5 text-[15px] font-semibold">
      {icon}
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
        className="min-h-[50px] flex-1 cursor-pointer border-0 bg-transparent text-[15px] font-semibold text-[#1d2025] outline-none">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** One choice among a few (sort, minutes, AM/PM). */
export function ChoiceChips<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <div className="-me-4 flex items-center gap-2 overflow-x-auto pe-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="radiogroup" aria-label={label}>
      <span className="shrink-0 text-[13px] font-semibold text-[#6b7280]">{label}</span>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold ${value === o.value ? "border-[#33374a] bg-[#33374a] text-white" : "border-[#e5e7eb] bg-white text-[#374151]"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs({ items }: { items: { to: string; label: string; count?: number; active: boolean }[] }) {
  return (
    <nav className="flex gap-1 rounded-2xl border border-[#e5e7eb] bg-white p-1" aria-label={C.schoolsAndTeachers}>
      {items.map((t) => (
        <Link key={t.to} to={t.to} aria-current={t.active ? "page" : undefined} data-testid="tab"
          className={`flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-xl text-base font-semibold ${t.active ? "bg-[#33374a] text-white" : "text-[#4b5563]"}`}>
          {t.label}
          {t.count != null && <b className={`text-[13px] font-bold ${t.active ? "text-[#c7cad6]" : "text-[#6b7280]"}`}>{t.count}</b>}
        </Link>
      ))}
    </nav>
  );
}

type ButtonTone = "primary" | "outline" | "danger";
const BTN: Record<ButtonTone, string> = {
  primary: "bg-[#33374a] text-white border-0",
  outline: "bg-white text-[#1d2025] border border-[#e5e7eb]",
  danger: "bg-white text-[#c8331f] border border-[#e5e7eb]",
};
export function BottomLink({ to, tone = "primary", children }: { to: string; tone?: ButtonTone; children: ReactNode }) {
  return <Link to={to} className={`flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl text-base font-semibold ${BTN[tone]}`}>{children}</Link>;
}
export function BottomButton({ onClick, tone = "primary", disabled, children }: { onClick: () => void; tone?: ButtonTone; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl text-base font-semibold disabled:bg-[#e5e7eb] disabled:text-[#9ca3af] ${BTN[tone]}`}>
      {children}
    </button>
  );
}

export function StepBar({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-1.5 px-1" aria-label={C.stepOf(step)}>
      {[1, 2, 3].map((n) => <span key={n} className="h-1.5 flex-1 rounded-full" style={{ background: n <= step ? "#33374a" : "#e5e7eb" }} />)}
      <em className="ms-1.5 whitespace-nowrap text-[13px] font-semibold not-italic text-[#6b7280]">{C.stepOf(step)}</em>
    </div>
  );
}

export function Loading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      {[0, 1, 2].map((i) => <div key={i} className={`${CARD} h-[84px] animate-pulse motion-reduce:animate-none`} />)}
    </div>
  );
}

export function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="flex-1 text-[15px] font-semibold">{C.loadFailed}</span>
      <button type="button" onClick={onRetry} className="min-h-[48px] rounded-xl bg-[#f3f4f6] px-4 text-sm font-semibold text-[#33374a]">{C.retry}</button>
    </Card>
  );
}

/**
 * bd-o15qnr.8 + .14 — a teacher's phone as a coach reads it: the local 03xx
 * form, "0399 0000123" as on the canvas (operator decision). Display only — the
 * users table keeps E.164 (923…). teacher_ext_id is the phone for a teacher on
 * Rumi and a name slug for one who is not; a slug has no number to show. A
 * number outside Pakistan keeps its +<country> form.
 */
export function formatPhone(value: string | null | undefined): string | null {
  const s = String(value == null ? "" : value).replace(/[\s-]/g, "");
  if (!/^\+?\d{10,15}$/.test(s)) return null;
  const d = s.replace(/^\+/, "");
  const local = /^923\d{9}$/.test(d) ? `0${d.slice(2)}` : /^03\d{9}$/.test(d) ? d : null;
  return local ? `${local.slice(0, 4)} ${local.slice(4)}` : `+${d}`;
}

/** Digits of a phone in any local form, as the users table holds them (92…). */
export function phoneMatches(phone: string | null | undefined, query: string): boolean {
  const q = query.replace(/\D/g, "");
  if (q.length < 4) return false;
  const p = String(phone || "").replace(/\D/g, "");
  const norm = q.startsWith("0") ? `92${q.slice(1)}` : (q.length === 10 && q.startsWith("3") ? `92${q}` : q);
  return p.includes(norm) || p.includes(q);
}

/** Name contains the words, or the phone matches the digits. */
export function personMatches(name: string | null | undefined, phone: string | null | undefined, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  if (/\d{4,}/.test(q.replace(/\D/g, "")) && q.replace(/\D/g, "").length >= 4) return phoneMatches(phone, q);
  return String(name || "").toLowerCase().includes(q.toLowerCase());
}
