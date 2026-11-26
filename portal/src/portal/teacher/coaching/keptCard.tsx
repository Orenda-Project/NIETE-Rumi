import { useEffect, useMemo, useState } from 'react';
import { AttentionBanner } from '../ui';
import { useKitCopy } from '../ui/useKitCopy';
import { useCopy } from '../i18n';
import { LESSONS } from '../lessons/copy';
import { dayName, pkDayOf, pkToday } from '../lessons/days';
import { COACHING } from './copy';
import { COACHING_NEW } from './paths';
import { listKept, type KeptSummary } from '../../lib/recordingStore';
import { recordingTeacher } from '../../lib/coachObserve';
import { keptOffer } from '../../lib/keptOffer';
import { useRecordingSession } from '../../lib/recordingSession';

/**
 * bd-ma9jiy.3 (queue #262; the operator 26 Nov ~11:10: recordings "done but not yet submitted should also be on the Needs
 * You section") — the teacher's Digital Coaching page has no Needs you; its waiting block (the WhatsApp recordings) gets
 * one card per recording this phone keeps from HER own Digital Coaching and has not sent, by #292's rule (lib/keptOffer):
 *
 *   resume  "Recording paused · 21 min · Today" — Continue recording → the one screen, which shows Continue recording
 *   send    "Recording not sent · 27 min · Today" — Add details & send → the one screen, the recording in step 3
 *   none    (a short take she stopped, or an old short one) no card, as before
 *
 * A coach's or principal's own observation on a shared phone (remembered with its teacher) is not hers: not shown. The
 * recording going on now is not a card.
 */
export type TeacherKept = { id: string; offer: 'resume' | 'send'; startedAt: string; elapsedMs: number };

export function teacherKeptFrom(all: KeptSummary[], now: number): TeacherKept[] {
  const out: TeacherKept[] = [];
  for (const k of all) {
    if (recordingTeacher(k.meta.id)) continue;
    const offer = keptOffer(k, now);
    if (offer === 'none') continue;
    out.push({ id: k.meta.id, offer, startedAt: k.meta.startedAt, elapsedMs: k.meta.elapsedMs || 0 });
  }
  return out;
}

export function useTeacherKept(): TeacherKept[] {
  const [items, setItems] = useState<TeacherKept[]>([]);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => listKept()).then((all) => { if (live) setItems(teacherKeptFrom(all, Date.now())); }).catch(() => { /* none */ });
    return () => { live = false; };
  }, []);
  const session = useRecordingSession();
  const now = session?.active ? session.recordingId : null;
  return useMemo(() => items.filter((it) => it.id !== now), [items, now]);
}

export function KeptRecordingCard({ item }: { item: TeacherKept }) {
  const C = useCopy(COACHING);
  const K = useKitCopy();
  const { days } = useCopy(LESSONS);
  const minutes = item.elapsedMs > 0 ? Math.max(1, Math.round(item.elapsedMs / 60_000)) : null;
  const day = pkDayOf(item.startedAt);
  const paused = item.offer === 'resume';
  const line = [paused ? C.recordingPaused : C.recordingNotSent, minutes != null ? C.minutes(minutes) : null, day ? dayName(day, pkToday(), days) : null]
    .filter(Boolean).join(' · ');
  return (
    <AttentionBanner
      testId={paused ? 'dc-kept-paused' : 'dc-kept-unsent'}
      text={(
        <span className="flex flex-col">
          <span>{line}</span>
          <span className="font-normal">{paused ? K.continueRecording : C.addDetailsSend}</span>
        </span>
      )}
      to={COACHING_NEW}
    />
  );
}
