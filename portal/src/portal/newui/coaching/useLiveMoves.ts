import { useCallback, useEffect, useRef, useState } from 'react';
import { portal, type LiveCard, type LiveMovesRecord } from '../../services/api';
import type { RecordingSession } from '../../lib/recordingSession';
import { createSonioxTee, type SonioxTee, type TeeStatus } from '../../lib/live/sonioxTee';
import { applyTap, applyTicks, initState, nowIndex, toRecord, untickedIdx, type LiveState } from '../../lib/live/liveMovesState';
import type { Plan } from './useSendFlow';

/**
 * bd-v0toag.31 — live moves for a group D teacher while she records: the card for the lesson she picked,
 * a Soniox tee on the recorder's chunks, a detect call every 60 s, and the record that goes with the lesson.
 *
 * It only reads. A missing card, a refused key or a failed detect shows less, never touches the recording.
 *
 *   leaving the page   (Back, the Lesson plans row) while still recording: the stream closes, the ticks and
 *                      chunk 0 stay in `hold` for her return, where a fresh stream sends chunk 0 first.
 *                      The slot is not given back: the server frees it after 3 minutes without a key or detect.
 *   finish             `recording` turns false: the stream closes and the slot is given back (liveEnd), once.
 *   taps               only on the recording screen, so they all travel inside `toRecord()` at send.
 */

const DETECT_MS = 60_000;

type Hold = { liveId: string; lessonId: string; card: LiveCard | null; state: LiveState | null; header: Blob | null; ended: boolean };
let hold: Hold | null = null;

/** Tests: forget a previous lesson's hold. */
export function forgetLiveHold(): void { hold = null; }

const lessonOf = (plan: Plan | null): string | null =>
  (plan && plan.kind === 'library' && 'lessonId' in plan.pick ? plan.pick.lessonId : null);

export type LiveMoves = {
  card: LiveCard | null;
  state: LiveState | null;
  now: number | null;
  status: TeeStatus;
  tap: (idx: number, choice: 'did' | 'did_not') => void;
  toRecord: () => LiveMovesRecord | null;
};

export function useLiveMoves({ session, plan, recording }: {
  session: RecordingSession | null;
  plan: Plan | null;
  /** True while her lesson is being recorded on this page; false once she finishes. */
  recording: boolean;
}): LiveMoves {
  // The session forgets its recording id on finish; the slot and the record still need it.
  const idRef = useRef<string | null>(null);
  if (session?.recordingId) idRef.current = session.recordingId;
  const liveId = idRef.current;
  const lessonId = lessonOf(plan);
  const mine = (h: Hold | null) => (h && h.liveId === liveId && h.lessonId === lessonId ? h : null);

  const [card, setCard] = useState<LiveCard | null>(() => mine(hold)?.card ?? null);
  const [state, setState] = useState<LiveState | null>(() => mine(hold)?.state ?? null);
  const [noCard, setNoCard] = useState(false);
  const [paused, setPaused] = useState(false);
  const [, setTick] = useState(0);
  const tee = useRef<SonioxTee | null>(null);
  const lastStats = useRef({ drops: 0, bytesSent: 0 });   // the closed stream's, for liveEnd and toRecord
  const stateRef = useRef(state);
  stateRef.current = state;

  // The card, once per lesson (kept in the hold so a return does not ask again).
  useEffect(() => {
    if (!recording || !liveId || !lessonId) return undefined;
    if (!mine(hold)) hold = { liveId, lessonId, card: null, state: null, header: null, ended: false };
    if (hold!.card) return undefined;
    let alive = true;
    portal.liveCard(lessonId).then((r) => {
      if (!alive) return;
      if (!r || !r.on || !r.card) { setNoCard(true); return; }
      const s = initState(r.card);
      if (hold && hold.liveId === liveId) { hold.card = r.card; hold.state = s; }
      setCard(r.card);
      setState(s);
    }).catch(() => { if (alive) setNoCard(true); /* no card: recording as today */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, liveId, lessonId]);

  // Chunk 0 can arrive before the card: keep it whenever she records a picked lesson.
  useEffect(() => {
    if (!recording || !session || !liveId || !lessonId || noCard) return undefined;
    session.setChunkListener((blob, seq) => {
      if (seq === 0 && hold && hold.liveId === liveId) hold.header = blob;
      tee.current?.push(blob, seq);
    });
    return () => session.setChunkListener(null);
  }, [recording, session, liveId, lessonId, noCard]);

  // The stream: only once a card exists (no card, no key request).
  useEffect(() => {
    if (!recording || !card || !liveId) return undefined;
    const t = createSonioxTee({ getKey: () => portal.liveKey(liveId), lang: 'ur' });
    tee.current = t;
    if (hold?.header) t.push(hold.header, 0);
    return () => { lastStats.current = t.stats(); t.close(); tee.current = null; };
  }, [recording, card, liveId]);

  // Detect every 60 s while the stream is not off.
  useEffect(() => {
    if (!recording || !card || !liveId || !session) return undefined;
    const id = setInterval(() => {
      const t = tee.current;
      const s = stateRef.current;
      if (!t || !s || t.status() === 'off') { setTick((n) => n + 1); return; }
      portal.liveDetect({ liveId, lessonId: s.lessonId, window: t.windowText(), unticked: untickedIdx(s) })
        .then((r) => {
          const next = applyTicks(stateRef.current ?? s, r.ticked || [], session.elapsedMs());
          if (hold && hold.liveId === liveId) hold.state = next;
          setState(next);
          setPaused(false);
        })
        .catch(() => setPaused(true));
    }, DETECT_MS);
    return () => clearInterval(id);
  }, [recording, card, liveId, session]);

  // Finish: give the slot back, once.
  useEffect(() => {
    if (recording || !hold || hold.liveId !== liveId || hold.ended || !hold.card) return;
    hold.ended = true;
    void portal.liveEnd({ liveId: hold.liveId, ...lastStats.current }).catch(() => {});
  }, [recording, liveId]);

  const tap = useCallback((idx: number, choice: 'did' | 'did_not') => {
    const s = stateRef.current;
    if (!s) return;
    const next = applyTap(s, idx, choice, new Date().toISOString()).state;
    if (hold && hold.liveId === liveId) hold.state = next;
    stateRef.current = next;
    setState(next);
  }, [liveId]);

  const record = useCallback((): LiveMovesRecord | null => {
    const s = stateRef.current;
    if (!s || !liveId) return null;
    const stats = tee.current ? tee.current.stats() : lastStats.current;
    return toRecord(s, { liveId, ...stats });
  }, [liveId]);

  const teeStatus: TeeStatus = tee.current ? tee.current.status() : 'live';
  const status: TeeStatus = teeStatus === 'off' ? 'off' : paused ? 'paused' : teeStatus;
  const now = state && session ? nowIndex(state, session.elapsedMs()) : null;
  return { card, state, now, status, tap, toRecord: record };
}
