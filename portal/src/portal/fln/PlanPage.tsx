/**
 * The plan page, `/portal/fln/p/:id` (DESIGN v2 §2 S4/S5, §5, §7; contracts api.md + player.md v2).
 *
 * Top → bottom: back bar · navy header · goal + "Full details" · time bar · the sound grid (always visible, never on a
 * screener) · every section as a CLOSED band (operator decision) · homework band · footer. The chrome speaks the
 * user's language (`useFln().lang`); the plan's own text keeps the plan's `lang`/`dir`.
 *
 * - The plan is fetched with `flnApi.plan(id)`; 404 → "This lesson isn't available"; 503/5xx → the calm line + retry.
 *   The client NEVER logs an open — the server logs it on the plan GET, after its 404 check.
 * - ONE player per page, created HERE (`useFlnPlayer(plan)`, above the grid and the sections: it registers every clip
 *   during render, so the grid's first warm is not dropped), shared through `<FlnPlayerProvider>`. Stop-on-hide lives
 *   in the player's hook; this page only flushes telemetry on hide.
 * - Player events get the plan id and go to `flnApi.events` in batches: at most one batch per 5 s, flushed on pagehide.
 * - Which bands are open lives here (keyed by section index), so it survives a sound playing, and is mirrored to
 *   `history.state` with replaceState so Back/forward restores it.
 * - Back: an in-app previous entry → navigate(-1); opened by a link → the plan's subject list for the teacher's own
 *   lowest Grade 1–5 (`loadGradeSubjects('lessons')`), else `placement[0].grades[0]`, else Grade 1.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { flnApi } from './api';
import { loadGradeSubjects } from '../lib/gradeSubjects';
import { useFln } from './FlnContext';
import { FlnPlayerProvider, SoundGrid, gridClips, useFlnPlayer } from './player';
import { Details } from './plan/Details';
import { Header } from './plan/Header';
import { Section } from './plan/Section';
import { TimeBar } from './plan/TimeBar';
import { Chrome } from './plan/text';
import ShareBar from './share/ShareBar';
import { placementForGrade } from './listShared';
import { nothingBehind } from '../lib/useBack';
import { flnStrings, type FlnLang } from './strings';
import { lessonsBack } from '../teacher/lessons/paths';
import type { FlnMe, FlnPlacement, FlnPlanResponse } from './types';
import './plan/plan.css';

const BATCH_MS = 5000;
// bd-4joiqz — the one way back to the lesson plans (teacher/lessons/paths lessonsBack): a leader's tab too.
const LESSONS_HOME = lessonsBack();

type Load =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'unavailable' }
  | { state: 'ready'; data: FlnPlanResponse };

type QueuedEvent = { kind: string; plan: number | string; clip?: string; ms?: number; result?: string };

/**
 * Where Back goes when the plan was opened by a link (no list behind it in history) — DESIGN v2 decision 15:
 * the teacher's OWN lowest grade when they have one in 1–5 (FLN is Grades 1–5 only, bd-elc1qz), else (a leader, no
 * classes, only 6–12, a failed read) the first grade of the plan's level, else Grade 1.
 */
export function linkBackTarget(subject: string | undefined, placement: FlnPlacement[] | undefined, ownGrades: number[] = []): string {
  const p = placement?.[0];
  const sub = p?.subject ?? subject;
  if (!sub) return LESSONS_HOME;
  const fln = (g: unknown): g is number => Number.isInteger(g) && (g as number) >= 1 && (g as number) <= 5;
  const own = ownGrades.filter(fln);
  const grade = own.length ? Math.min(...own) : p?.grades?.[0];
  return `/portal/fln/list/${sub}?grade=${fln(grade) ? grade : 1}`;
}

/** Her grades from her classes/history; empty for a leader or on a failed read (never blocks Back). */
async function ownGrades(): Promise<number[]> {
  try {
    const pairs = await loadGradeSubjects('lessons');
    return pairs.map((x) => x.grade).filter((g): g is number => typeof g === 'number');
  } catch {
    return [];
  }
}

/**
 * `?src=send` = a `/go` landing from a sent message (fln-go-target.js); `?src=wa` = a shared link (share/message.ts),
 * counted only when opened from outside the portal (empty referrer).
 */
