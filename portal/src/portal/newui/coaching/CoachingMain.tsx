import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AudioLines, ChevronDown, CircleAlert, Hourglass, Loader2, MessageCircleQuestion, Play, Send, Trash2 } from 'lucide-react';
import PortalLayout from '../../components/PortalLayout';
import type { RecordStart } from '../../components/coaching/CoachingHome';
import { useAuth } from '../../hooks/useAuth';
import { portal, type ActiveCoachingSession } from '../../services/api';
import type { CoachingSession } from '../../types/portal';
import { canRecordHere } from '../../lib/recordingSupport';
import { deleteRecording, latestUnsent, type StoredRecording } from '../../lib/recordingStore';
import { handOffRecording } from '../../lib/lessonHandoff';
import { useRecordingSession } from '../../lib/recordingSession';
import { COACHING_COPY } from '../copy';
import { MainHeading } from '../MainHeading';
import { List, Row, SectionLabel } from '../List';
import { Chip, FilterChips } from '../Chip';
import { BottomActions, BottomButton } from '../BottomButton';
import { Sheet } from '../Sheet';
import { Hero } from '../Hero';
import { AccountAvatar } from '../NewUiNavigation';
import { pkDayMonth } from '../range';
import { SendSheet } from './SendSheet';
import { analysingCount, byMonth, lessonRows, waitingForHer } from './lessonRows';

/**
 * bd-5rz1v.26 — Coaching's main page in the new UI (pages/PortalCoaching picks it: portal_new_ui
 * and portal_self_observation, a teacher). Today's CoachingHome, rebuilt from the kit; the
 * mockup has no Coaching section, so it follows Home's and Assessment's patterns:
 *
 *   band     "Coaching" with the mic tile; "8 lessons", "1 analysing"
 *   to do    Answer your question · "2 waiting" → the OLDEST lesson waiting for her answer
 *            Continue · Not sent · 31 min · 2 Oct → a sheet: Continue (green), Delete (red outline)
 *   filter   her subjects as FilterChips, when there are two or more (no search box: typing is
 *            the hardest thing on the screen, and the month labels and subjects find a lesson)
 *   list     newest first under a month label: the day in the tile, the topic, the subject, the
 *            band as a word or where the lesson is; › opens its page. Ten, then More.
 *   button   ONE green Send a lesson → SendSheet (Record live lecture | Upload recording)
 *
 * Behaviour is CoachingHome's: the record page is told what she chose in the route state
 * ({ start: record | file | resume }); it sends her back with { sendSheet } to choose again; while
 * a lesson is recording the not-sent row stays away (it IS that lesson) and Send a lesson goes
 * back to it instead of starting a second.
 */

const PAGE = 10;
const RECORD_PAGE = '/portal/coaching/new';
const ALL = '__all';

type Load = 'loading' | 'error' | 'ok';

