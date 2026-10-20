import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Headphones, RefreshCw, Smartphone, WifiOff } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import AssessEngineSlot from '../components/assess/AssessEngineSlot';
import AssessVisitBar, { type SyncItem } from '../components/assess/AssessVisitBar';
import { childTestSa } from '../services/api';
import { useChildTestSa } from '../lib/useChildTestSa';
import { COPY, type Lang } from '../lib/assess/copy';
import { mmss, readVisit, visitKey, writeVisit, type VisitMemory } from '../lib/assess/visitStore';
import type { SaChild, SaList, SaOutcome, SaSchool } from '../types/childTestSa';

/**
 * The coach's Learning assessment (/portal/leader/assess), behind portal_child_test_sa.
 *
 * The coach picks the school (today's visit first), then works down Rumi's list of
 * five: Present / Absent / Refused. Present opens a session; the coach hands the
 * phone and headphones to the child, the test runs in the engine slot, and the coach
 * ends it with a press-and-hold and takes the phone back. Absent or refused: the
 * server returns the list with the next alternate moved up. A child is named by
 * room and class teacher, never by roll number.
 *
 * The last list, the start time and what was finished here are kept on the phone per
 * visit (lib/assess/visitStore), so a dropped connection still shows the list.
 */

const LANG_KEY = 'niete-assess-lang';
const LIST_SIZE = 5;

type Step =
  | { kind: 'schools' }
  | { kind: 'list'; school: SaSchool }
  | { kind: 'handover'; school: SaSchool; child: SaChild; sessionId: string }
  | { kind: 'engine'; school: SaSchool; child: SaChild; sessionId: string }
  | { kind: 'giveback'; school: SaSchool; child: SaChild; sessionId: string }
  | { kind: 'summary'; school: SaSchool };

type Problem = 'no_class_list' | 'frame_exhausted' | 'not_found';

