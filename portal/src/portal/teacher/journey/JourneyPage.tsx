import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import TeacherPage from '../TeacherPage';
import { TEACHER_FRAME } from '../copy';
import { useCopy } from '../i18n';
import { teacherPath } from '../routes';
import { useBidi } from '../ui/bidi';
import { ListRow } from '../ui/ListRow';
import { LIST_CARD, ROW_SUB } from '../ui/styles';
import { useKitCopy } from '../ui/useKitCopy';
import { LoadState } from '../lessons/LoadState';
import { HistoryList } from '../ui/HistoryList';
import { JOURNEY } from './copy';
import { loadJourney, type JourneyLoad } from './api';
import { JourneyList } from './JourneyList';
import { taughtInWindow, updatedLine } from './weeks';

/**
 * My journey (spec §4): her own steps, newest first, by Pakistan week — from GET /me/journey (the activity store only).
 *   loading     grey rows (lessons LoadState), never a spinner
 *   failed      Could not load + Try again
 *   off (404)   back to Home (no dead page)
 *   not ready   the kit's empty card: Not ready yet
 *   no step     the empty card: Nothing yet, and a row to Lesson Plans
 * `?step=taught` (Home's Taught in class tile): title Taught in class, crumb My journey, only the taught lines of Home's
 * 30 days; Back → Home either way.
 */
export function JourneyPage() {
  const J = useCopy(JOURNEY);
  const F = useCopy(TEACHER_FRAME);
  const kit = useKitCopy();
  const bidi = useBidi();
  const [params] = useSearchParams();
  const taught = params.get('step') === 'taught';
  const [state, setState] = useState<JourneyLoad | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    setState(null);
    void loadJourney().then((r) => { if (live) setState(r); });
    return () => { live = false; };
  }, [attempt]);

  const home = teacherPath('home');
  if (state?.status === 'off') return <Navigate to={home} replace />;

  const data = state?.status === 'ok' ? state.data : null;
  const steps = data ? (taught ? taughtInWindow(data.steps, now) : data.steps) : [];
  const updated = data?.ready ? updatedLine(data.updatedAt, now, J, kit) : null;
  return (
    <TeacherPage crumb={taught ? J.title : F.nav.home} title={taught ? J.steps.taught : J.title} backTo={home} testId="journey">
      <LoadState
        status={state === null ? 'loading' : state.status === 'error' ? 'error' : 'ok'}
        empty={false}
        onRetry={() => setAttempt((n) => n + 1)}
      />
      {data && !data.ready ? <HistoryList groups={[]} emptyLabel={J.notReady} /> : null}
      {data?.ready ? (
        <>
          {updated ? <p data-testid="journey-updated" className={`mx-1 ${ROW_SUB}`}>{bidi(updated)}</p> : null}
          <JourneyList
            steps={steps}
            now={now}
            emptyLabel={kit.nothingYet}
            after={taught ? null : (
              <section className={LIST_CARD}>
                <ListRow variant="row" first glyph={<BookOpen className="h-6 w-6" aria-hidden="true" />} label={F.nav.lessons} to={teacherPath('lessons')} />
              </section>
            )}
          />
        </>
      ) : null}
    </TeacherPage>
  );
}
