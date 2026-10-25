import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Headphones, RefreshCw, Smartphone, WifiOff } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import AssessDrain, { type Drained } from '../components/assess/AssessDrain';
import AssessEngineSlot, { type FinishReason } from '../components/assess/AssessEngineSlot';
import AssessOtherPhone from '../components/assess/AssessOtherPhone';
import AssessPreflight from '../components/assess/AssessPreflight';
import AssessVisitBar, { type SyncItem } from '../components/assess/AssessVisitBar';
import AssessActions, { useAboveTabBar } from '../components/assess/AssessActions';
import { childTestSa } from '../services/api';
import { useChildTestSa } from '../lib/useChildTestSa';
import { COPY, urDigits, type Lang } from '../lib/assess/copy';
import { useUrFit } from '../lib/assess/urFit';
import { BLOCKS, isBlock, isRdf, pickBlock, type Block } from '../lib/assess/blocks';
import { useSaSwitches } from '../lib/assess/switches';
import { resultsPath } from '../lib/assess/results';
import { sendQueued } from '../lib/assess/outbox';
import {
  allVisitKeys, mintId, mmss, readVisit, saveMic, visitKey, writeVisit, VISIT_LIMIT_MS, type MicCheck, type QueuedOutcome, type VisitMemory,
} from '../lib/assess/visitStore';
import type { SaChild, SaList, SaOutcome, SaSchool } from '../types/childTestSa';

/**
 * The coach's Learning assessment (/portal/leader/assess), behind portal_child_test_sa.
 *
 * The coach picks the school (today's visit first), then works down Rumi's list of
 * five: Present / Absent / Refused. Present gives the child a session id minted on
 * the phone and a block (lib/assess/blocks); Start sends it and opens the engine in
 * a full-screen frame. When the engine hands the phone back, the page returns to the
 * list. Absent or refused: the server returns the list with the next alternate moved
 * up. A child is named by room and class teacher, never by roll number.
 *
 * The last list, the start time, the minted ids and what was finished here are kept
 * on the phone per visit (lib/assess/visitStore). An outcome that cannot reach the
 * server is queued there and sent, in order, on load, when the phone is back online
 * and every 30 s; meanwhile an absent child's place goes to the first alternate here.
 *
 * A pre-flight card (airplane mode, headphones, microphone) comes once per visit
 * before the list. Once the server has a child's session, the test can be opened
 * on another phone instead, by a QR link (components/assess/AssessOtherPhone).
 */

const LANG_KEY = 'niete-assess-lang';
const LIST_SIZE = 5;
const TICK_MS = 30_000;
const DRAIN_EVERY_MS = 30_000;
const TOAST_MS = 2500;
// a visit start older than twice the visit's 45 minutes belongs to an earlier sitting (sa_resume_repick)
const SITTING_MS = 2 * VISIT_LIMIT_MS;
const earlierSitting = (at: number) => Date.now() - at > SITTING_MS;
// sa_all_grades: the grades a coach may name for a school's list
const GRADE_CHOICES = [1, 2, 3, 4, 5];
const FULL_MINUTES = 29;
/** RDF per child (panel review of the RDF list: about 19 min, about 22 at a first sitting). */
const RDF_MINUTES = 20;
/** Urdu: the app's Nastaliq stack and line height (index.css keys them on html[lang=ur]; this page sets its own lang), and nothing below text-sm. */
const URDU_ROOT = '[font-family:var(--font-urdu)] [word-spacing:0.15em] [&_*]:leading-[2] [&_.text-xs]:text-sm';

type Step =
  | { kind: 'schools' }
  | { kind: 'grade'; school: SaSchool }
  | { kind: 'preflight'; school: SaSchool }
  | { kind: 'list'; school: SaSchool }
  | { kind: 'handover'; school: SaSchool; child: SaChild; sessionId: string; block: Block }
  | { kind: 'engine'; school: SaSchool; child: SaChild; sessionId: string; block: Block }
  | { kind: 'link'; school: SaSchool; child: SaChild; serverId: string; block: Block }
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
  const room = (lang === 'ur' && c.classLabelUr ? urDigits(c.classLabelUr) : c.classLabel) || '';
  const teacher = c.teacherName ? COPY[lang].teacher(c.teacherName) : '';
  return [room, teacher].filter(Boolean).join(' · ');
}

function errorOf(err: unknown): { reason: string | null; network: boolean } {
  const r = (err as { response?: { data?: { reason?: string } } })?.response;
  return { reason: r?.data?.reason || null, network: !r };
}

/** A school name for the filter: lower case, no accents or Urdu diacritics (sa_all_grades' "Find a school"). */
function plain(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f\u064B-\u065F\u0670]/g, '').toLowerCase().trim();
}

function todaysFirst(schools: SaSchool[]) {
  return [...schools].sort((a, b) => Number(b.visitToday) - Number(a.visitToday));
}

