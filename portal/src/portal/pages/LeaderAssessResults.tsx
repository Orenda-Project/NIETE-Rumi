import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronDown, ChevronLeft, RefreshCw } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import { childTestSa } from '../services/api';
import { COPY, urDigits, type Lang } from '../lib/assess/copy';
import type { SaResults, SaTaskResult } from '../types/childTestSa';

/**
 * One Learning assessment session's results (/portal/leader/assess/results/:sessionId), read only.
 *
 * The server answers for the coach's own session only, behind the sa_results_view switch (404 when off or not
 * theirs — the page then says "not available"). Per task: how the child answered, attempted / correct, options per
 * tile and the chance-corrected score, correct per minute on 60-second tasks, how it ended; a spoken task says its
 * recording is kept and scored later, or shows the score once scored. A short "How scoring works" panel explains
 * the SA scale (design/SCORING.md is the long text). Never a child's name; the URL carries the session id only.
 * One card per task, so 360 px never scrolls sideways.
 */

const LANG_KEY = 'niete-assess-lang';
/** Urdu: the app's Nastaliq stack and line height (same as LeaderAssess). */
const URDU_ROOT = '[font-family:var(--font-urdu)] [word-spacing:0.15em] [&_*]:leading-[2] [&_.text-xs]:text-sm';
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const LRI = '⁦';
const PDI = '⁩';

function readLang(): Lang {
  try { return window.localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ur'; } catch { return 'ur'; }
}

/** A number as the language writes it: Urdu digits, isolated so it keeps its order in right-to-left text. */
function numIn(lang: Lang, n: number | string): string {
  return lang === 'ur' ? `${LRI}${urDigits(n)}${PDI}` : String(n);
}

/** "2026-10-21 10:00" in Pakistan time. */
function whenIn(lang: Lang, iso: string | null): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const s = new Date(t + PKT_OFFSET_MS).toISOString();
  return numIn(lang, `${s.slice(0, 10)} ${s.slice(11, 16)}`);
}

type Load = { kind: 'loading' } | { kind: 'off' } | { kind: 'failed' } | { kind: 'ok'; data: SaResults };

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="shrink-0 text-sm text-slate-600">{label}</dt>
      <dd className="min-w-0 text-end font-medium text-slate-900 [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

