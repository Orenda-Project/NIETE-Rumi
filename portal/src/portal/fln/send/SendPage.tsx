/**
 * "Send a lesson plan", the leaders' link builder at /portal/fln/send (DESIGN v2 §4 L3, §7).
 *
 *   grade chips 1–5 (FLN is Grades 1–5 only, bd-elc1qz; an old ?grade=6..12 reads as no grade) → subject chips (3) →
 *   search + filter chips (Screener · Has sounds · Story audio) → rows ("n/N", the title in its own language and direction, chips, minutes), each with
 *   **View** (the plan's own page, bd-4joiqz), **Send to teacher** (the teacher sheet) and **Share link** (Copy + WhatsApp).
 *
 * The rows are GET /api/portal/fln/links — the catalogue the teacher sees, so a hidden plan can never be linked. All
 * state is in the URL query (grade, subject, q, has) so Back works; an old link's `level` is ignored, since the grade
 * decides a Grade 1–5 list's rows (the corpus never reads a level for them) and every level is reachable by its grade. /me without share, or /links 404 → the "not
 * available" page; 503 → the calm line with Try again; no rows → the §7 empty line. Every control is ≥48 px.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Clock, Search, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOCUS } from '../../teacher/ui/styles';
import { isLeader } from '../../lib/leaderRole';
import { shareApi, type LinkRow } from '../share/api';
import { Fill } from '../share/Fill';
import { shareMessage, waUrl } from '../share/message';
import { type SharePlan } from '../share/PlanCard';
import SendSheet from '../share/SendSheet';
import ShareSheet, { BTN, Toast, WA_GREEN, useCopyLink } from '../share/ShareSheet';
import { num, SHARE_DIR, shareStrings, type HasChip, type ShareLang, type ShareSubject } from '../share/strings.share';
import { langOf, useFlnMe } from '../share/useFlnMe';
import { planUrl } from '../listShared';
import '../share/share.css';

const GRADES = [1, 2, 3, 4, 5];
const SUBJECTS: ShareSubject[] = ['rh-en', 'rh-ur', 'num'];
// No 'additional': the 2023-24 Additional practice plans leave the corpus (bd-e5ieg0), so that filter would always be empty.
const FILTERS: HasChip[] = ['screener', 'sounds', 'narration'];

const CHIP = 'flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full border-2 px-4 text-[17px] font-semibold leading-tight';
const CHIP_ON = 'border-[#333748] bg-[#333748] text-white';
const CHIP_OFF = 'border-[#d1d5db] bg-white text-[#333748]';

interface BuilderState {
  grade: number | null;
  subject: ShareSubject | null;
  q: string;
  has: HasChip[];
}

function readState(p: URLSearchParams): BuilderState {
  const g = Number(p.get('grade'));
  const grade = GRADES.includes(g) ? g : null;
  const s = p.get('subject') as ShareSubject | null;
  const subject = s && SUBJECTS.includes(s) ? s : null;
  const has = (p.get('has') || '').split(',').filter((h): h is HasChip => (FILTERS as string[]).includes(h));
  return { grade, subject, q: (p.get('q') || '').slice(0, 100), has };
}

/** One canonical order, so the same builder state is always the same URL. */
function writeState(s: BuilderState): URLSearchParams {
  const p = new URLSearchParams();
  if (s.grade) p.set('grade', String(s.grade));
  if (s.subject) p.set('subject', s.subject);
  if (s.q) p.set('q', s.q);
  if (s.has.length) p.set('has', s.has.join(','));
  return p;
}

type Load = { kind: 'idle' } | { kind: 'loading' } | { kind: 'rows'; rows: LinkRow[] } | { kind: 'off' } | { kind: 'down' };

