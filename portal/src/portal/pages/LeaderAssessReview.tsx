import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import { childTestSa } from '../services/api';
import { urDigits, type Lang } from '../lib/assess/copy';
import { useUrFit } from '../lib/assess/urFit';
import { isWordsTask } from '../lib/assess/cwpm';
import { DASH_COPY } from '../lib/assess/dashboardCopy';
import { REVIEW_COPY } from '../lib/assess/reviewCopy';
import type { SaDashboardSession, SaEarMark, SaReview, SaReviewItem, SaReviewTask } from '../types/childTestSa';

/**
 * The visit review (/portal/leader/assess/review, …/review/:sessionId), behind sa_review_page (fail closed).
 *
 * The list is the results dashboard's own read (sa/sessions: the coach's own sessions, every coach's for a results
 * admin): one row per child by the session's short id — never a name — with the minutes against the 30–45 target.
 * A child opens task by task: the time, the app's score, whether it was scored before or after the scorer fix, the
 * recordings (1-hour links, no download), and per spoken item the app's mark, the scoring agents' marks, a suspect
 * flag, and the reviewer's own ear (correct | wrong | unclear + a note) saved to the server, with the app's
 * right / wrong derived from it. 360 px first: one card per task, items stacked.
 */

const LANG_KEY = 'niete-assess-lang';
const URDU_ROOT = '[font-family:var(--font-urdu)] [word-spacing:0.15em] [&_*]:leading-[2] [&_.text-xs]:text-sm';
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const LRI = '⁦';
const PDI = '⁩';
const TARGET = { min: 30, max: 45 };
const NOTE_MAX = 500;
const EAR_MARKS: SaEarMark[] = ['correct', 'wrong', 'unclear'];

function readLang(): Lang {
  try { return window.localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ur'; } catch { return 'ur'; }
}

type Load<T> = { kind: 'loading' } | { kind: 'off' } | { kind: 'failed' } | { kind: 'ok'; data: T };

const minutesOf = (s: SaDashboardSession) => {
  const a = Date.parse(s.results.session.startedAt || '');
  const b = Date.parse(s.results.session.endedAt || '');
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 60000) : null;
};

const bandOf = (m: number | null) => (m === null ? null : m < TARGET.min ? 'under' : m > TARGET.max ? 'over' : 'in');

function appRightOf(verdict: string | null, mark: SaEarMark | null): SaReviewItem['appRight'] {
  if (!mark) return null;
  if (mark === 'unclear') return 'unclear';
  if (verdict !== 'correct' && verdict !== 'wrong') return null;
  return mark === verdict ? 'right' : 'wrong';
}