export default function LeaderAssessResults() {
  const { sessionId = '' } = useParams();
  const [lang, setLang] = useState<Lang>(readLang);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [howOpen, setHowOpen] = useState(false);
  const copy = COPY[lang];
  const r = copy.results;

  const fetchResults = useCallback(() => {
    let live = true;
    setLoad({ kind: 'loading' });
    childTestSa.getResults(sessionId)
      .then((data) => { if (live) setLoad({ kind: 'ok', data }); })
      .catch((err: unknown) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (live) setLoad({ kind: status === 404 || status === 403 ? 'off' : 'failed' });
      });
    return () => { live = false; };
  }, [sessionId]);

  useEffect(() => fetchResults(), [fetchResults]);

  const switchLang = () => {
    const next: Lang = lang === 'ur' ? 'en' : 'ur';
    setLang(next);
    try { window.localStorage.setItem(LANG_KEY, next); } catch { /* per-device convenience only */ }
  };

  const n = (v: number | null) => (v === null || v === undefined ? copy.none : numIn(lang, v));

  const header = (
    <div className="flex items-center justify-between gap-2 mb-4">
      <Link to="/portal/leader/assess" className="flex min-h-[48px] items-center gap-1 text-slate-700">
        <ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden /> {copy.back}
      </Link>
      <h1 className="min-w-0 flex-1 text-center text-lg font-bold text-slate-900">{r.title}</h1>
      <button type="button" onClick={switchLang} className="min-h-[48px] rounded-full border border-slate-300 px-3 text-sm">{copy.lang}</button>
    </div>
  );

  const taskCard = (t: SaTaskResult) => {
    const mode = t.mode ? r.modes[t.mode] : copy.none;
    const spoken = t.mode === 'record' || t.mode === 'oral';
    const scored = t.recording === 'scored' && !!t.score && Object.values(t.score).some((v) => typeof v === 'number');
    const stop = t.stopReason ? (r.stops as Record<string, string>)[t.stopReason] || t.stopReason : null;
    // a task the child never did (sandbox Jump, level 2 skipped, no microphone) has no counts: say how it ended only
    const skipped = !!t.stopReason && (t.stopReason.startsWith('skipped_') || t.stopReason === 'mic_unavailable') && !t.attempted;
    return (
      <li key={t.taskId} data-testid={`result-task-${t.taskId}`} className="rounded-2xl border border-slate-200 bg-white p-4">
        {t.title?.[lang] ? (
          <>
            <h2 className="font-semibold text-slate-900">{t.title[lang]}</h2>
            <p data-testid="result-task-id" dir="ltr" className="mb-1 text-start text-xs text-slate-500"><bdi>{t.taskId}</bdi></p>
          </>
        ) : <h2 className="mb-1 font-semibold text-slate-900"><bdi>{t.taskId}</bdi></h2>}
        <dl className="divide-y divide-slate-100">
          <Row label={r.mode} value={mode} />
          {skipped ? null : <>
          {!spoken && <Row label={r.attempted} value={n(t.attempted)} />}
          {!spoken && <Row label={r.correct} value={n(t.correct)} />}
          {t.mode === 'tap' && <Row label={r.optionsN} value={n(t.optionsN)} />}
          {t.mode === 'tap' && <Row label={r.chanceCorrected} value={n(t.chanceCorrected)} />}
          {!spoken && t.itemsPerMin !== null && <Row label={r.itemsPerMin} value={n(t.itemsPerMin)} />}
          {spoken && scored && <Row label={r.recording} value={r.scored} />}
          {spoken && scored && Object.entries(t.score as Record<string, number>).map(([k, v]) => (
            <Row key={k} label={`${r.score} · ${k}`} value={n(v)} />
          ))}
          {/* no score yet is "kept, scored later" — never a 0 or an empty score (no scorer, or scoring off) */}
          {spoken && !scored && t.recording !== 'none' && <Row label={r.recording} value={r.scoredLater} />}
          </>}
          {stop && <Row label={r.stopReason} value={stop} />}
        </dl>
      </li>
    );
  };

  let content: JSX.Element;
  if (load.kind === 'loading') content = <p className="text-slate-600">{copy.loading}</p>;
  else if (load.kind === 'off') content = <p className="text-slate-700">{r.notAvailable}</p>;
  else if (load.kind === 'failed') {
    content = (
      <div className="space-y-3">
        <p className="text-slate-700">{copy.loadFailed}</p>
        <button type="button" onClick={fetchResults} className="min-h-[48px] rounded-xl border px-4 flex items-center gap-2">
          <RefreshCw className="h-4 w-4" aria-hidden /> {copy.tryAgain}
        </button>
      </div>
    );
  } else {
    const s = load.data.session;
    const tasks = load.data.tasks || [];
    const status = (r.statuses as Record<string, string>)[s.status] || s.status;
    const part = !s.block ? null : s.block === 'rdf' ? r.rdf : (copy.blocks as Record<string, string>)[s.block] || s.block;
    content = (
      <div className="space-y-4">
        <dl data-testid="results-session" className="rounded-2xl bg-slate-50 p-4 divide-y divide-slate-100">
          <Row label={r.grade} value={copy.grade(s.grade)} />
          <Row label={r.form} value={s.form} />
          {part && <Row label={r.part} value={part} />}
          <Row label={r.status} value={status} />
          {whenIn(lang, s.startedAt) && <Row label={r.started} value={whenIn(lang, s.startedAt) as string} />}
          {whenIn(lang, s.endedAt) && <Row label={r.ended} value={whenIn(lang, s.endedAt) as string} />}
          {s.lang && <Row label={r.language} value={r.langs[s.lang]} />}
        </dl>
        <div className="rounded-2xl border border-sky-200 bg-sky-50">
          <button type="button" aria-expanded={howOpen} onClick={() => setHowOpen((o) => !o)}
            className="flex w-full min-h-[48px] items-center justify-between gap-2 px-4 text-start font-medium text-sky-900">
            {r.howTitle}
            <ChevronDown className={`h-5 w-5 shrink-0 transition-transform ${howOpen ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {howOpen && (
            <ul data-testid="results-how" className="list-disc space-y-1 px-4 pb-4 ps-8 text-sm text-slate-800">
              {[r.how1, r.how2, r.how3, r.how4, r.how5, r.how6, r.how7].map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
        </div>
        {tasks.length === 0 ? <p className="text-slate-700">{r.noTasks}</p> : <ul className="space-y-3">{tasks.map(taskCard)}</ul>}
      </div>
    );
  }

  return (
    <PortalLayout>
      <div data-testid="results-root" className={`max-w-md mx-auto overflow-x-clip ${lang === 'ur' ? URDU_ROOT : ''}`} dir={lang === 'ur' ? 'rtl' : 'ltr'} lang={lang}>
        {header}
        {content}
      </div>
    </PortalLayout>
  );
}