export default function CoachingMain() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const recordingNow = !!useRecordingSession()?.active;

  const [sheet, setSheet] = useState<'send' | 'unsent' | null>(
    () => ((location.state as { sendSheet?: boolean } | null)?.sendSheet === true ? 'send' : null),
  );
  const [canRecord, setCanRecord] = useState(false);
  const [unsent, setUnsent] = useState<StoredRecording | null>(null);
  const [load, setLoad] = useState<Load>('loading');
  const [attempt, setAttempt] = useState(0);
  const [done, setDone] = useState<CoachingSession[]>([]);
  const [active, setActive] = useState<ActiveCoachingSession[]>([]);
  const [subject, setSubject] = useState<string>(ALL);
  const [shown, setShown] = useState(PAGE);

  // Her lessons: the finished ones and the ones on their way. The finished list is the page;
  // the other is a bonus (a failure there leaves those rows out, as before).
  useEffect(() => {
    let live = true;
    setLoad('loading');
    (async () => {
      const [d, a] = await Promise.allSettled([
        Promise.resolve().then(() => portal.getCoachingSessions(1, 100)),
        Promise.resolve().then(() => portal.getActiveCoachingSessions()),
      ]);
      if (!live) return;
      if (d.status === 'fulfilled') setDone((d.value && d.value.sessions) || []);
      if (a.status === 'fulfilled') setActive((a.value && a.value.sessions) || []);
      setLoad(d.status === 'fulfilled' ? 'ok' : 'error');
    })();
    return () => { live = false; };
  }, [attempt]);

  // Can this phone record, and is a recording left on it?
  useEffect(() => {
    let live = true;
    canRecordHere().then((ok) => { if (live) setCanRecord(ok); }).catch(() => {});
    latestUnsent().then((u) => { if (live) setUnsent(u ? u.meta : null); }).catch(() => {});
    return () => { live = false; };
  }, []);

  // { sendSheet } is taken once: coming Back to this page later must not open the sheet again.
  useEffect(() => {
    if ((location.state as { sendSheet?: boolean } | null)?.sendSheet) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location, navigate]);

  const rows = useMemo(() => lessonRows(done, active), [done, active]);
  const waiting = useMemo(() => waitingForHer(active), [active]);
  const analysing = analysingCount(active);
  const subjects = useMemo(
    () => [...new Set(rows.map((r) => r.subject).filter((s): s is string => !!s))].sort(),
    [rows],
  );
  const filtered = subject === ALL ? rows : rows.filter((r) => r.subject === subject);
  const groups = byMonth(filtered.slice(0, shown));

  const toRecordPage = (start: RecordStart['start']) => {
    setSheet(null);
    navigate(RECORD_PAGE, { state: { start } satisfies RecordStart });
  };
  const sendALesson = () => (recordingNow ? navigate(RECORD_PAGE) : setSheet('send'));
  const deleteUnsent = async () => {
    const id = unsent?.id;
    setSheet(null);
    if (!id) return;
    try { await deleteRecording(id); } catch { /* already gone */ }
    setUnsent(null);
  };

  const showUnsent = !!unsent && !recordingNow;
  const unsentDay = unsent ? pkDayMonth(unsent.startedAt) : null;
  const unsentMinutes = unsent?.elapsedMs ? Math.max(1, Math.round(unsent.elapsedMs / 60_000)) : null;

  return (
    <PortalLayout ownHeading>
      <MainHeading
        feature="coaching"
        title={COACHING_COPY.title}
        right={<div className="md:hidden"><AccountAvatar name={user?.firstName} testId="newui-coaching-avatar" /></div>}
        context={load === 'ok' && rows.length > 0 ? (
          <>
            <Chip surface="band">{COACHING_COPY.lessons(rows.length)}</Chip>
            {analysing > 0 ? <Chip surface="band" icon={Hourglass}>{COACHING_COPY.analysingCount(analysing)}</Chip> : null}
          </>
        ) : null}
      />
      {/* Desktop: what waits for her and the button on the left, her lessons on the right. A phone
          keeps one column, the button fixed above the menu. */}
      <div className="mx-auto flex max-w-[1120px] flex-col gap-3 px-[14px] pb-[14px] md:[display:grid] md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-start md:gap-x-6 md:px-10 md:pt-[10px]">
        <div className="flex flex-col gap-3">
          {waiting.length > 0 || showUnsent ? (
            <List>
              {waiting.length > 0 ? (
                <Row
                  title={COACHING_COPY.answer}
                  icon={MessageCircleQuestion}
                  to={`/portal/coaching/session/${waiting[0].id}`}
                  chips={<Chip tone="waiting">{COACHING_COPY.waiting(waiting.length)}</Chip>}
                  testId="coaching-answer"
                />
              ) : null}
              {showUnsent ? (
                <Row
                  title={COACHING_COPY.continue}
                  icon={AudioLines}
                  onClick={() => setSheet('unsent')}
                  chips={(
                    <>
                      <Chip tone="waiting">{COACHING_COPY.notSent}</Chip>
                      {unsentMinutes ? <Chip>{COACHING_COPY.minutes(unsentMinutes)}</Chip> : null}
                      {unsentDay ? <Chip>{`${unsentDay.day} ${unsentDay.month}`}</Chip> : null}
                    </>
                  )}
                  testId="coaching-unsent"
                />
              ) : null}
            </List>
          ) : null}
          <BottomActions>
            <BottomButton icon={Send} onClick={sendALesson} testId="coaching-send">{COACHING_COPY.send}</BottomButton>
          </BottomActions>
        </div>

        <div className="flex flex-col gap-3">
          {load === 'loading' ? <Hero title={COACHING_COPY.loading} icon={Loader2} spinning live /> : null}
          {load === 'error' ? (
            <>
              <Hero title={COACHING_COPY.notLoaded} icon={CircleAlert} tone="error" live />
              <BottomButton tone="outline" onClick={() => setAttempt((n) => n + 1)}>{COACHING_COPY.retry}</BottomButton>
            </>
          ) : null}
          {load === 'ok' && rows.length === 0 ? <Hero title={COACHING_COPY.empty} icon={AudioLines} /> : null}

          {load === 'ok' && subjects.length > 1 ? (
            <FilterChips<string>
              label={COACHING_COPY.subjects}
              value={subject}
              onChange={(s) => { setSubject(s); setShown(PAGE); }}
              options={[{ key: ALL, label: COACHING_COPY.all }, ...subjects.map((s) => ({ key: s, label: s }))]}
            />
          ) : null}

          {load === 'ok' && rows.length > 0 ? (
            <div data-testid="coaching-recordings" className="flex flex-col gap-3">
              {groups.map((g) => (
                <section key={g.key} className="flex flex-col gap-2">
                  <SectionLabel>{g.label}</SectionLabel>
                  <List label={g.label}>
                    {g.rows.map((r) => (
                      <Row
                        key={r.id}
                        title={r.title}
                        lead={r.day}
                        to={`/portal/coaching/session/${r.id}`}
                        chips={r.chips.map((c) => <Chip key={`${c.kind}-${c.text}`} tone={c.tone}>{c.text}</Chip>)}
                        testId={`coaching-row-${r.id}`}
                      />
                    ))}
                  </List>
                </section>
              ))}
            </div>
          ) : null}

          {load === 'ok' && filtered.length > shown ? (
            <List>
              <Row title={COACHING_COPY.more} icon={ChevronDown} end={ChevronDown} onClick={() => setShown((n) => n + PAGE)} testId="coaching-more" />
            </List>
          ) : null}
        </div>
      </div>

      <SendSheet
        open={sheet === 'send'}
        canRecord={canRecord}
        onRecord={() => toRecordPage('record')}
        onFile={(file) => { handOffRecording(file); toRecordPage('file'); }}
        onClose={() => setSheet(null)}
      />

      <Sheet open={sheet === 'unsent'} title={COACHING_COPY.notSent} onClose={() => setSheet(null)} testId="coaching-unsent-sheet">
        <BottomButton icon={Play} iconFlips onClick={() => toRecordPage('resume')}>{COACHING_COPY.continue}</BottomButton>
        <BottomButton tone="dangerOutline" icon={Trash2} onClick={() => { void deleteUnsent(); }}>{COACHING_COPY.delete}</BottomButton>
      </Sheet>
    </PortalLayout>
  );
}