export function openLinkResult(search: string): 'send' | 'wa' | null {
  const src = new URLSearchParams(search).get('src');
  if (src === 'send') return 'send';
  if (src === 'wa' && !document.referrer) return 'wa';
  return null;
}

/** Drop `src` from the address bar without a router navigation (Back must still see a link-opened page). */
function stripSrc() {
  try {
    const u = new URL(window.location.href);
    if (!u.searchParams.has('src')) return;
    u.searchParams.delete('src');
    window.history.replaceState(window.history.state, '', `${u.pathname}${u.search}${u.hash}`);
  } catch { /* history not writable: the param only stays visible */ }
}

function readOpen(planId: number): Set<number> {
  try {
    const st = window.history.state as { flnOpen?: { plan: number; open: number[] } } | null;
    if (st?.flnOpen && st.flnOpen.plan === planId && Array.isArray(st.flnOpen.open)) return new Set(st.flnOpen.open);
  } catch { /* no history state */ }
  return new Set();
}

function writeOpen(planId: number, open: Set<number>) {
  try {
    const prev = (window.history.state as Record<string, unknown> | null) ?? {};
    window.history.replaceState({ ...prev, flnOpen: { plan: planId, open: [...open].sort((a, b) => a - b) } }, '');
  } catch { /* history not writable: the state still lives in memory */ }
}

/** The telemetry batcher: ≤1 POST per 5 s; flush on pagehide / hidden / unmount. */
function useEventBatch() {
  const queue = useRef<QueuedEvent[]>([]);
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!queue.current.length) return;
    const batch = queue.current.splice(0, 50);
    last.current = Date.now();
    flnApi.events(batch);
    if (queue.current.length) timer.current = setTimeout(flush, BATCH_MS);
  }, []);
  const push = useCallback((e: QueuedEvent) => {
    queue.current.push(e);
    if (timer.current) return;
    timer.current = setTimeout(flush, Math.max(0, last.current + BATCH_MS - Date.now()));
  }, [flush]);
  useEffect(() => {
    const onHide = () => flush();
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVis);
      flush();
    };
  }, [flush]);
  return push;
}

