import { useEffect, useMemo, useState } from 'react';
import { AttentionBanner } from '../ui';
import { useKitCopy } from '../ui/useKitCopy';
import { useCopy } from '../i18n';
import { LESSONS } from '../lessons/copy';
import { dayName, pkDayOf, pkToday } from '../lessons/days';
import { COACHING } from './copy';
import { listKept, type KeptSummary } from '../../lib/recordingStore';
import { linkOf } from '../../lib/recordingLink';
import { keptOffer } from '../../lib/keptOffer';
import { useRecordingSession } from '../../lib/recordingSession';
import { pkTime } from '../../coach/reports/data';

/**
 * bd-ma9jiy.3 (queue #262; the operator 26 Nov ~11:10: recordings "done but not yet submitted should also be on the Needs
 * You section") — the teacher's Digital Coaching page has no Needs you: its waiting block gets one card per recording this
 * phone keeps from HER own Digital Coaching and has not sent, by #292's rule (lib/keptOffer).
 *
 * bd-ma9jiy (26 Nov ~15:10: "on the user's device we should note which observation is the one that's being recorded. So
 * they can also store 2 at a time as well.") — each is its OWN attempt (made when she pressed Start, with its class), on
 * its own card, opened on its own; never joined to another:
 *
 *   paused    "Recording paused · Grade 4 · Science · 21 min · Today" — Continue recording (that attempt only)
 *   not sent  "Recording not sent · Grade 4 · Science · 27 min · Today" — Add details & send (that recording, on its own)
 *   unlinked  "Unlinked recording from 10:40 · 27 min" — kept before attempts existed: never reopened; sent on its own
 *   (none)    a short take she stopped: no card, as before
 *
 * A coach's or principal's own observation on a shared phone is not hers: not shown. The recording going on now is not a
 * card.
 */
export type TeacherKept = {
  id: string;
  offer: 'resume' | 'send';
  unlinked: boolean;
  attemptId: string | null;
  grade: string | number | null;
  subject: string | null;
  startedAt: string;
  elapsedMs: number;
};

export function teacherKeptFrom(all: KeptSummary[], now: number): TeacherKept[] {
  const out: TeacherKept[] = [];
  for (const k of all) {
    const link = linkOf(k.meta);
    if (link && link.kind !== 'dc') continue; // a coach's or principal's, or a spoken reflection answer
    const unlinked = !link || !link.attemptId;
    // A linked take follows #292's rule; an unlinked one (the old recorder's, before 25 Nov 22:52) is never resumed and is
    // shown whenever it holds a minute or more (the operator, 26 Nov: they "must also be found and shown").
    const offer = unlinked ? ((k.meta.elapsedMs || 0) >= 60_000 ? 'send' : 'none') : keptOffer(k, now);
    if (offer === 'none') continue;
    out.push({
      id: k.meta.id, offer, unlinked, attemptId: link?.attemptId ?? null, grade: link?.grade ?? null, subject: link?.subject ?? null,
      startedAt: k.meta.startedAt, elapsedMs: k.meta.elapsedMs || 0,
    });
  }
  return out;
}

export function useTeacherKept(): TeacherKept[] | null {
  const [items, setItems] = useState<TeacherKept[] | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => listKept()).then((all) => { if (live) setItems(teacherKeptFrom(all, Date.now())); }).catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, []);
  const session = useRecordingSession();
  const now = session?.active ? session.recordingId : null;
  return useMemo(() => (items ? items.filter((it) => it.id !== now) : null), [items, now]);
}

/** "Grade 4 · General Science" from the attempt's class; "" when it has none. */
export function useClassLabel(): (it: Pick<TeacherKept, 'grade' | 'subject'>) => string {
  const C = useCopy(COACHING);
  return (it) => {
    const g = it.grade != null && String(it.grade).trim() !== '' ? Number(String(it.grade).replace(/[^0-9]/g, '')) : NaN;
    return [Number.isFinite(g) && g > 0 ? C.grade(g) : null, it.subject || null].filter(Boolean).join(' · ');
  };
}

/** The card. `to`: the DC page (it opens the one screen for this recording); `onPress`: on the one screen itself. */
export function KeptRecordingCard({ item, to, onPress }: { item: TeacherKept; to?: string; onPress?: () => void }) {
  const C = useCopy(COACHING);
  const K = useKitCopy();
  const { days } = useCopy(LESSONS);
  const classLabel = useClassLabel();
  const minutes = item.elapsedMs > 0 ? Math.max(1, Math.round(item.elapsedMs / 60_000)) : null;
  const day = pkDayOf(item.startedAt);
  const paused = item.offer === 'resume' && !item.unlinked;
  const head = item.unlinked ? C.unlinkedFrom(pkTime(item.startedAt) || '') : paused ? C.recordingPaused : C.recordingNotSent;
  const line = [head, item.unlinked ? null : classLabel(item) || null, minutes != null ? C.minutes(minutes) : null,
    !item.unlinked && day ? dayName(day, pkToday(), days) : null].filter(Boolean).join(' · ');
  return (
    <AttentionBanner
      testId={item.unlinked ? 'dc-kept-unlinked' : paused ? 'dc-kept-paused' : 'dc-kept-unsent'}
      text={(
        <span className="flex flex-col">
          <span>{line}</span>
          <span className="font-normal">{paused ? K.continueRecording : C.addDetailsSend}</span>
        </span>
      )}
      to={to}
      onPress={to ? undefined : onPress}
    />
  );
}