function planOfRow(r: LinkRow, subject: ShareSubject): SharePlan {
  return {
    id: r.id,
    title: r.title,
    lang: r.lang === 'ur' ? 'ur' : 'en',
    dir: r.dir === 'rtl' ? 'rtl' : 'ltr',
    subject,
    level: r.level || 1,
    pos: r.pos ?? null,
    count: r.count ?? null,
    minutes: r.minutes ?? null,
  };
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-[#5b6475] rtl:normal-case rtl:tracking-normal">{label}</h2>
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn(CHIP, on ? CHIP_ON : CHIP_OFF, FOCUS)}>
      {/* One inline box: as flex items, a label's words and a <bdi> number would lose the space between them. */}
      <span>{children}</span>
    </button>
  );
}

function RowChips({ row, lang }: { row: LinkRow; lang: ShareLang }) {
  const S = shareStrings(lang);
  const c = row.chips || {};
  const tag = 'inline-flex min-h-[28px] items-center gap-1 rounded-[8px] bg-[#eef2ff] px-2 text-[14px] font-semibold text-[#3b4a9c]';
  const items: React.ReactNode[] = [];
  if (c.screener) {
    items.push(<span key="scr" className={tag}>{S.chip.screener}</span>);
    // The answer-key chip promises audio: only when the screener carries some (Num screeners can have 0 clips).
    if ((c.sounds || 0) + (c.words || 0) > 0 || c.narration) items.push(<span key="ak" className={tag}>{S.chip.answerKey}</span>);
  } else if ((c.sounds || 0) > 0) items.push(<span key="snd" className={tag}><Volume2 className="h-4 w-4" aria-hidden="true" /><Fill text={c.sounds === 1 ? S.soundOne : S.sounds} values={{ n: c.sounds as number }} lang={lang} /></span>);
  if (c.guide) items.push(<span key="gd" className={tag}>{S.chip.guide}</span>);
  if (c.narration) items.push(<span key="nar" className={tag}>{S.chip.narration}</span>);
  if (c.textbook) items.push(<span key="tb" className={tag}>{S.chip.textbook}</span>);
  if (c.additional) items.push(<span key="add" className={tag}>{S.chip.additional}</span>);
  if (typeof row.minutes === 'number' && row.minutes > 0) {
    items.push(<span key="min" className="inline-flex min-h-[28px] items-center gap-1 text-[14px] text-[#5b6475]"><Clock className="h-4 w-4" aria-hidden="true" /><Fill text={S.minutes} values={{ n: row.minutes }} lang={lang} /></span>);
  }
  return <div className="flex flex-wrap items-center gap-2">{items}</div>;
}

function RowCard({ row, subject, grade, lang, onSend }: { row: LinkRow; subject: ShareSubject; grade: number; lang: ShareLang; onSend: (p: SharePlan) => void }) {
  const S = shareStrings(lang);
  const plan = planOfRow(row, subject);
  const { state, copy } = useCopyLink(row.url, row.id);
  const href = waUrl(shareMessage({ uiLang: lang, subject, level: plan.level, title: row.title, url: row.url }));
  return (
    <li data-testid={`fln-send-row-${row.id}`} className="flex flex-col gap-3 rounded-[16px] border border-[#e5e7eb] bg-white p-4 shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
      <div className="flex items-start gap-3">
        {row.pos && row.count ? (
          <span className="mt-0.5 shrink-0 rounded-[8px] bg-[#f3f4f6] px-2 py-0.5 text-[14px] font-bold text-[#333748]">
            <bdi>{num(row.pos, lang)}/{num(row.count, lang)}</bdi>
          </span>
        ) : null}
        <p lang={plan.lang} dir={plan.dir} className="min-w-0 flex-1 text-[18px] font-bold leading-snug text-[#1f2333]">{row.title}</p>
      </div>
      <RowChips row={row} lang={lang} />
      {/* bd-4joiqz — read the plan before sending it: its own page, at the grade this list is for. */}
      <Link to={planUrl(row.id, grade)} className={cn(BTN, 'border-[#333748] bg-white text-[#333748]', FOCUS)}>
        {S.view}
      </Link>
      <button type="button" onClick={() => onSend(plan)} style={{ backgroundColor: WA_GREEN, borderColor: WA_GREEN }} className={cn(BTN, 'text-white', FOCUS)}>
        {S.sendToTeacher}
      </button>
      <div className="flex gap-2" aria-label={S.shareLink} role="group">
        <button type="button" onClick={copy} className={cn(BTN, 'flex-1 border-[#333748] bg-white text-[#333748]', FOCUS)}>{S.copyLink}</button>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => shareApi.event('share', row.id)}
          className={cn(BTN, 'min-h-[48px] flex-1 border-[#2f7a52] bg-[#e9f6ef] text-[#0B6B2E]', FOCUS)}
        >
          {S.whatsapp}
        </a>
      </div>
      {state === 'failed' ? <p role="alert" className="text-[15px] text-[#7a271a]">{S.copyFailed}</p> : null}
      {state === 'copied' ? <Toast text={S.linkCopied} /> : null}
    </li>
  );
}