export default function LeaderAssess() {
  useUrFit();
  const enabled = useChildTestSa();
  const switches = useSaSwitches(enabled);
  const above = useAboveTabBar();
  const [lang, setLang] = useState<Lang>(readLang);
  const copy = COPY[lang];
  const [step, setStep] = useState<Step>({ kind: 'schools' });
  const [schools, setSchools] = useState<SaSchool[] | null>(null);
  const [schoolFilter, setSchoolFilter] = useState('');
  const [list, setList] = useState<SaList | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [offline, setOffline] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vkey, setVkey] = useState<string | null>(null);
  const [memory, setMemory] = useState<VisitMemory | null>(null);
  const [remote, setRemote] = useState<Record<string, 'sending' | 'audio' | 'sent'>>({});
  const [toast, setToast] = useState(false);
  const [stopped, setStopped] = useState<string | null>(null);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  /** The block the server gave instead of the coach's choice (a visit-mate holds it), shown before the second Start. */
  const [moved, setMoved] = useState<Block | null>(null);
  /** sa_add_child: the open "Add a child" form (null = closed) and its last refusal. */
  const [adding, setAdding] = useState<{ name: string; grade: number; section: string } | null>(null);
  const [addFailed, setAddFailed] = useState(false);
  const vkeyRef = useRef<string | null>(null);
  vkeyRef.current = vkey;
  const memoryRef = useRef<VisitMemory | null>(null);
  memoryRef.current = memory;

  const switchLang = () => {
    const next: Lang = lang === 'ur' ? 'en' : 'ur';
    setLang(next);
    try { window.localStorage.setItem(LANG_KEY, next); } catch { /* per-device convenience only */ }
  };

  /** Change what the phone keeps for a visit: through state for the open one, else in storage. */
  const updateVisit = useCallback((key: string, change: (m: VisitMemory) => VisitMemory) => {
    if (key !== vkeyRef.current) { writeVisit(key, change(readVisit(key))); return; }
    setMemory((m) => {
      const next = change(m ?? readVisit(key));
      writeVisit(key, next);
      return next;
    });
  }, []);

  const remember = useCallback((change: (m: VisitMemory) => VisitMemory) => {
    if (vkeyRef.current) updateVisit(vkeyRef.current, change);
  }, [updateVisit]);

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
      const out = s.grade ? await childTestSa.getList(s.schoolId, s.visitId, s.grade) : await childTestSa.getList(s.schoolId, s.visitId);
      setList(out.list);
      updateVisit(key, (m) => ({ ...m, list: out.list }));
    } catch (err) {
      const { reason, network } = errorOf(err);
      if (reason === 'no_class_list' || reason === 'frame_exhausted' || reason === 'not_found') { setProblem(reason); return; }
      const saved = readVisit(key).list;
      if (network && saved) { setList(saved); setOffline(true); } else setLoadFailed(true);
    }
  }, [updateVisit]);

  useEffect(() => {
    if (step.kind === 'list') void loadList(step.school, visitKey(step.school.schoolId, undefined, step.school.grade));
  }, [step, loadList]);

  // sa_all_grades: the school, then the grade; the grade rides on the school for every call of that list
  const pickSchool = (s: SaSchool) => {
    if (switches.allGrades && !s.grade) { setStep({ kind: 'grade', school: s }); return; }
    const key = visitKey(s.schoolId, undefined, s.grade);
    vkeyRef.current = key;
    setVkey(key);
    const m = readVisit(key);
    setMemory(m);
    setList(null);
    setStep({ kind: m.preflight ? 'list' : 'preflight', school: s });
  };

  const micChecked = (mic: MicCheck) => {
    saveMic(mic);
    remember((m) => ({ ...m, preflight: { at: m.preflight?.at ?? Date.now(), mic } }));
  };

  const preflightDone = () => {
    if (step.kind !== 'preflight') return;
    remember((m) => ({ ...m, preflight: { at: Date.now(), mic: m.preflight?.mic ?? null } }));
    setStep({ kind: 'list', school: step.school });
  };

  /** Record the server's id for the session minted here as `clientId`. */
  const keepServerId = useCallback((key: string, clientId: string, serverId: string) => {
    updateVisit(key, (m) => {
      const hit = Object.entries(m.sessions).find(([, x]) => x.id === clientId);
      if (!hit || hit[1].serverId === serverId) return m;
      return { ...m, sessions: { ...m.sessions, [hit[0]]: { ...hit[1], serverId } } };
    });
  }, [updateVisit]);

  // queued outcomes, oldest first; a visit stops at the first one that cannot go yet
  const flushing = useRef(false);
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      const keys = Array.from(new Set([...allVisitKeys(), ...(vkeyRef.current ? [vkeyRef.current] : [])]));
      for (const key of keys) {
        const queue = key === vkeyRef.current && memoryRef.current ? memoryRef.current.queue : readVisit(key).queue;
        for (const q of queue) {
          const r = await sendQueued(q);
          if (r.kind === 'retry') break;
          updateVisit(key, (m) => ({
            ...m,
            queue: m.queue.filter((x) => x.qid !== q.qid),
            refused: r.kind === 'refused' ? [...m.refused, { qid: q.qid, drawId: q.drawId, outcome: q.outcome, status: r.status, at: Date.now() }] : m.refused,
            list: r.kind === 'sent' && r.list ? r.list : m.list,
          }));
          if (r.kind === 'sent' && r.sessionId && q.clientSessionId) keepServerId(key, q.clientSessionId, r.sessionId);
          if (r.kind === 'sent' && r.list && key === vkeyRef.current) { setList(r.list); setOffline(false); }
        }
      }
    } finally {
      flushing.current = false;
    }
  }, [updateVisit, keepServerId]);

  const sentIds = Object.values(memory?.sessions ?? {}).filter((x) => x.sent).map((x) => x.id);
  const pollKey = sentIds.filter((id) => remote[id] !== 'sent').join(',');
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const poll = useCallback(async (ids: string[]) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    for (const id of ids) {
      try {
        const st = await childTestSa.getStatus(id);
        if (!live.current || !st?.session) continue;
        // answers in but a recording still on the phone: not sent yet, and the poll goes on
        const state = st.session.status !== 'completed' ? 'sending' : (st.audioWaiting?.length ? 'audio' : 'sent');
        setRemote((r) => (r[id] === state ? r : { ...r, [id]: state }));
        if (st.session.id && vkeyRef.current) keepServerId(vkeyRef.current, id, st.session.id);
      } catch { /* not there yet, or offline */ }
    }
  }, [keepServerId]);

  // A finished child whose rows are still on the phone: the engine's page is gone, so a hidden drain frame sends them.
  const [drainAt, setDrainAt] = useState<number | null>(null);
  const lastDrain = useRef(0);
  const drainNeeded = useRef(false);
  const maybeDrain = (now_ = false) => {
    if (!drainNeeded.current || drainAt !== null || step.kind === 'engine') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const now = Date.now();
    if (!now_ && now - lastDrain.current < DRAIN_EVERY_MS) return;
    lastDrain.current = now;
    setDrainAt(now);
  };
  const [pendingBy, setPendingBy] = useState<Record<string, number>>({});
  const drainDone = (sessions: Drained) => {
    if (sessions.length) setPendingBy((p) => ({ ...p, ...Object.fromEntries(sessions.map((x) => [x.s, x.pending])) }));
    setDrainAt(null);
    if (pollKey) void poll(pollKey.split(','));
  };

  const tick = useRef<() => void>(() => {});
  tick.current = () => {
    void flush();
    if (pollKey) void poll(pollKey.split(','));
    maybeDrain();
  };
  useEffect(() => {
    if (enabled !== true) return undefined;
    tick.current();
    const run = () => tick.current();
    window.addEventListener('online', run);
    const t = window.setInterval(run, TICK_MS);
    return () => { window.removeEventListener('online', run); window.clearInterval(t); };
  }, [enabled]);
  useEffect(() => {
    if (enabled === true && pollKey) void poll(pollKey.split(','));
  }, [enabled, pollKey, poll]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(false), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [toast]);

  const sessionOf = (c: SaChild) => memory?.sessions[c.drawId];
  // an absent or refused row the server keeps on the list is not one of the children to test
  const isMarkedOut = (c: SaChild) => c.status === 'absent' || c.status === 'absent_final' || c.status === 'refused';
  const serverIdOf = (c: SaChild) => sessionOf(c)?.serverId || c.sessionId || null;
  // a child the coach ended early is not done; the summary lists them as started and not finished
  const isStopped = (c: SaChild) => Boolean(memory?.stopped?.[c.drawId]);
  const isDone = (c: SaChild) => {
    const id = sessionOf(c)?.id;
    if (isStopped(c)) return false;
    return c.sessionStatus === 'completed' || Boolean(memory?.finished[c.drawId]) || (id !== undefined && remote[id] === 'sent');
  };

  /**
   * Blocks other children of this visit already have (absent or refused ones excluded): this phone's own, then
   * the server's for children this phone has no record of (a reload or another browser mid-visit).
   */
  const usedBlocks = (drawId: string) => {
    const mine = Object.entries(memory?.sessions ?? {})
      .filter(([d]) => d !== drawId && !memory?.outcomes[d])
      .map(([, x]) => x.block as string);
    const theirs = [...(list?.children ?? []), ...(list?.alternates ?? [])]
      .filter((c) => c.drawId !== drawId && c.sessionBlock && !memory?.sessions[c.drawId] && !memory?.outcomes[c.drawId] && !isMarkedOut(c))
      .map((c) => c.sessionBlock as string);
    return [...mine, ...theirs];
  };

  const queue = (item: Omit<QueuedOutcome, 'qid' | 'at'>) => {
    remember((m) => ({ ...m, queue: [...m.queue, { ...item, qid: mintId(), at: Date.now() }] }));
  };

  const present = (c: SaChild) => {
    if (step.kind !== 'list') return;
    // with sa_mic_required, a coach who went on without a microphone sees it on the child's row
    const noMic = switches.micRequired && memory?.preflight?.mic?.mic_ok === false;
    // sa_resume_repick: a child the server already has a session for opens on that session's part
    const first = switches.resumeRepick && c.sessionId && isBlock(c.sessionBlock) ? c.sessionBlock : pickBlock(usedBlocks(c.drawId));
    const sess = sessionOf(c) ?? { id: mintId(), block: first, sent: Boolean(c.sessionId), ...(noMic ? { noMic: true } : {}) };
    remember((m) => ({ ...m, sessions: { ...m.sessions, [c.drawId]: sess } }));
    setMoved(null);
    setStep({ kind: 'handover', school: step.school, child: c, sessionId: sess.id, block: sess.block });
  };

  /** The coach's choice on the hand-over card; null = back to the rotation's block. */
  const chooseBlock = (choice: Block | null) => {
    if (step.kind !== 'handover') return;
    const block = choice ?? pickBlock(usedBlocks(step.child.drawId));
    const drawId = step.child.drawId;
    remember((m) => ({ ...m, sessions: { ...m.sessions, [drawId]: { ...m.sessions[drawId], id: step.sessionId, block, sent: Boolean(m.sessions[drawId]?.sent) } } }));
    setStep({ ...step, block });
  };

  /** Send Present for the handover's child, once. False: the server turned it down. */
  const sendPresent = async (): Promise<{ ok: boolean; serverId: string | null; queued: boolean; block: Block }> => {
    if (step.kind !== 'handover') return { ok: false, serverId: null, queued: false, block: 'full' };
    const { school, child, sessionId } = step;
    let { block } = step;
    if (!memory?.startedAt || (switches.resumeRepick && earlierSitting(memory.startedAt))) {
      remember((m) => ({ ...m, startedAt: m.startedAt && !(switches.resumeRepick && earlierSitting(m.startedAt)) ? m.startedAt : Date.now() }));
    }
    const had = sessionOf(child);
    // sa_resume_repick: a resumed child's Present goes again, with the part the coach chose on the card
    const repick = switches.resumeRepick && Boolean(had?.sent);
    if (had?.sent && !repick) return { ok: true, serverId: had.serverId || child.sessionId || null, queued: false, block: had.block };
    const args = { schoolId: school.schoolId, visitId: school.visitId, drawId: child.drawId, outcome: 'present' as const, clientSessionId: sessionId, block, ...(repick ? { repick: true } : {}), ...(school.grade ? { grade: school.grade } : {}) };
    let serverId: string | null = null;
    let queued = false;
    setBusy(true);
    try {
      const out = await childTestSa.markOutcome(args);
      if (out?.list) keepList(out.list);
      serverId = out?.sessionId || null;
      // the server may give the child a block they have not taken yet; the answer names it
      if (isBlock(out?.block)) block = out.block;
      // not moved (a finished session, or the server's switch off): the session keeps the part it had
      else if (repick && isBlock(child.sessionBlock)) block = child.sessionBlock;
    } catch (err) {
      if (repick) { setBusy(false); setOffline(true); return { ok: false, serverId: null, queued: false, block }; }
      if (!errorOf(err).network) { setBusy(false); setLoadFailed(true); return { ok: false, serverId: null, queued: false, block }; }
      queue(args);
      queued = true;
    }
    remember((m) => ({ ...m, sessions: { ...m.sessions, [child.drawId]: { ...m.sessions[child.drawId], id: sessionId, block, sent: true, ...(serverId ? { serverId } : {}) } } }));
    setBusy(false);
    return { ok: true, serverId, queued, block };
  };

  const start = async () => {
    if (step.kind !== 'handover') return;
    const sent = await sendPresent();
    if (!sent.ok) return;
    // the coach chose; a block the server swapped is shown on the card before the child starts
    if (switches.coachPicksBlock && sent.block !== step.block) {
      setMoved(sent.block);
      setStep({ ...step, block: sent.block });
      return;
    }
    setStep({ ...step, kind: 'engine', block: sent.block });
  };

  /** From the handover: send Present if it has not gone, then show the link once the server has the session. */
  const otherPhone = async () => {
    if (step.kind !== 'handover') return;
    const { ok, serverId, queued, block } = await sendPresent();
    if (!ok) return;
    let id = serverId;
    if (!id && !queued) {
      try { id = (await childTestSa.getStatus(step.sessionId))?.session?.id || null; } catch { id = null; }
      if (id && vkeyRef.current) keepServerId(vkeyRef.current, step.sessionId, id);
    }
    if (id) setStep({ kind: 'link', school: step.school, child: step.child, serverId: id, block });
  };

  const linkDone = () => {
    if (step.kind !== 'link') return;
    const { child, serverId } = step;
    remember((m) => ({ ...m, elsewhere: { ...m.elsewhere, [child.drawId]: serverId } }));
    setStep({ kind: 'list', school: step.school });
  };

  const notPresent = async (c: SaChild, value: Exclude<SaOutcome, 'present'>) => {
    if (step.kind !== 'list') return;
    const s = step.school;
    setBusy(true);
    try {
      const out = await childTestSa.markOutcome({ schoolId: s.schoolId, visitId: s.visitId, drawId: c.drawId, outcome: value, ...(s.grade ? { grade: s.grade } : {}) });
      if (out?.list) keepList(out.list);
      remember((m) => ({ ...m, outcomes: { ...m.outcomes, [c.drawId]: { outcome: value, name: nameOf(c, lang) } } }));
    } catch (err) {
      if (!errorOf(err).network) { setLoadFailed(true); return; }
      queue({ schoolId: s.schoolId, visitId: s.visitId, drawId: c.drawId, outcome: value, ...(s.grade ? { grade: s.grade } : {}) });
      remember((m) => ({ ...m, outcomes: { ...m.outcomes, [c.drawId]: { outcome: value, name: nameOf(c, lang) } } }));
      if (list) {
        const [next, ...rest] = list.alternates;
        keepList({ ...list, children: [...list.children.filter((x) => x.drawId !== c.drawId), ...(next ? [next] : [])], alternates: rest });
      }
      setOffline(true);
    } finally {
      setBusy(false);
    }
  };

  /** sa_add_child: seat the typed child on the open list; the phone's id for the child makes a double tap one child. */
  const addChild = async () => {
    if (step.kind !== 'list' || !adding || !adding.name.trim() || busy) return;
    const s = step.school;
    setBusy(true);
    setAddFailed(false);
    try {
      const out = await childTestSa.addChild({
        schoolId: s.schoolId, visitId: s.visitId, grade: adding.grade, firstName: adding.name.trim(),
        section: adding.section.trim() || null, clientChildId: addingId.current, ...(s.grade ? { listGrade: s.grade } : {}),
      });
      if (out?.list) keepList(out.list);
      setAdding(null);
      addingId.current = mintId();
    } catch {
      setAddFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const addingId = useRef(mintId());

  const finished = (reason?: FinishReason) => {
    if (step.kind !== 'engine') return;
    const { child, sessionId } = step;
    // An unreadable frame is no proof the battery ended: the row stays open, the same session id reopens it.
    if (reason === 'offline') {
      setVoiceNote(null);
      setStopped(firstNameOf(child, lang));
      setStep({ kind: 'list', school: step.school });
      return;
    }
    setStopped(null);
    setVoiceNote(null);
    // refused before it began (voice not ready): not Stopped, the row stays open and Continue tries again
    if (reason === 'not_started') {
      setVoiceNote(firstNameOf(child, lang));
      setStep({ kind: 'list', school: step.school });
      return;
    }
    if (reason === 'coach_end') {
      remember((m) => ({ ...m, stopped: { ...(m.stopped ?? {}), [child.drawId]: sessionId } }));
      setStep({ kind: 'list', school: step.school });
      return;
    }
    remember((m) => ({ ...m, finished: { ...m.finished, [child.drawId]: sessionId } }));
    setStep({ kind: 'list', school: step.school });
    setToast(true);
  };

  const back = () => {
    if (step.kind === 'grade') setStep({ kind: 'schools' });
    else if (step.kind === 'list' || step.kind === 'preflight') setStep(step.school.grade ? { kind: 'grade', school: step.school } : { kind: 'schools' });
    else if (step.kind === 'handover' || step.kind === 'summary' || step.kind === 'link') setStep({ kind: 'list', school: step.school });
  };

  const children = list?.children ?? [];
  const doneKids = children.filter(isDone);
  // the visit's clock: this phone's first Start, or the visit's first session on the server when that is earlier
  const startedAt = [memory?.startedAt, ...children.map((c) => (c.sessionStartedAt ? Date.parse(c.sessionStartedAt) : NaN))]
    .filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
    // sa_resume_repick: a start from an earlier sitting (another morning, another host) is not this visit's time
    .filter((x) => !(switches.resumeRepick && earlierSitting(x)))
    .reduce<number | null>((a, x) => (a === null || x < a ? x : a), null);
  const syncOf = (c: SaChild): SyncItem['state'] => {
    const id = sessionOf(c)?.id;
    if (id && remote[id] === 'audio') return 'audio';
    if (c.sessionStatus === 'completed' || (id && remote[id] === 'sent')) return 'sent';
    if (memory?.queue.some((q) => q.drawId === c.drawId)) return 'phone';
    if (id && (pendingBy[id] ?? 0) > 0) return 'phone';
    return id && remote[id] === 'sending' ? 'sending' : 'phone';
  };
  const elsewhere = (c: SaChild) => !isDone(c) && Boolean(memory?.elsewhere[c.drawId]);
  const leftKids = [...doneKids, ...children.filter(isStopped)];
  drainNeeded.current = leftKids.some((c) => Boolean(sessionOf(c)) && syncOf(c) !== 'sent');
  const sync: SyncItem[] = [
    ...leftKids.map((c) => ({ drawId: c.drawId, name: firstNameOf(c, lang), state: syncOf(c) })),
    ...children.filter(elsewhere).map((c) => ({ drawId: c.drawId, name: firstNameOf(c, lang), state: 'other' as const })),
  ];
  const bar = (
    <AssessVisitBar copy={copy} done={doneKids.length} total={Math.max(LIST_SIZE, children.filter((c) => !isMarkedOut(c)).length)} startedAt={startedAt} sync={sync} />
  );

  const canGoBack = step.kind !== 'schools' && step.kind !== 'engine';
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

  /** "Open on another phone": needs the server's session, so it waits for a queued Present to reach it. */
  const otherPhoneButton = (c: SaChild, onClick: () => void, off: boolean) => {
    const local = sessionOf(c);
    const waiting = Boolean(local?.sent) && !serverIdOf(c);
    return (
      <div className="text-center">
        <button type="button" data-testid={`assess-other-${c.drawId}`} disabled={off || waiting} onClick={onClick}
          className="inline-flex min-h-[48px] items-center gap-2 px-3 text-sm font-medium text-sky-800 disabled:text-slate-400">
          <Smartphone className="h-4 w-4" aria-hidden /> {copy.openOther}
        </button>
        {waiting && <p className="text-xs text-slate-500">{copy.needsInternet}</p>}
      </div>
    );
  };

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
            {switches.allGrades && (
              <div className="space-y-1">
                <input type="search" data-testid="assess-school-filter" aria-label={copy.findSchool} placeholder={copy.findSchool}
                  value={schoolFilter} onChange={(e) => setSchoolFilter(e.target.value)}
                  className="w-full min-h-[56px] rounded-2xl border border-slate-300 bg-white px-4 text-base" />
                <p data-testid="assess-school-count" className="text-sm text-slate-600">
                  {copy.schoolCount(schools.filter((s) => plain(s.name || '').includes(plain(schoolFilter))).length, schools.length)}
                </p>
              </div>
            )}
            {schools.filter((s) => !switches.allGrades || s.visitToday || plain(s.name || '').includes(plain(schoolFilter))).map((s) => (
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
  } else if (step.kind === 'grade') {
    content = (
      <fieldset data-testid="assess-grade-choice" className="space-y-3">
        <legend className="font-semibold text-slate-800">{copy.whichGrade}</legend>
        <p className="break-words text-slate-700">{step.school.name || '—'}</p>
        {/* inline direction: the sheet's [dir="rtl"] .grid { direction: ltr } beats the dir attribute */}
        <div data-testid="assess-grade-row" dir={lang === 'ur' ? 'rtl' : 'ltr'} style={{ direction: lang === 'ur' ? 'rtl' : 'ltr' }} className="grid grid-cols-5 gap-2">
          {GRADE_CHOICES.map((g) => (
            <button key={g} type="button" onClick={() => pickSchool({ ...step.school, grade: g })}
              className="min-h-[56px] rounded-2xl border border-slate-200 bg-white px-1 text-sm font-semibold leading-tight text-slate-900">{copy.grade(g)}</button>
          ))}
        </div>
      </fieldset>
    );
  } else if (step.kind === 'preflight') {
    content = <AssessPreflight copy={copy} onMic={micChecked} onReady={preflightDone} micRequired={switches.micRequired} />;
  } else if (step.kind === 'link') {
    content = (
      <AssessOtherPhone copy={copy} serverId={step.serverId} childNo={step.child.childNo} lang={lang}
        grade={step.child.grade || list?.grade || 3} block={step.block} onDone={linkDone} />
    );
  } else if (step.kind === 'list') {
    const message = problem === 'no_class_list' ? copy.noClassList : problem === 'frame_exhausted' ? copy.frameExhausted : problem === 'not_found' ? copy.notFound : null;
    content = message ? <p className="text-slate-700">{message}</p>
      : !list ? <p className="text-slate-600">{copy.loading}</p>
        : (
          <div className="space-y-4">
            {bar}
            {stopped && (
              <p data-testid="assess-stopped" role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{copy.stopped(stopped)}</p>
            )}
            {voiceNote && (
              <p data-testid="assess-voice-not-ready" role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{copy.voiceNotReady(voiceNote)}</p>
            )}
            {offline && (
              <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <WifiOff className="h-4 w-4 shrink-0" aria-hidden /> {copy.offline}
              </p>
            )}
            <div>
              <div className="flex items-center justify-between gap-2">
                <h2 className="min-w-0 text-lg font-semibold text-slate-900 break-words">{step.school.name}</h2>
                <button type="button" data-testid="assess-check-again" onClick={() => setStep({ kind: 'preflight', school: step.school })}
                  className="min-h-[48px] shrink-0 px-2 text-sm text-sky-800 underline">{copy.checkAgain}</button>
              </div>
              <p className="text-slate-700">{copy.grade(list.grade)}</p>
              {list.gradeFallback && <p className="text-xs text-slate-500">{copy.gradeFallback}</p>}
              <p className="text-sm text-slate-600">{copy.listNote}</p>
            </div>
            <ol className="space-y-3">
              {children.map((c, i) => {
                const done = isDone(c);
                const local = sessionOf(c);
                const halted = isStopped(c);
                const open = !done && !halted && (c.sessionId || local?.sent) ? true : false;
                const waiting = !done && !open && !halted && (c.status === 'listed' || c.status === 'pending');
                const marked = c.status === 'absent' || c.status === 'absent_final' ? copy.summaryAbsent : c.status === 'refused' ? copy.summaryRefused : null;
                return (
                  <li key={c.drawId} data-testid={`assess-child-${c.drawId}`} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="flex items-start gap-3">
                      <span className="h-8 w-8 shrink-0 rounded-full bg-slate-100 flex items-center justify-center font-semibold">{switches.addChild && c.childNo ? c.childNo : i + 1}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-semibold text-slate-900 break-words">{nameOf(c, lang)}</span>
                        <span className="block text-sm text-slate-600 break-words">{placeOf(c, lang)}</span>
                        {(local || done || open || halted || (!waiting && marked)) && (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {done && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">{copy.done}</span>}
                            {halted && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{copy.stoppedBadge}</span>}
                            {open && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800">{elsewhere(c) ? copy.onOtherPhone : copy.started}</span>}
                            {!done && !open && !waiting && marked && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{marked}</span>}
                            {local?.noMic && <span data-testid={`assess-nomic-${c.drawId}`} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{copy.noMic}</span>}
                            {local && <span data-testid={`assess-block-${c.drawId}`} className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-800">{copy.blocks[local.block]}</span>}
                          </span>
                        )}
                      </span>
                    </div>
                    {done && switches.resultsView && serverIdOf(c) && (
                      <Link to={resultsPath(serverIdOf(c) as string)} data-testid={`assess-results-${c.drawId}`}
                        className="mt-2 inline-flex min-h-[48px] items-center gap-1 px-1 text-sm font-medium text-sky-800 underline">
                        {copy.results.title} <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                      </Link>
                    )}
                    {waiting && (
                      <div className="mt-3 space-y-2">
                        <button type="button" disabled={busy} onClick={() => present(c)} className="w-full min-h-[52px] rounded-xl bg-emerald-600 text-lg font-semibold text-white disabled:opacity-60">{copy.present}</button>
                        <div className="flex gap-2">
                          <button type="button" disabled={busy} onClick={() => notPresent(c, 'absent')} className="min-h-[48px] flex-1 rounded-xl border border-slate-300 bg-white disabled:opacity-60">{copy.absent}</button>
                          <button type="button" disabled={busy} onClick={() => notPresent(c, 'refused')} className="min-h-[48px] flex-1 rounded-xl border border-slate-300 bg-white disabled:opacity-60">{copy.refused}</button>
                        </div>
                      </div>
                    )}
                    {open && (
                      <div className="mt-3 space-y-1">
                        <button type="button" onClick={() => present(c)}
                          className="w-full min-h-[48px] rounded-xl border border-slate-300 bg-white">{copy.continue}</button>
                        {otherPhoneButton(c, () => {
                          const id = serverIdOf(c);
                          if (id && local) setStep({ kind: 'link', school: step.school, child: c, serverId: id, block: local.block });
                        }, !local)}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            {list.alternates.length === 0 && (
              <p data-testid="assess-no-alternates" className="text-sm text-slate-600">{copy.noAlternates}</p>
            )}
            {list.alternates.length > 0 && (
              <div data-testid="assess-alternates" className="space-y-1 text-sm text-slate-600">
                <p className="font-medium">{copy.alternates}</p>
                <ul className="space-y-1">
                  {list.alternates.map((a) => (
                    <li key={a.drawId} className="break-words">
                      <span className="block">{nameOf(a, lang)}</span>
                      {placeOf(a, lang) && <span data-testid="assess-alternate-place" className="block text-xs">{placeOf(a, lang)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {switches.addChild && !adding && (
              <button type="button" data-testid="assess-add-child" onClick={() => { setAddFailed(false); setAdding({ name: '', grade: step.school.grade || list.grade || 3, section: '' }); }}
                className="w-full min-h-[48px] rounded-xl border border-slate-300 bg-white font-medium">{copy.addChild}</button>
            )}
            {switches.addChild && adding && (
              <form data-testid="assess-add-child-form" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"
                onSubmit={(e) => { e.preventDefault(); void addChild(); }}>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-800">{copy.firstName}</span>
                  <input type="text" maxLength={40} autoComplete="off" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })}
                    className="min-h-[48px] w-full rounded-xl border border-slate-300 px-3" />
                </label>
                <div className="flex gap-2">
                  <label className="block flex-1">
                    <span className="mb-1 block text-sm font-medium text-slate-800">{copy.gradeLabel}</span>
                    <select value={adding.grade} onChange={(e) => setAdding({ ...adding, grade: Number(e.target.value) })}
                      className="min-h-[48px] w-full rounded-xl border border-slate-300 bg-white px-3">
                      {(switches.allGrades ? GRADE_CHOICES : [3, 5]).map((g) => <option key={g} value={g}>{copy.grade(g)}</option>)}
                    </select>
                  </label>
                  <label className="block flex-1">
                    <span className="mb-1 block text-sm font-medium text-slate-800">{copy.sectionOptional}</span>
                    <input type="text" maxLength={2} autoComplete="off" value={adding.section} onChange={(e) => setAdding({ ...adding, section: e.target.value })}
                      className="min-h-[48px] w-full rounded-xl border border-slate-300 px-3" />
                  </label>
                </div>
                {addFailed && <p role="alert" className="text-sm text-amber-900">{copy.addFailed}</p>}
                <div className="flex gap-2">
                  <button type="submit" disabled={busy} className="min-h-[48px] flex-1 rounded-xl bg-emerald-600 font-semibold text-white disabled:opacity-60">{copy.addToList}</button>
                  <button type="button" onClick={() => setAdding(null)} className="min-h-[48px] rounded-xl border border-slate-300 bg-white px-4">{copy.cancel}</button>
                </div>
              </form>
            )}
            <button type="button" data-testid="assess-end-visit" onClick={() => { setStep({ kind: 'summary', school: step.school }); maybeDrain(true); }}
              className="w-full min-h-[48px] rounded-xl border border-slate-300 bg-white font-medium">{copy.endVisit}</button>
          </div>
        );
  } else if (step.kind === 'handover') {
    // sent: the part is the server's; sa_resume_repick lets the coach choose again (Start re-sends Present)
    const locked = Boolean(sessionOf(step.child)?.sent) && !switches.resumeRepick;
    const others = usedBlocks(step.child.drawId);
    const held = new Set(others.filter((b) => (BLOCKS as readonly string[]).includes(b)));
    const suggested = pickBlock(others);
    const rdfOthers = others.filter((b) => isRdf(b)).length;
    // RDF is mostly recorded: it never starts without a microphone that passed this visit's check
    const micOk = memory?.preflight?.mic?.mic_ok === true;
    // sa_rdf_w3_forms: RDF auto (Jugnu instructs) and RDF manual (the coach instructs) in place of the one RDF
    const rdfBlocks: Block[] = switches.rdfW3Forms ? ['rdf_auto', 'rdf_manual'] : switches.rdfForm ? ['rdf'] : [];
    const choices: Block[] = [...BLOCKS, 'full', ...rdfBlocks];
    content = (
      <div data-testid="assess-handover" className="space-y-5">
        {bar}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
          <Headphones className="mx-auto h-12 w-12 text-slate-500" aria-hidden />
          <p className="mt-4 text-2xl font-bold leading-relaxed text-slate-900">{copy.handover(firstNameOf(step.child, lang))}</p>
          <p data-testid="assess-handover-block" className="mt-3 inline-block rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-800">{copy.blocks[step.block]}</p>
        </div>
        {switches.coachPicksBlock ? (
          <fieldset data-testid="assess-block-choice" className="space-y-2">
            <legend className="mb-2 font-semibold text-slate-900">{copy.whichPart}</legend>
            {choices.map((b) => {
              const isHeld = held.has(b) && b !== step.block;
              const noRdf = isRdf(b) && !micOk;
              return (
                <label key={b} className={`flex min-h-[48px] items-center gap-3 rounded-xl border px-4 py-2 ${step.block === b ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
                  <input type="radio" name="assess-block" className="h-6 w-6 shrink-0" value={b} checked={step.block === b}
                    disabled={locked || busy || isHeld || noRdf} onChange={() => chooseBlock(b)} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900">{copy.blocks[b]}</span>
                    {b === 'full' && <span className="block text-sm text-slate-600">{copy.aboutMinutes(FULL_MINUTES)}</span>}
                    {isRdf(b) && <span className="block text-sm text-slate-600">{copy.aboutPerChild(RDF_MINUTES)}</span>}
                    {isHeld && <span className="block text-xs text-slate-500">{copy.heldByOther}</span>}
                  </span>
                  {b === suggested && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">{copy.suggested}</span>}
                </label>
              );
            })}
          </fieldset>
        ) : (
          <>
            <label className="flex min-h-[48px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2">
              <input type="checkbox" className="h-6 w-6 shrink-0" checked={step.block === 'full'} disabled={locked || busy}
                onChange={(e) => chooseBlock(e.target.checked ? 'full' : null)} />
              <span className="flex-1 font-medium text-slate-900">{copy.wholeBattery}</span>
              <span className="text-sm text-slate-600">{copy.aboutMinutes(FULL_MINUTES)}</span>
            </label>
            {rdfBlocks.map((rb) => (
              <label key={rb} className="flex min-h-[48px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2">
                <input type="checkbox" className="h-6 w-6 shrink-0" checked={step.block === rb} disabled={locked || busy || !micOk}
                  onChange={(e) => chooseBlock(e.target.checked ? rb : null)} />
                <span className="flex-1 font-medium text-slate-900">{copy.blocks[rb]}</span>
                <span className="text-sm text-slate-600">{copy.aboutPerChild(RDF_MINUTES)}</span>
              </label>
            ))}
          </>
        )}
        {rdfBlocks.length > 0 && !micOk && !locked && <p data-testid="assess-rdf-mic" className="text-sm text-slate-600">{copy.rdfNeedsMic}</p>}
        {isRdf(step.block) && rdfOthers > 0 && (
          <p data-testid="assess-rdf-five" role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{copy.rdfFive}</p>
        )}
        {moved && moved === step.block && (
          <p data-testid="assess-block-moved" role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{copy.blockMoved(copy.blocks[moved])}</p>
        )}
        <AssessActions>
          <button type="button" disabled={busy} onClick={start}
            className="w-full min-h-[64px] rounded-2xl bg-emerald-600 text-2xl font-semibold text-white disabled:opacity-60">{copy.start}</button>
          {otherPhoneButton(step.child, otherPhone, busy)}
        </AssessActions>
      </div>
    );
  } else if (step.kind === 'engine') {
    content = (
      <AssessEngineSlot sessionId={step.sessionId} firstName={firstNameOf(step.child, lang)} lang={lang}
        grade={step.child.grade || list?.grade || 3} block={step.block} onFinished={finished} handbackV2={switches.handbackV2} voiceGateV2={switches.voiceGateV2} />
    );
  } else {
    // this phone's outcomes, plus the server's for children this phone has no record of (a reload mid-visit)
    const outcomes = [
      ...Object.values(memory?.outcomes ?? {}),
      ...children.filter((c) => isMarkedOut(c) && !memory?.outcomes[c.drawId])
        .map((c) => ({ outcome: c.status === 'refused' ? 'refused' : 'absent', name: nameOf(c, lang) })),
    ];
    const names = (xs: string[]) => (xs.length ? xs.join(' · ') : copy.none);
    const started = startedAt;
    const notSent = leftKids.filter((c) => syncOf(c) !== 'sent').length;
    content = (
      <div data-testid="assess-summary" className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">{copy.summaryTitle} · {step.school.name}</h2>
        <dl className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div data-testid="summary-done"><dt className="text-sm text-slate-500">{copy.summaryDone}</dt><dd className="break-words">{switches.resultsView && doneKids.length
            ? doneKids.map((c, i) => {
              const id = serverIdOf(c);
              return (
                <span key={c.drawId}>
                  {i > 0 && ' · '}
                  {id ? <Link to={resultsPath(id)} className="text-sky-800 underline">{nameOf(c, lang)}</Link> : nameOf(c, lang)}
                </span>
              );
            })
            : names(doneKids.map((c) => nameOf(c, lang)))}</dd></div>
          <div data-testid="summary-absent"><dt className="text-sm text-slate-500">{copy.summaryAbsent}</dt><dd className="break-words">{names(outcomes.filter((o) => o.outcome === 'absent').map((o) => o.name))}</dd></div>
          <div data-testid="summary-refused"><dt className="text-sm text-slate-500">{copy.summaryRefused}</dt><dd className="break-words">{names(outcomes.filter((o) => o.outcome === 'refused').map((o) => o.name))}</dd></div>
          <div data-testid="summary-unfinished"><dt className="text-sm text-slate-500">{copy.summaryUnfinished}</dt><dd className="break-words">{names(children.filter((c) => Boolean(c.sessionId || sessionOf(c)) && !isDone(c) && !elsewhere(c)).map((c) => nameOf(c, lang)))}</dd></div>
          <div data-testid="summary-other"><dt className="text-sm text-slate-500">{copy.onOtherPhone}</dt><dd className="break-words">{names(children.filter(elsewhere).map((c) => nameOf(c, lang)))}</dd></div>
        </dl>
        <p className="text-slate-800">{copy.totalTime(mmss(started === null ? 0 : Date.now() - started))}</p>
        <p className="text-slate-800">{copy.notSentYet(notSent)}</p>
        <button type="button" onClick={() => setStep({ kind: 'schools' })}
          className="w-full min-h-[56px] rounded-2xl bg-emerald-600 text-xl font-semibold text-white">{notSent > 0 ? copy.sendLater : copy.finish}</button>
      </div>
    );
  }

  const inTest = step.kind === 'engine';
  return (
    <PortalLayout bare={inTest}>
      <div data-testid="assess-root" className={`max-w-md mx-auto overflow-x-clip ${lang === 'ur' ? URDU_ROOT : ''}`} dir={lang === 'ur' ? 'rtl' : 'ltr'} lang={lang}>
        {!inTest && header}
        {content}
        {drainAt !== null && step.kind !== 'engine' && <AssessDrain key={drainAt} onDone={drainDone} />}
        {toast && step.kind === 'list' && (
          <p role="status" className={`pointer-events-none fixed inset-x-4 ${above.toast} z-50 mx-auto max-w-md rounded-xl bg-slate-900 px-4 py-3 text-center text-white shadow-lg`}>{copy.savedNext}</p>
        )}
        {step.kind === 'schools' && enabled === true && (
          <Link to="/portal/leader" className="mt-6 block py-3 text-center text-sm text-slate-500">{copy.back}</Link>
        )}
      </div>
    </PortalLayout>
  );
}