export function PlanScreen({ me, lang }: { me: FlnMe; lang: FlnLang }) {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const s = flnStrings(lang);
  const rtl = lang === 'ur';
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const planId = Number(id);

  useEffect(() => {
    let live = true;
    setLoad({ state: 'loading' });
    flnApi.plan(id).then(
      (data) => { if (live) setLoad(data && data.plan ? { state: 'ready', data } : { state: 'missing' }); },
      // 503/5xx/network (FlnUnavailableError) and anything unexpected: the calm line + retry. 401 is FlnGate's.
      () => { if (live) setLoad({ state: 'unavailable' }); },
    );
    return () => { live = false; };
  }, [id, attempt]);

  const data = load.state === 'ready' ? load.data : null;
  const plan = data?.plan ?? null;
  // ONE player for the page, created here, above the grid and the sections (audio's wiring rule 1).
  const player = useFlnPlayer(plan);

  const push = useEventBatch();
  const planRef = useRef<number | string>(planId);
  planRef.current = plan?.id ?? planId;
  useEffect(() => player.onEvent((e) => push({ ...e, plan: planRef.current })), [player, push]);

  // The receiver's open_link (contracts/deep-link.md, Events): once per landing, only for a plan that is there.
  const linkLogged = useRef<number | string | null>(null);
  useEffect(() => {
    if (!plan || linkLogged.current === plan.id) return;
    const result = openLinkResult(location.search);
    if (!result) return;
    linkLogged.current = plan.id;
    flnApi.events([{ kind: 'open_link', plan: plan.id, result }]);
    stripSrc();
  }, [plan, location.search]);

  const [open, setOpen] = useState<Set<number>>(() => readOpen(planId));
  const toggle = useCallback((i: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      writeOpen(planId, next);
      return next;
    });
  }, [planId]);

  const placement = data?.placement ?? [];
  const screener = placement.some((p) => p.label === 'screener');
  const hasGrid = useMemo(() => !!plan && !screener && gridClips(plan).length > 0, [plan, screener]);

  const goBack = () => {
    // Nothing of the app behind (fresh tab, WhatsApp link, or the plan that sign-in REPLACED in): idx 0 (QL-backlink).
    if (!nothingBehind(location.key)) { navigate(-1); return; }
    const subject = plan?.subject;
    void ownGrades().then((grades) => navigate(linkBackTarget(subject, placement, grades)));
  };

  const shareClass = me.share ? ' fln-plan--share' : '';
  const topBar = (title?: string) => (
    <div className="fln-plan-top">
      <button type="button" className="fln-back" aria-label={s.back} onClick={goBack}>
        <span aria-hidden="true">{rtl ? '›' : '‹'}</span>
      </button>
      {title ? <span className="fln-plan-top-title"><Chrome text={title} rtl={rtl} /></span> : null}
    </div>
  );

  if (load.state === 'loading') {
    return (
      <div className={`fln-plan${shareClass}`} aria-busy="true">
        {topBar()}
        <div className="fln-plan-skel fln-plan-header" aria-label={s.errors.loading}>
          <div className="fln-skel-line" /><div className="fln-skel-line" /><div className="fln-skel-line fln-skel-line--title" />
        </div>
        {[0, 1, 2, 3].map((i) => <div key={i} className="fln-skel-sec" />)}
      </div>
    );
  }

  if (load.state === 'missing') {
    return (
      <div className={`fln-plan fln-plan--empty${shareClass}`}>
        {topBar()}
        <p className="fln-plan-msg"><Chrome text={s.errors.notAvailable} rtl={rtl} /></p>
        <button type="button" className="fln-btn" onClick={() => navigate(LESSONS_HOME)}>{s.errors.toList}</button>
      </div>
    );
  }

  if (load.state === 'unavailable') {
    return (
      <div className={`fln-plan fln-plan--empty${shareClass}`}>
        {topBar()}
        <p className="fln-plan-msg"><Chrome text={s.errors.unavailable} rtl={rtl} /></p>
        <button type="button" className="fln-btn" onClick={() => setAttempt((a) => a + 1)}>{s.errors.retry}</button>
      </div>
    );
  }

  const p = load.data.plan;
  // ?grade= (set by the list row) picks that grade's placement; the kicker and the share card read the same row.
  // Grades 1–5 only (bd-elc1qz): an old 6–12 ?grade= falls back to placement[0].
  const opened = Number(new URLSearchParams(location.search).get('grade'));
  const first = placementForGrade(placement, Number.isInteger(opened) && opened >= 1 && opened <= 5 ? opened : null);
  const sharePlacement = first ? [first, ...placement.filter((x) => x !== first)] : placement;
  const homeworkIndex = p.sections.length;
  return (
    <FlnPlayerProvider player={player}>
      <div className={`fln-plan${shareClass}`}>
        {topBar(s.subject[p.subject])}
        <Header plan={p} placement={first} uiLang={lang} />
        <Details plan={p} uiLang={lang} />
        <TimeBar plan={p} uiLang={lang} />
        {hasGrid ? (
          <div className="fln-grid-box">
            <h3 className="fln-grid-h"><span aria-hidden="true">🔊 </span><Chrome text={s.soundsInLesson} rtl={rtl} /></h3>
            <SoundGrid plan={p} screener={screener} />
          </div>
        ) : null}
        {p.sections.map((sec, i) => (
          <Section
            key={`${sec.kind}-${i}`}
            plan={p}
            index={i}
            kind={sec.kind}
            minutes={sec.minutes ?? p.minutes[sec.kind]}
            groups={sec.groups}
            open={open.has(i)}
            onToggle={toggle}
            uiLang={lang}
          />
        ))}
        {p.homework?.length ? (
          <Section
            plan={p}
            index={homeworkIndex}
            kind="homework"
            groups={[{ header: null, level: null, items: p.homework }]}
            open={open.has(homeworkIndex)}
            onToggle={toggle}
            uiLang={lang}
          />
        ) : null}
        <p className="fln-plan-foot"><Chrome text={p.programme === 'p23' ? s.footer.p23(p.id) : s.footer.p25(p.id)} rtl={rtl} /></p>
        {me.share ? <ShareBar plan={p} placement={sharePlacement} me={me} /> : null}
      </div>
    </FlnPlayerProvider>
  );
}

/** The routed page: who is looking and the chrome language come from FlnGate's context (`/me`, fetched per mount). */
export default function PlanPage() {
  const { me, lang } = useFln();
  return <PlanScreen me={me} lang={lang} />;
}
