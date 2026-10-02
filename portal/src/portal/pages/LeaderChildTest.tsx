import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, CloudUpload, Loader2, RefreshCw, UserCheck } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import BlockRecorder from '../components/childTest/BlockRecorder';
import CheckForm from '../components/childTest/CheckForm';
import { childTest } from '../services/api';
import { useChildTest } from '../lib/useChildTest';
import { canRecordHere } from '../lib/recordingSupport';
import { flushPending } from '../lib/childTest/uploader';
import { listPending } from '../lib/childTest/recordings';
import { COPY, type Lang } from '../lib/childTest/copy';
import type {
  ChildTestBlockName, ChildTestCard, ChildTestChild, ChildTestList, ChildTestSession, ChildTestVisit,
} from '../types/childTest';

/**
 * bd-s1oo0.7 — the child test in the coach app (/portal/leader/child-test).
 *
 * WhatsApp cannot show a child an opened card while a voice note records; this
 * page can. After the observation, Rumi's server-drawn list of five children
 * (no redraws), then per child: present / absent / refused, the Urdu, English
 * and maths blocks — each one screen with the card in large print, a 60-second
 * countdown with a tone, and the recorder — the maths strip photo, and the same
 * check as the WhatsApp Flow as a form.
 *
 * Recordings stay on the phone until they have reached R2 and the bot; the list
 * shows anything still waiting and sends it. Coach copy is Urdu first, with a
 * switch to English. The child's name is shown here only.
 */

const BLOCKS: ChildTestBlockName[] = ['urdu', 'english', 'maths'];
const LANG_KEY = 'niete-child-test-lang';

type Step =
  | { kind: 'visits' }
  | { kind: 'list'; visitId: string }
  | { kind: 'child'; visitId: string; child: ChildTestChild }
  | { kind: 'block'; visitId: string; child: ChildTestChild; sessionId: string; index: number }
  | { kind: 'check'; visitId: string; child: ChildTestChild; sessionId: string };