export default function LeaderAssessReview() {
  useUrFit();
  const { sessionId = '' } = useParams();
  const [lang, setLang] = useState<Lang>(readLang);
  const [list, setList] = useState<Load<SaDashboardSession[]>>({ kind: 'loading' });
  const [one, setOne] = useState<Load<SaReview>>({ kind: 'loading' });
  // sa_cwpm (round 7b item 14): a words task's rate reads CWPM
  const [cwpm, setCwpm] = useState(false);
  const c = REVIEW_COPY[lang];
  const taskName = (id: string) => DASH_COPY[lang].tasks[id] || id;

  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => childTestSa.getSwitches())
      .then(async (s) => {
        if (!live) return;
        if (!s || s.reviewPage !== true) { setList({ kind: 'off' }); setOne({ kind: 'off' }); return; }
        setCwpm(s.cwpm === true);
        try {
          if (sessionId) {
            const data = await childTestSa.getReview(sessionId);
            if (live) setOne({ kind: 'ok', data });
          } else {
            const got = await childTestSa.getSessions();
            if (live) setList({ kind: 'ok', data: (got && got.sessions) || [] });
          }
        } catch (e: any) {
          const off = e && e.response && e.response.status === 404;
          if (live) (sessionId ? setOne : setList)({ kind: off ? 'off' : 'failed' } as never);
        }
      })
      .catch(() => { if (live) { setList({ kind: 'off' }); setOne({ kind: 'off' }); } });
    return () => { live = false; };
  }, [sessionId]);

  const num = (n: number | string) => (lang === 'ur' ? `${LRI}${urDigits(n)}${PDI}` : String(n));
  const when = (iso: string | null) => {
    const t = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(t)) return '–';
    const s = new Date(t + PKT_OFFSET_MS).toISOString();
    return num(`${s.slice(0, 10)} ${s.slice(11, 16)}`);
  };

  const switchLang = () => {
    const next: Lang = lang === 'ur' ? 'en' : 'ur';
    setLang(next);
    try { window.localStorage.setItem(LANG_KEY, next); } catch { /* per-device convenience only */ }
  };

  const header = (
    <div className="mb-3 flex items-center justify-between gap-2">
      <Link to={sessionId ? '/portal/leader/assess/review' : '/portal/leader/assess'} className="flex min-h-[48px] items-center gap-1 text-slate-700">
        <ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden /> {c.back}
      </Link>
      <h1 className="min-w-0 flex-1 text-center text-lg font-bold text-slate-900">{c.title}</h1>
      <button type="button" onClick={switchLang} className="min-h-[48px] rounded-full border border-slate-300 px-3 text-sm">{c.lang}</button>
    </div>
  );
  const noName = <p data-testid="review-no-name" role="note" className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{c.noName}</p>;
  const state = (load: Load<unknown>) => {
    if (load.kind === 'loading') return <p className="text-slate-600">{c.loading}</p>;
    if (load.kind === 'off') return <p data-testid="review-off" className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-700">{c.off}</p>;
    if (load.kind === 'failed') return <p data-testid="review-failed" role="alert" className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-700">{c.failed}</p>;
    return null;
  };

  let body;
  if (!sessionId) {
    body = state(list) || (list.kind === 'ok' ? (
      <div className="space-y-3">
        {noName}
        <p className="text-sm text-slate-700">{c.listIntro}</p>
        <p className="text-xs text-slate-500">{c.target}</p>
        {list.data.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-700">{c.empty}</p> : (
          <ul className="space-y-2">
            {list.data.map((s) => {
              const m = minutesOf(s);
              const band = bandOf(m);
              const id = s.results.session.id;
              return (
                <li key={id} data-testid="review-row" data-band={band || ''} className="rounded-2xl border border-slate-200 bg-white p-3">
                  <Link to={`/portal/leader/assess/review/${id}`} className="flex min-h-[48px] items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span dir="ltr" className="block font-mono text-sm text-slate-900"><bdi>{id.slice(0, 8)}</bdi></span>
                      <span className="block text-xs text-slate-600">{c.grade(num(s.grade))} · {s.schoolName || ''} · {when(s.results.session.startedAt)}</span>
                    </span>
                    <span className="shrink-0 text-end text-sm">
                      <span className="block font-semibold text-slate-900">{m === null ? '–' : c.minutes(num(m))}</span>
                      {band ? <span className={`block text-xs ${band === 'in' ? 'text-emerald-700' : 'text-amber-700'}`}>{band === 'in' ? c.inTarget : band === 'under' ? c.under : c.over}</span> : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    ) : null);
  } else {
    body = state(one) || (one.kind === 'ok' ? (
      <div className="space-y-4">
        {noName}
        <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
          <p dir="ltr" className="text-start font-mono text-slate-900"><bdi>{one.data.session.id.slice(0, 8)}</bdi></p>
          <p>{c.grade(num(one.data.session.grade))} · {when(one.data.session.startedAt)} · {one.data.session.minutes === null ? '–' : c.minutes(num(one.data.session.minutes))} ({c.target})</p>
          <p className="text-xs text-slate-500">{c.stopRulesNote}</p>
        </div>
        <ul className="space-y-3">{one.data.tasks.map((t) => <TaskCard key={t.taskId} task={t} sessionId={one.data.session.id} lang={lang} name={taskName(t.taskId)} num={num} cwpm={cwpm} />)}</ul>
      </div>
    ) : null);
  }

  return (
    <PortalLayout>
      <div dir={lang === 'ur' ? 'rtl' : 'ltr'} lang={lang} className={`mx-auto w-full max-w-3xl px-4 py-4 ${lang === 'ur' ? URDU_ROOT : ''}`}>
        {header}
        {body}
      </div>
    </PortalLayout>
  );
}

function TaskCard({ task, sessionId, lang, name, num, cwpm = false }: { task: SaReviewTask; sessionId: string; lang: Lang; name: string; num: (n: number | string) => string; cwpm?: boolean }) {
  const c = REVIEW_COPY[lang];
  const a = task.app;
  let fix = c.notScored;
  if (task.scoredAt) fix = task.scoredAfterFix === true ? c.afterFix : task.scoredAfterFix === false ? c.beforeFix : c.fixUnknown;
  const score = a.correct === null ? '–' : c.of(num(a.correct), num(a.of ?? a.attempted ?? '–'));
  const g = task.agreement;
  return (
    <li data-testid={`review-task-${task.taskId}`} className="rounded-2xl border border-slate-200 bg-white p-3">
      <h2 className="text-base font-semibold text-slate-900">{name}</h2>
      <p dir="ltr" className="text-start text-xs text-slate-500"><bdi>{task.taskId}</bdi></p>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div><dt className="text-xs text-slate-600">{c.appScore}</dt><dd className="font-semibold text-slate-900">{score}{a.perMinute !== null ? ` · ${cwpm && isWordsTask(task.taskId) ? c.cwpm(num(a.perMinute)) : c.perMinute(num(a.perMinute))}` : ''}</dd></div>
        <div><dt className="text-xs text-slate-600">⏱</dt><dd className="font-semibold text-slate-900">{task.timeUsedS === null ? '–' : c.timeUsed(num(task.timeUsedS))}</dd></div>
      </dl>
      <p className={`mt-1 text-xs ${task.scoredAfterFix === false ? 'text-amber-700' : 'text-slate-600'}`}>{fix}</p>
      {task.secondVoice ? <p data-testid="review-second-voice" role="note" className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900">{c.secondVoice}</p> : null}
      <div className="mt-2">
        <p className="text-xs font-medium text-slate-700">{c.recordings}</p>
        {task.clips.length === 0 ? <p className="text-xs text-slate-500">{c.noRecording}</p> : (
          <ul className="space-y-1">
            {task.clips.map((clip) => (
              <li key={clip.url} className="flex items-center gap-2">
                <span dir="ltr" className="w-10 shrink-0 text-xs text-slate-500"><bdi>{clip.label.startsWith('q') ? clip.label : ''}</bdi></span>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio src={clip.url} controls preload="none" controlsList="nodownload noplaybackrate" className="h-10 w-full min-w-0" />
              </li>
            ))}
          </ul>
        )}
      </div>
      {task.items.length ? (
        <>
          <p data-testid="review-agreement" className="mt-2 text-xs text-slate-600">{c.agreement(num(g.earAgreesWithApp), num(g.reviewed), num(g.agentsAgreeWithApp), num(g.withAgents))}</p>
          <ul className="mt-2 divide-y divide-slate-100">{task.items.map((it) => <ItemRow key={it.key} item={it} taskId={task.taskId} sessionId={sessionId} lang={lang} num={num} />)}</ul>
        </>
      ) : null}
    </li>
  );
}

function ItemRow({ item, taskId, sessionId, lang, num }: { item: SaReviewItem; taskId: string; sessionId: string; lang: Lang; num: (n: number | string) => string }) {
  const c = REVIEW_COPY[lang];
  const [mark, setMark] = useState<SaEarMark | null>(item.ear ? item.ear.mark : null);
  const [note, setNote] = useState<string>((item.ear && item.ear.note) || '');
  const [saved, setSaved] = useState<{ mark: SaEarMark | null } | null>(item.ear && item.ear.mark ? { mark: item.ear.mark } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appRight = saved ? appRightOf(item.app.verdict, saved.mark) : item.appRight;
  const ag = item.agents;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const text = note.trim() || null;
      await childTestSa.markReviewItem(sessionId, { taskId, itemKey: item.key, mark, note: text });
      setSaved({ mark });
    } catch (e: any) {
      const reason = e && e.response && e.response.data && e.response.data.reason;
      setError(c.errors[reason] || c.errors.other);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li data-testid="review-item" className="py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="text-xs text-slate-500">{c.item} {num(item.key)}</span>
        {item.ref ? <span dir="auto" className="text-lg font-semibold text-slate-900"><bdi>{item.ref}</bdi></span> : null}
        <span className="text-slate-700">{c.app}: {item.app.verdict ? (c.appMarks[item.app.verdict] || item.app.verdict) : '–'}{item.app.conf !== null ? ` (${num(Math.round(item.app.conf * 100) / 100)})` : ''}</span>
        <span className="text-slate-700">{c.agents}: {ag && ag.consensus ? c.agentMarks[ag.consensus] : '–'}{ag && ag.disputed ? ` · ${c.disputed}` : ''}{ag && ag.lowTrust ? ` · ${c.lowTrust}` : ''}</span>
      </div>
      {item.suspect ? <p data-testid="review-suspect" className="mt-1 rounded-lg bg-rose-50 px-2 py-1 text-xs text-rose-800">{c.suspect}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label={c.you}>
        <span className="text-xs text-slate-600">{c.you}:</span>
        {EAR_MARKS.map((m) => (
          <button
            key={m}
            type="button"
            data-testid={`review-mark-${m}`}
            aria-pressed={mark === m}
            onClick={() => setMark(m)}
            className={`min-h-[40px] rounded-full border px-3 text-sm ${mark === m ? 'border-sky-700 bg-sky-700 text-white' : 'border-slate-300 bg-white text-slate-800'}`}
          >{c.marks[m as SaEarMark]}</button>
        ))}
        {mark ? <button type="button" onClick={() => setMark(null)} className="min-h-[40px] px-2 text-xs text-slate-600 underline">{c.clear}</button> : null}
      </div>
      <label className="mt-2 block text-xs text-slate-600">
        {c.note}
        <textarea
          data-testid="review-note"
          value={note}
          maxLength={NOTE_MAX}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 block w-full rounded-xl border border-slate-300 p-2 text-sm text-slate-900"
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" data-testid="review-save" disabled={busy} onClick={save} className="min-h-[44px] rounded-full bg-slate-900 px-4 text-sm text-white disabled:opacity-50">{c.save}</button>
        {saved && !error ? <span data-testid="review-saved" className="text-xs text-emerald-700">{c.saved}</span> : null}
        {appRight ? <span className={`text-sm font-medium ${appRight === 'right' ? 'text-emerald-800' : appRight === 'wrong' ? 'text-rose-800' : 'text-slate-700'}`}>{c.appRight[appRight]}</span> : null}
      </div>
      {error ? <p data-testid="review-error" role="alert" className="mt-1 text-sm text-rose-800">{error}</p> : null}
    </li>
  );
}
