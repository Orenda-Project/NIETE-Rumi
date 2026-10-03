import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PortalLayout from '../../components/PortalLayout';
import { useAuth } from '../../hooks/useAuth';
import { HOME_COPY } from '../copy';
import { MainHeading } from '../MainHeading';
import { MetricGrid, MetricTile } from '../MetricTile';
import { Chip } from '../Chip';
import { DateRangeButton, DateRangeSheet } from '../DateRange';
import { rangeFromSearch, rangeLabel, rangeSearch, type DateRange } from '../range';
import { AccountAvatar } from '../NewUiNavigation';
import { countOf, getProgress, type ProgressCounts } from './progressApi';

/**
 * bd-5rz1v.17 (UI half) — Home = My progress, behind `portal_new_ui` (PortalDashboard picks it).
 *
 * deep-screens.html, Home: the flat indigo band with the NIETE mark, "Salaam, <first name>" and
 * her avatar (the account sheet); the date range, This month by default; five tiles — Lesson
 * plans used, Training modules done, Assessments made, Attendance marked, and the wide Coaching
 * & observations with "n Digital Coach" and "n Visits". Activity, not ratings: no score here.
 *
 * Each tile opens what is behind it. Lesson plans and Coaching have their own lists inside Home
 * (HomeList); the other three go to their pages for now. The range lives in the address, so the
 * lists open on the same range and Back keeps it.
 *
 * While loading, or when the API fails, every tile shows "—": the page never goes blank.
 */

const HOME_TILE_LINKS = {
  training: '/portal/training',
  // bd-5rz1v.13 — the assessments she made, on the Assessment page.
  assessments: '/portal/assessment/mine',
  attendance: '/portal/classes',
} as const;

type Loaded = { key: string; counts: ProgressCounts | null };

export default function NewHome() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const range = rangeFromSearch(params);
  const search = rangeSearch(range);
  const [picking, setPicking] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>({ key: '', counts: null });

  useEffect(() => {
    let live = true;
    getProgress(range)
      .then((counts) => { if (live) setLoaded({ key: search, counts }); })
      .catch(() => { if (live) setLoaded({ key: search, counts: null }); });
    return () => { live = false; };
    // `search` IS the range, as a string: the effect runs once per range, not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Numbers for THIS range only: a range just picked shows "—" until its own numbers arrive.
  const c = loaded.key === search ? loaded.counts : null;
  const choose = (next: DateRange) => {
    const q = rangeSearch(next);
    setParams(new URLSearchParams(q), { replace: true });
  };
  const digitalCoach = countOf(c?.coaching?.digitalCoach);
  const visits = countOf(c?.coaching?.observations);

  return (
    <PortalLayout ownHeading>
      <MainHeading
        feature="home"
        title={HOME_COPY.greeting(user?.firstName)}
        right={<div className="md:hidden"><AccountAvatar name={user?.firstName} testId="newui-home-avatar" /></div>}
        context={<DateRangeButton value={range} onClick={() => setPicking(true)} />}
      />
      <div className="mx-auto flex max-w-[1120px] flex-col gap-3 px-[14px] pb-[14px] md:px-10 md:pt-[10px]">
        <MetricGrid label={rangeLabel(range)}>
          <MetricTile
            feature="lessonPlans"
            value={countOf(c?.lessonPlans?.used)}
            label={HOME_COPY.tiles.lessonPlans}
            to={`/portal/dashboard/lesson-plans${search}`}
            testId="newui-home-lesson-plans"
          />
          <MetricTile
            feature="training"
            value={countOf(c?.training?.completed)}
            label={HOME_COPY.tiles.training}
            to={HOME_TILE_LINKS.training}
            testId="newui-home-training"
          />
          <MetricTile
            feature="assessment"
            value={countOf(c?.assessments?.made)}
            label={HOME_COPY.tiles.assessments}
            to={HOME_TILE_LINKS.assessments}
            testId="newui-home-assessments"
          />
          <MetricTile
            feature="attendance"
            value={countOf(c?.attendance?.days)}
            label={HOME_COPY.tiles.attendance}
            to={HOME_TILE_LINKS.attendance}
            testId="newui-home-attendance"
          />
          <MetricTile
            wide
            feature="coaching"
            value={countOf(c?.coaching?.total)}
            label={HOME_COPY.tiles.coaching}
            to={`/portal/dashboard/coaching${search}`}
            testId="newui-home-coaching"
            chips={digitalCoach !== null || visits !== null ? (
              <>
                {digitalCoach !== null ? <Chip>{HOME_COPY.digitalCoach(digitalCoach)}</Chip> : null}
                {visits !== null ? <Chip>{HOME_COPY.visits(visits)}</Chip> : null}
              </>
            ) : null}
          />
        </MetricGrid>
      </div>
      <DateRangeSheet open={picking} value={range} onChange={choose} onClose={() => setPicking(false)} />
    </PortalLayout>
  );
}