function readLang(): Lang {
  try { return window.localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ur'; } catch { return 'ur'; }
}

function timeOf(iso: string) {
  try { return new Date(iso).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' }); } catch { return ''; }
}

function reasonOf(err: unknown): string | null {
  const r = (err as { response?: { data?: { reason?: string }; status?: number } })?.response;
  return r?.data?.reason || null;
}

export default function LeaderChildTest() {
  const enabled = useChildTest();
  const [lang, setLang] = useState<Lang>(readLang);
  const copy = COPY[lang];
  const [canRecord, setCanRecord] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'visits' });
  const [visits, setVisits] = useState<ChildTestVisit[] | null>(null);
  const [list, setList] = useState<ChildTestList | null>(null);
  const [listProblem, setListProblem] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [cards, setCards] = useState<Record<string, ChildTestCard>>({});
  const [session, setSession] = useState<ChildTestSession | null>(null);

  useEffect(() => { void canRecordHere().then(setCanRecord).catch(() => setCanRecord(false)); }, []);

  const switchLang = () => {
    const next: Lang = lang === 'ur' ? 'en' : 'ur';
    setLang(next);
    try { window.localStorage.setItem(LANG_KEY, next); } catch { /* per-device convenience only */ }
  };

  const refreshPending = useCallback(async () => {
    try { setPendingCount((await listPending()).length); } catch { setPendingCount(0); }
  }, []);

  const sendWaiting = useCallback(async () => {
    setBusy(true);
    try { await flushPending(childTest); } finally { setBusy(false); void refreshPending(); }
  }, [refreshPending]);

  // visits
  useEffect(() => {
    if (enabled !== true || step.kind !== 'visits') return;
    let live = true;
    setLoadFailed(false);
    childTest.getVisits()
      .then(({ visits: v }) => {
        if (!live) return;
        setVisits(v);
        if (v.length === 1) setStep({ kind: 'list', visitId: v[0].visitId });
      })
      .catch(() => { if (live) setLoadFailed(true); });
    void refreshPending();
    return () => { live = false; };
  }, [enabled, step.kind, refreshPending]);

  // the list
  const loadList = useCallback(async (visitId: string) => {
    setLoadFailed(false);
    setListProblem(null);
    try {
      const out = await childTest.getList(visitId);
      setList(out.list);
    } catch (err) {
      const reason = reasonOf(err);
      if (reason === 'no_class_list' || reason === 'frame_exhausted') setListProblem(reason);
      else setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    if (step.kind === 'list') { void loadList(step.visitId); void refreshPending(); }
  }, [step, loadList, refreshPending]);

  // cards for the child being tested
  const sessionId = step.kind === 'block' || step.kind === 'check' ? step.sessionId : null;
  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    Promise.all(BLOCKS.map((b) => childTest.getCard(sessionId, b).then((r) => [b, r.card] as const)))
      .then((pairs) => { if (live) setCards(Object.fromEntries(pairs)); })
      .catch(() => { if (live) setLoadFailed(true); });
    return () => { live = false; };
  }, [sessionId]);

  // the check: poll until every block has marks (or failed)
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (step.kind !== 'check') return undefined;
    let live = true;
    const load = async () => {
      try {
        const s = await childTest.getSession(step.sessionId);
        if (!live) return;
        setSession(s);
        const waiting = s.blocks.some((b) => !b.checked && b.aiStatus !== 'scored' && b.aiStatus !== 'partial' && b.aiStatus !== 'failed');
        if (waiting) pollRef.current = window.setTimeout(load, 5000);
      } catch {
        if (live) pollRef.current = window.setTimeout(load, 8000);
      }
    };
    void load();
    return () => { live = false; if (pollRef.current) window.clearTimeout(pollRef.current); };
  }, [step]);

  const outcome = async (child: ChildTestChild, value: 'present' | 'absent' | 'refused') => {
    if (step.kind !== 'child') return;
    setBusy(true);
    try {
      const out = await childTest.markOutcome({ visitId: step.visitId, drawId: child.drawId, outcome: value });
      if (out.list) setList(out.list);
      if (value === 'present' && out.sessionId) {
        setStep({ kind: 'block', visitId: step.visitId, child, sessionId: out.sessionId, index: 0 });
      } else {
        setStep({ kind: 'list', visitId: step.visitId });
      }
    } catch {
      setLoadFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const openChild = (child: ChildTestChild) => {
    if (step.kind !== 'list') return;
    if (child.sessionId) setStep({ kind: 'check', visitId: step.visitId, child, sessionId: child.sessionId });
    else if (child.status === 'listed' || child.status === 'pending') setStep({ kind: 'child', visitId: step.visitId, child });
  };

  const back = () => {
    if (step.kind === 'list') setStep({ kind: 'visits' });
    else if (step.kind !== 'visits') setStep({ kind: 'list', visitId: step.visitId });
  };

  const recording = step.kind === 'block';
  const header = (
    <div className="flex items-center justify-between gap-2 mb-4">
      {step.kind !== 'visits' ? (
        <button type="button" onClick={back} className="flex items-center gap-1 text-slate-700 py-2">
          <ChevronLeft className="h-5 w-5" aria-hidden /> {copy.back}
        </button>
      ) : <span />}
      <h1 className="text-xl font-bold text-slate-900">{copy.title}</h1>
      <button type="button" onClick={switchLang} className="rounded-full border border-slate-300 px-3 py-1 text-sm">{copy.lang}</button>
    </div>
  );

  const body = useMemo(() => {
    if (enabled === null || canRecord === null) return <p className="text-slate-600">{copy.loading}</p>;
    if (enabled === false) return <p className="text-slate-700">{copy.notAvailable}</p>;
    if (canRecord === false) return <p className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-amber-900">{copy.noRecorder}</p>;
    if (loadFailed) {
      return (
        <div className="space-y-3">
          <p className="text-slate-700">{copy.loadFailed}</p>
          <button type="button" onClick={() => { setLoadFailed(false); setStep({ ...step }); }} className="rounded-xl border px-4 py-2 flex items-center gap-2">
            <RefreshCw className="h-4 w-4" aria-hidden /> {copy.tryAgain}
          </button>
        </div>
      );
    }
    return null;
  }, [enabled, canRecord, loadFailed, copy, step]);

  let content: JSX.Element | null = body;
  if (!content) {
    if (step.kind === 'visits') {
      content = visits === null ? <p className="text-slate-600">{copy.loading}</p>
        : visits.length === 0 ? <p className="text-slate-700">{copy.noVisit}</p>
          : (
            <div className="space-y-3">
              <h2 className="font-semibold text-slate-800">{copy.chooseVisit}</h2>
              {visits.map((v) => (
                <button key={v.visitId} type="button" onClick={() => setStep({ kind: 'list', visitId: v.visitId })}
                  className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-start flex items-center justify-between">
                  <span>
                    <span className="block font-semibold text-slate-900">{v.schoolName || '—'}</span>
                    <span className="block text-sm text-slate-600">{copy.visitAt(timeOf(v.startedAt))}</span>
                  </span>
                  <ChevronRight className="h-5 w-5 text-slate-400 rtl:rotate-180" aria-hidden />
                </button>
              ))}
            </div>
          );
    } else if (step.kind === 'list') {
      content = listProblem ? <p className="text-slate-700">{listProblem === 'no_class_list' ? copy.noClassList : copy.frameExhausted}</p>
        : !list ? <p className="text-slate-600">{copy.loading}</p>
          : (
            <div className="space-y-4">
              {pendingCount > 0 && (
                <div className="flex items-center justify-between rounded-xl bg-amber-50 border border-amber-200 p-3">
                  <span className="flex items-center gap-2 text-amber-900"><CloudUpload className="h-5 w-5" aria-hidden /> {copy.unsent(pendingCount)}</span>
                  <button type="button" onClick={sendWaiting} disabled={busy} className="rounded-lg bg-amber-600 text-white px-3 py-1">{copy.sendNow}</button>
                </div>
              )}
              <div>
                <h2 className="font-semibold text-slate-900 text-lg">{copy.todaysChildren} · {copy.grade(list.grade)}</h2>
                <p className="text-sm text-slate-600">{copy.listNote}</p>
              </div>
              <ol className="space-y-2">
                {list.children.map((c, i) => (
                  <li key={c.drawId}>
                    <button type="button" onClick={() => openChild(c)} data-testid={`child-${c.drawId}`}
                      className="w-full rounded-2xl border border-slate-200 bg-white p-4 flex items-center gap-3 text-start">
                      <span className="h-9 w-9 shrink-0 rounded-full bg-slate-100 flex items-center justify-center font-semibold">{i + 1}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-semibold text-slate-900 truncate">{c.displayName}</span>
                        <span className="block text-sm text-slate-600">
                          {c.rollNumber ? copy.roll(c.rollNumber) : ''}{c.section ? ` · ${c.section}` : ''}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1 text-xs">
                        <span className={`rounded-full px-2 py-0.5 ${c.role === 'returning' ? 'bg-violet-100 text-violet-800' : 'bg-sky-100 text-sky-800'}`}>{copy.role[c.role]}</span>
                        <span className={`rounded-full px-2 py-0.5 ${c.sessionId || c.status === 'tested' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>
                          {c.sessionId && c.sessionStatus === 'completed' ? copy.allChecked : copy.status[c.status]}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              {list.alternates.length > 0 && (
                <div className="text-sm text-slate-600">
                  <p>{copy.alternates}</p>
                  <p>{list.alternates.map((a) => (a.rollNumber ? copy.roll(a.rollNumber) : a.displayName)).join(' · ')}</p>
                </div>
              )}
            </div>
          );
    } else if (step.kind === 'child') {
      const c = step.child;
      content = (
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
            <UserCheck className="h-10 w-10 mx-auto text-slate-500" aria-hidden />
            <p className="mt-2 text-2xl font-bold text-slate-900">{c.displayName}</p>
            {c.rollNumber && <p className="text-slate-600">{copy.roll(c.rollNumber)}</p>}
          </div>
          <p className="text-lg text-slate-800 text-center">{copy.isHere}</p>
          <button type="button" disabled={busy} onClick={() => outcome(c, 'present')} className="w-full rounded-2xl py-5 text-2xl font-semibold bg-emerald-600 text-white">{copy.present}</button>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" disabled={busy} onClick={() => outcome(c, 'absent')} className="rounded-xl py-3 text-lg border border-slate-300 bg-white">{copy.absent}</button>
            <button type="button" disabled={busy} onClick={() => outcome(c, 'refused')} className="rounded-xl py-3 text-lg border border-slate-300 bg-white">{copy.refused}</button>
          </div>
        </div>
      );
    } else if (step.kind === 'block') {
      const block = BLOCKS[step.index];
      const card = cards[block];
      content = (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600">{copy.step(step.index + 1, BLOCKS.length)}</span>
            <span className="font-semibold text-slate-900">{copy.blocks[block]}</span>
          </div>
          {!card ? <p className="text-slate-600">{copy.loading}</p> : (
            <BlockRecorder
              key={`${step.sessionId}-${block}`}
              card={card}
              sessionId={step.sessionId}
              copy={copy}
              onSent={() => {
                if (step.index + 1 < BLOCKS.length) setStep({ ...step, index: step.index + 1 });
                else setStep({ kind: 'check', visitId: step.visitId, child: step.child, sessionId: step.sessionId });
              }}
            />
          )}
        </div>
      );
    } else if (step.kind === 'check') {
      content = (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-slate-900">{copy.checkTitle} · {step.child.displayName}</h2>
          {!session ? <p className="text-slate-600">{copy.loading}</p> : session.blocks.map((b) => {
            const card = cards[b.block];
            return (
              <section key={b.block} className="space-y-3">
                <h3 className="font-semibold text-slate-800 border-b pb-1">{copy.blocks[b.block]}</h3>
                {b.checked ? <p className="text-emerald-700">{copy.saved}</p>
                  : !b.hasAudio ? <p className="text-slate-600">{copy.waitingMedia}</p>
                    : (b.aiStatus === 'scored' || b.aiStatus === 'partial' || b.aiStatus === 'failed') && card ? (
                      <CheckForm
                        card={card}
                        status={b}
                        copy={copy}
                        onSubmit={async (coachMarks) => {
                          await childTest.submitCheck(step.sessionId, { block: b.block, coachMarks });
                          setSession((s) => (s ? { ...s, blocks: s.blocks.map((x) => (x.block === b.block ? { ...x, checked: true } : x)) } : s));
                        }}
                      />
                    ) : <p className="flex items-center gap-2 text-slate-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {copy.marking}</p>}
              </section>
            );
          })}
          <button type="button" onClick={back} className="w-full rounded-xl py-3 text-lg border border-slate-300 bg-white">
            {session && session.blocks.every((b) => b.checked) ? copy.childDone : copy.checkLater}
          </button>
        </div>
      );
    }
  }

  return (
    <PortalLayout bare={recording}>
      <div className="max-w-md mx-auto" dir={lang === 'ur' ? 'rtl' : 'ltr'} lang={lang}>
        {header}
        {content}
        {step.kind === 'visits' && enabled === true && (
          <Link to="/portal/leader" className="mt-6 block text-center text-sm text-slate-500">{copy.back}</Link>
        )}
      </div>
    </PortalLayout>
  );
}