function readLang(): Lang {
  try { return window.localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ur'; } catch { return 'ur'; }
}

function nameOf(c: SaChild, lang: Lang) {
  return (lang === 'ur' && c.nameUr) || c.name || '';
}

function firstNameOf(c: SaChild, lang: Lang) {
  return (lang === 'ur' && c.firstNameUr) || c.firstName || nameOf(c, lang);
}

/** "Grade 3 - A · Teacher: …" */
function placeOf(c: SaChild, lang: Lang) {
  const room = (lang === 'ur' ? (c.classLabelUr || c.classLabel) : c.classLabel) || '';
  const teacher = c.teacherName ? COPY[lang].teacher(c.teacherName) : '';
  return [room, teacher].filter(Boolean).join(' · ');
}

function errorOf(err: unknown): { reason: string | null; network: boolean } {
  const r = (err as { response?: { data?: { reason?: string } } })?.response;
  return { reason: r?.data?.reason || null, network: !r };
}

function todaysFirst(schools: SaSchool[]) {
  return [...schools].sort((a, b) => Number(b.visitToday) - Number(a.visitToday));
}

export default function LeaderAssess() {
  const enabled = useChildTestSa();
  const [lang, setLang] = useState<Lang>(readLang);
  const copy = COPY[lang];
  const [step, setStep] = useState<Step>({ kind: 'schools' });
  const [schools, setSchools] = useState<SaSchool[] | null>(null);
  const [list, setList] = useState<SaList | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [offline, setOffline] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vkey, setVkey] = useState<string | null>(null);
  const [memory, setMemory] = useState<VisitMemory | null>(null);

  const switchLang = () => {
    const next: Lang = lang === 'ur' ? 'en' : 'ur';
    setLang(next);
    try { window.localStorage.setItem(LANG_KEY, next); } catch { /* per-device convenience only */ }
  };

  const remember = useCallback((change: (m: VisitMemory) => VisitMemory) => {
    if (!vkey) return;
    setMemory((m) => {
      const next = change(m ?? readVisit(vkey));
      writeVisit(vkey, next);
      return next;
    });
  }, [vkey]);

  const keepList = useCallback((l: SaList) => {
    setList(l);
    remember((m) => ({ ...m, list: l }));
  }, [remember]);

  // schools
  useEffect(() => {
    if (enabled !== true || step.kind !== 'schools') return undefined;
    let live = true;
    setLoadFailed(false);
    childTestSa.getSchools()
      .then(({ schools: s }) => { if (live) setSchools(todaysFirst(s)); })
      .catch(() => { if (live) setLoadFailed(true); });
    return () => { live = false; };
  }, [enabled, step.kind]);

  // the list
  const loadList = useCallback(async (s: SaSchool, key: string) => {
    setLoadFailed(false);
    setProblem(null);
    setOffline(false);
    try {
      const out = await childTestSa.getList(s.schoolId, s.visitId);
      setList(out.list);
      const m = readVisit(key);
      writeVisit(key, { ...m, list: out.list });
      setMemory({ ...m, list: out.list });
    } catch (err) {
      const { reason, network } = errorOf(err);
      if (reason === 'no_class_list' || reason === 'frame_exhausted' || reason === 'not_found') { setProblem(reason); return; }
      const saved = readVisit(key).list;
      if (network && saved) { setList(saved); setOffline(true); } else setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    if (step.kind === 'list') void loadList(step.school, visitKey(step.school.schoolId));
  }, [step, loadList]);

  const pickSchool = (s: SaSchool) => {
    const key = visitKey(s.schoolId);
    setVkey(key);
    setMemory(readVisit(key));
    setList(null);
    setStep({ kind: 'list', school: s });
  };

  const isDone = (c: SaChild) => c.sessionStatus === 'completed' || Boolean(memory?.finished[c.drawId]);

  const outcome = async (c: SaChild, value: SaOutcome) => {
    if (step.kind !== 'list') return;
    const s = step.school;
    setBusy(true);
    if (value === 'present' && !memory?.startedAt) remember((m) => ({ ...m, startedAt: m.startedAt ?? Date.now() }));
    try {
      const out = await childTestSa.markOutcome({ schoolId: s.schoolId, visitId: s.visitId, drawId: c.drawId, outcome: value });
      if (out.list) keepList(out.list);
      if (value === 'present') {
        if (out.sessionId) setStep({ kind: 'handover', school: s, child: c, sessionId: out.sessionId });
      } else {
        remember((m) => ({ ...m, outcomes: { ...m.outcomes, [c.drawId]: { outcome: value, name: nameOf(c, lang) } } }));
      }
    } catch {
      setLoadFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const finished = () => {
    if (step.kind !== 'engine') return;
    const { child, sessionId } = step;
    remember((m) => ({ ...m, finished: { ...m.finished, [child.drawId]: sessionId } }));
    setStep({ kind: 'giveback', school: step.school, child, sessionId });
  };

  const back = () => {
    if (step.kind === 'list') setStep({ kind: 'schools' });
    else if (step.kind === 'handover' || step.kind === 'summary') setStep({ kind: 'list', school: step.school });
  };

  const children = list?.children ?? [];
  const doneKids = children.filter(isDone);
  const sync: SyncItem[] = doneKids.map((c) => ({ drawId: c.drawId, name: firstNameOf(c, lang), state: c.sessionStatus === 'completed' ? 'sent' : 'phone' }));
  const bar = (
    <AssessVisitBar copy={copy} done={doneKids.length} total={Math.max(LIST_SIZE, children.length)} startedAt={memory?.startedAt ?? null} sync={sync} />
  );

  const canGoBack = step.kind === 'list' || step.kind === 'handover' || step.kind === 'summary';
  const header = (
    <div className="flex items-center justify-between gap-2 mb-4">
      {canGoBack ? (
        <button type="button" onClick={back} className="flex min-h-[48px] items-center gap-1 text-slate-700">
          <ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden /> {copy.back}
        </button>
      ) : <span />}
      <h1 className="min-w-0 flex-1 text-center text-lg font-bold text-slate-900">{copy.title}</h1>
      <button type="button" onClick={switchLang} className="min-h-[48px] rounded-full border border-slate-300 px-3 text-sm">{copy.lang}</button>
    </div>
  );

  let content: JSX.Element;
  if (enabled === null) content = <p className="text-slate-600">{copy.loading}</p>;
  else if (enabled === false) content = <p className="text-slate-700">{copy.notAvailable}</p>;
  else if (loadFailed) {
    content = (
      <div className="space-y-3">
        <p className="text-slate-700">{copy.loadFailed}</p>
        <button type="button" onClick={() => { setLoadFailed(false); setStep({ ...step }); }} className="min-h-[48px] rounded-xl border px-4 flex items-center gap-2">
          <RefreshCw className="h-4 w-4" aria-hidden /> {copy.tryAgain}
        </button>
      </div>
    );
  } else if (step.kind === 'schools') {
    content = schools === null ? <p className="text-slate-600">{copy.loading}</p>
      : schools.length === 0 ? <p className="text-slate-700">{copy.noSchools}</p>
        : (
          <div className="space-y-3">
            <h2 className="font-semibold text-slate-800">{copy.chooseSchool}</h2>
            {schools.map((s) => (
              <button key={s.schoolId} type="button" data-testid={`assess-school-${s.schoolId}`} onClick={() => pickSchool(s)}
                className={`w-full min-h-[56px] rounded-2xl border p-4 text-start flex items-center justify-between gap-2 ${s.visitToday ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-900 break-words">{s.name || '—'}</span>
                  {s.visitToday && <span className="mt-1 inline-block rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">{copy.todaysVisit}</span>}
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-400 rtl:rotate-180" aria-hidden />
              </button>
            ))}
          </div>
        );
  } else if (step.kind === 'list') {
    const message = problem === 'no_class_list' ? copy.noClassList : problem === 'frame_exhausted' ? copy.frameExhausted : problem === 'not_found' ? copy.notFound : null;
    content = message ? <p className="text-slate-700">{message}</p>
      : !list ? <p className="text-slate-600">{copy.loading}</p>
        : (
          <div className="space-y-4">
            {bar}
            {offline && (
              <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <WifiOff className="h-4 w-4 shrink-0" aria-hidden /> {copy.offline}
              </p>
            )}
            <div>
              <h2 className="text-lg font-semibold text-slate-900 break-words">{step.school.name}</h2>
              <p className="text-slate-700">{copy.grade(list.grade)}</p>
              {list.gradeFallback && <p className="text-xs text-slate-500">{copy.gradeFallback}</p>}
              <p className="text-sm text-slate-600">{copy.listNote}</p>
            </div>
            <ol className="space-y-3">
              {children.map((c, i) => {
                const done = isDone(c);
                const open = !done && c.sessionId;
                const waiting = !done && !c.sessionId && (c.status === 'listed' || c.status === 'pending');
                const marked = c.status === 'absent' || c.status === 'absent_final' ? copy.summaryAbsent : c.status === 'refused' ? copy.summaryRefused : null;
                return (
                  <li key={c.drawId} data-testid={`assess-child-${c.drawId}`} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="flex items-start gap-3">
                      <span className="h-8 w-8 shrink-0 rounded-full bg-slate-100 flex items-center justify-center font-semibold">{i + 1}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-semibold text-slate-900 break-words">{nameOf(c, lang)}</span>
                        <span className="block text-sm text-slate-600 break-words">{placeOf(c, lang)}</span>
                      </span>
                      {done && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">{copy.done}</span>}
                      {open && <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800">{copy.started}</span>}
                      {!done && !open && !waiting && marked && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{marked}</span>}
                    </div>
                    {waiting && (
                      <div className="mt-3 space-y-2">
                        <button type="button" disabled={busy} onClick={() => outcome(c, 'present')} className="w-full min-h-[52px] rounded-xl bg-emerald-600 text-lg font-semibold text-white disabled:opacity-60">{copy.present}</button>
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" disabled={busy} onClick={() => outcome(c, 'absent')} className="min-h-[48px] rounded-xl border border-slate-300 bg-white disabled:opacity-60">{copy.absent}</button>
                          <button type="button" disabled={busy} onClick={() => outcome(c, 'refused')} className="min-h-[48px] rounded-xl border border-slate-300 bg-white disabled:opacity-60">{copy.refused}</button>
                        </div>
                      </div>
                    )}
                    {open && c.sessionId && (
                      <button type="button" onClick={() => setStep({ kind: 'handover', school: step.school, child: c, sessionId: c.sessionId as string })}
                        className="mt-3 w-full min-h-[48px] rounded-xl border border-slate-300 bg-white">{copy.continue}</button>
                    )}
                  </li>
                );
              })}
            </ol>
            {list.alternates.length > 0 && (
              <div data-testid="assess-alternates" className="space-y-1 text-sm text-slate-600">
                <p className="font-medium">{copy.alternates}</p>
                <ul className="space-y-1">
                  {list.alternates.map((a) => (
                    <li key={a.drawId} className="break-words">{nameOf(a, lang)}{placeOf(a, lang) ? ` · ${placeOf(a, lang)}` : ''}</li>
                  ))}
                </ul>
              </div>
            )}
            <button type="button" onClick={() => setStep({ kind: 'summary', school: step.school })}
              className="w-full min-h-[48px] rounded-xl border border-slate-300 bg-white font-medium">{copy.endVisit}</button>
          </div>
        );
  } else if (step.kind === 'handover') {
    content = (
      <div className="space-y-6">
        {bar}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
          <Headphones className="mx-auto h-12 w-12 text-slate-500" aria-hidden />
          <p className="mt-4 text-2xl font-bold leading-relaxed text-slate-900">{copy.handover(firstNameOf(step.child, lang))}</p>
        </div>
        <button type="button" onClick={() => setStep({ ...step, kind: 'engine' })}
          className="w-full min-h-[64px] rounded-2xl bg-emerald-600 text-2xl font-semibold text-white">{copy.start}</button>
      </div>
    );
  } else if (step.kind === 'engine') {
    content = <AssessEngineSlot sessionId={step.sessionId} firstName={firstNameOf(step.child, lang)} lang={lang} onFinished={finished} />;
  } else if (step.kind === 'giveback') {
    content = (
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
          <Smartphone className="mx-auto h-12 w-12 text-slate-500" aria-hidden />
          <p className="mt-4 text-2xl font-bold leading-relaxed text-slate-900">{copy.giveBack}</p>
        </div>
        <button type="button" onClick={() => setStep({ kind: 'list', school: step.school })}
          className="w-full min-h-[56px] rounded-2xl bg-emerald-600 text-xl font-semibold text-white">{copy.backToList}</button>
      </div>
    );
  } else {
    const outcomes = Object.values(memory?.outcomes ?? {});
    const names = (xs: string[]) => (xs.length ? xs.join(' · ') : copy.none);
    const started = memory?.startedAt ?? null;
    const notSent = doneKids.filter((c) => c.sessionStatus !== 'completed').length;
    content = (
      <div data-testid="assess-summary" className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">{copy.summaryTitle} · {step.school.name}</h2>
        <dl className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div data-testid="summary-done"><dt className="text-sm text-slate-500">{copy.summaryDone}</dt><dd className="break-words">{names(doneKids.map((c) => nameOf(c, lang)))}</dd></div>
          <div data-testid="summary-absent"><dt className="text-sm text-slate-500">{copy.summaryAbsent}</dt><dd className="break-words">{names(outcomes.filter((o) => o.outcome === 'absent').map((o) => o.name))}</dd></div>
          <div data-testid="summary-refused"><dt className="text-sm text-slate-500">{copy.summaryRefused}</dt><dd className="break-words">{names(outcomes.filter((o) => o.outcome === 'refused').map((o) => o.name))}</dd></div>
        </dl>
        <p className="text-slate-800">{copy.totalTime(mmss(started === null ? 0 : Date.now() - started))}</p>
        <p className="text-slate-800">{copy.notSentYet(notSent)}</p>
        <button type="button" onClick={() => setStep({ kind: 'schools' })}
          className="w-full min-h-[56px] rounded-2xl bg-emerald-600 text-xl font-semibold text-white">{copy.finish}</button>
      </div>
    );
  }

  const inTest = step.kind === 'engine' || step.kind === 'giveback';
  return (
    <PortalLayout bare={inTest}>
      <div className="max-w-md mx-auto overflow-x-hidden" dir={lang === 'ur' ? 'rtl' : 'ltr'} lang={lang}>
        {!inTest && header}
        {content}
        {step.kind === 'schools' && enabled === true && (
          <Link to="/portal/leader" className="mt-6 block py-3 text-center text-sm text-slate-500">{copy.back}</Link>
        )}
      </div>
    </PortalLayout>
  );
}