function NotAvailable({ lang, leader }: { lang: ShareLang; leader: boolean }) {
  const S = shareStrings(lang);
  return (
    <div className="flex flex-col items-start gap-3 rounded-[16px] border border-[#e5e7eb] bg-white p-5">
      <h2 className="text-[20px] font-bold">{S.notAvailableTitle}</h2>
      <p className="text-[16px] text-[#5b6475]">{leader ? S.notSwitchedOnBody : S.notAvailableBody}</p>
      <Link to="/portal" className={cn(BTN, 'border-[#333748] bg-white text-[#333748]', FOCUS)}>{S.goHome}</Link>
    </div>
  );
}

export default function SendPage() {
  const me = useFlnMe();
  const lang = langOf(me);
  const S = shareStrings(lang);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const st = useMemo(() => readState(params), [params]);
  const [qDraft, setQDraft] = useState(st.q);
  const [load, setLoad] = useState<Load>({ kind: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const [sendFor, setSendFor] = useState<SharePlan | null>(null);
  const [shareFor, setShareFor] = useState<{ plan: SharePlan; url: string } | null>(null);

  const update = useCallback((next: Partial<BuilderState>) => {
    setParams(writeState({ ...st, ...next }), { replace: false });
  }, [st, setParams]);

  // The search box writes the URL after a short pause, so each keystroke is not a history entry or a request.
  useEffect(() => { setQDraft(st.q); }, [st.q]);
  useEffect(() => {
    if (qDraft === st.q) return undefined;
    const t = setTimeout(() => setParams(writeState({ ...st, q: qDraft.trim().slice(0, 100) }), { replace: true }), 300);
    return () => clearTimeout(t);
  }, [qDraft, st, setParams]);

  const allowed = !!me && me.share === true;
  const ready = allowed && !!st.grade && !!st.subject;
  useEffect(() => {
    if (!ready || !st.grade || !st.subject) { setLoad({ kind: 'idle' }); return undefined; }
    let alive = true;
    setLoad({ kind: 'loading' });
    void shareApi.links({ grade: st.grade, subject: st.subject, q: st.q, has: st.has }).then((r) => {
      if (!alive) return;
      if (r.ok) setLoad({ kind: 'rows', rows: Array.isArray(r.data.rows) ? r.data.rows : [] });
      else if (r.status === 404) setLoad({ kind: 'off' });
      else setLoad({ kind: 'down' });
    });
    return () => { alive = false; };
  }, [ready, st.grade, st.subject, st.q, st.has.join(','), attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickGrade = (g: number) => update({ grade: g });
  const toggleHas = (h: HasChip) => update({ has: st.has.includes(h) ? st.has.filter((x) => x !== h) : [...st.has, h] });
  const clearFilters = () => { setQDraft(''); update({ q: '', has: [] }); };

  const off = me === false || (me && me.share !== true) || load.kind === 'off';

  return (
    <div data-testid="fln-send-page" lang={lang} dir={SHARE_DIR[lang]} className="fln-root min-h-screen bg-[#f6f7f9] text-[#333748]">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-[#e5e7eb] bg-white px-3 py-2">
        <button type="button" onClick={() => navigate(-1)} aria-label={S.back} className={cn('flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full border border-[#e5e7eb]', FOCUS)}>
          <ChevronLeft className="h-6 w-6 rtl:rotate-180" aria-hidden="true" />
        </button>
        <h1 className="text-[20px] font-bold leading-snug">{S.builderTitle}</h1>
      </header>
      <main className="mx-auto flex w-full max-w-[640px] flex-col gap-5 px-4 py-4">
        {me === null ? <p role="status" className="text-[16px] text-[#5b6475]">{S.loading}</p> : null}
        {off ? <NotAvailable lang={lang} leader={!!me && me.share !== true && isLeader(me)} /> : null}
        {allowed && load.kind !== 'off' ? (
          <>
            <p className="text-[15px] text-[#5b6475]">{S.builderIntro}</p>
            <Group label={S.grade}>
              {GRADES.map((g) => <Chip key={g} on={st.grade === g} onClick={() => pickGrade(g)}>{num(g, lang)}</Chip>)}
            </Group>
            {st.grade ? (
              <Group label={S.subjectLabel}>
                {SUBJECTS.map((s) => <Chip key={s} on={st.subject === s} onClick={() => update({ subject: s })}>{S.subject[s]}</Chip>)}
              </Group>
            ) : <p className="text-[16px] text-[#5b6475]">{S.pickGrade}</p>}
            {st.grade && st.subject ? (
              <>
                <label className="relative block">
                  <span className="sr-only">{S.searchLessons}</span>
                  <Search className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#6b7280]" aria-hidden="true" />
                  <input
                    type="search"
                    aria-label={S.searchLessons}
                    placeholder={S.searchLessons}
                    value={qDraft}
                    maxLength={100}
                    onChange={(e) => setQDraft(e.target.value)}
                    className={cn('min-h-[48px] w-full rounded-[12px] border-2 border-[#d1d5db] bg-white ps-11 pe-3 text-[17px]', FOCUS)}
                  />
                </label>
                <Group label={S.filtersLabel}>
                  {FILTERS.map((h) => <Chip key={h} on={st.has.includes(h)} onClick={() => toggleHas(h)}>{S.filters[h]}</Chip>)}
                </Group>
                {load.kind === 'loading' ? <p role="status" className="text-[16px] text-[#5b6475]">{S.loading}</p> : null}
                {load.kind === 'down' ? (
                  <div className="flex flex-col items-start gap-2">
                    <p className="text-[16px]">{S.unavailable}</p>
                    <button type="button" onClick={() => setAttempt((a) => a + 1)} className={cn(BTN, 'w-auto border-[#333748] bg-white text-[#333748]', FOCUS)}>{S.tryAgain}</button>
                  </div>
                ) : null}
                {load.kind === 'rows' && load.rows.length === 0 ? (
                  <div className="flex flex-col items-start gap-2">
                    <p className="text-[16px]">{S.noMatch}</p>
                    <button type="button" onClick={clearFilters} className={cn(BTN, 'w-auto border-[#333748] bg-white text-[#333748]', FOCUS)}>{S.clearFilters}</button>
                  </div>
                ) : null}
                {load.kind === 'rows' && load.rows.length > 0 ? (
                  <ul className="flex flex-col gap-3">
                    {load.rows.map((r) => <RowCard key={r.id} row={r} subject={st.subject as ShareSubject} grade={st.grade as number} lang={lang} onSend={setSendFor} />)}
                  </ul>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </main>
      {sendFor ? (
        <SendSheet
          plan={sendFor}
          lang={lang}
          onClose={() => setSendFor(null)}
          onShareLink={() => {
            const row = load.kind === 'rows' ? load.rows.find((r) => r.id === sendFor.id) : null;
            setShareFor({ plan: sendFor, url: row ? row.url : `${window.location.origin}/portal/fln/p/${sendFor.id}` });
            setSendFor(null);
          }}
        />
      ) : null}
      {shareFor ? <ShareSheet plan={shareFor.plan} url={shareFor.url} lang={lang} onClose={() => setShareFor(null)} /> : null}
    </div>
  );
}
