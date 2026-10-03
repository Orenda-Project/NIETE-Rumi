import { Navigate, useLocation, useParams } from 'react-router-dom';
import { Award, BookOpen, Lock, Play, Trophy } from 'lucide-react';
import { List, Row } from '../List';
import { Chip } from '../Chip';
import { BottomButton } from '../BottomButton';
import { Hero } from '../Hero';
import { TRAINING_COPY } from '../copy';
import { Loading, NotLoaded, TrainingActions, TrainingInner } from './frame';
import { isLadder, percent, providerLabel, trainingBase, trainingPaths, useGet, type Level, type Vendor } from './trainingApi';

/**
 * bd-5rz1v.25 — /portal/training/provider/:vendorKey (deep-screens.html, Training 2): a
 * provider's levels, as rows under the light bar (crumb "Training").
 *
 * The provider's shape is kept (PortalTrainingV2's LevelRail reads it the same way, from the
 * levels' `unlock_logic`):
 *   a ladder (NIETE)   numbered; done → "Certified"; current → number, "2/5" and a bar;
 *                      locked → a lock, "Pass 2", the row off. The bottom button continues the
 *                      current level.
 *   subjects (Beacon)  unnumbered and never locked: they are open in any order.
 *   one level          (I-SAPS, Oxbridge) the page replaces itself with that level's page.
 */
export default function TrainingLevels() {
  const { vendorKey = '' } = useParams();
  const { pathname } = useLocation();
  const paths = trainingPaths(trainingBase(pathname));
  const vendors = useGet<Vendor[]>('/training/vendors', undefined, (d) => (d as { vendors?: Vendor[] })?.vendors || []);
  const levels = useGet<Level[]>('/training/levels', undefined, (d) => (d as { levels?: Level[] })?.levels || []);

  const title = providerLabel(vendorKey, vendors.data);
  const mine = (levels.data || [])
    .filter((l) => l.vendor_key === vendorKey)
    .sort((a, b) => a.order_index - b.order_index);

  if (mine.length === 1) return <Navigate to={paths.level(vendorKey, mine[0].id)} replace />;

  const ladder = mine.length > 0 && isLadder(mine[0]);
  const current = mine.find((l) => l.state !== 'locked' && l.state !== 'certified');
  const startedSubject = mine.find((l) => l.state !== 'certified' && l.state !== 'locked' && (l.completed_count || 0) > 0);
  const next = ladder ? current : (startedSubject ?? current);

  return (
    <TrainingInner crumb={TRAINING_COPY.crumb()} title={title} backTo={paths.home}>
      {levels.loading ? <Loading /> : null}
      {!levels.loading && levels.error ? <NotLoaded onRetry={levels.reload} /> : null}
      {!levels.loading && !levels.error && mine.length === 0 ? <Hero title={TRAINING_COPY.empty} icon={BookOpen} tone="neutral" /> : null}

      {mine.length > 1 ? (
        <List label={TRAINING_COPY.levels}>
          {mine.map((l) => <LevelRow key={l.id} level={l} ladder={ladder} to={paths.level(vendorKey, l.id)} />)}
        </List>
      ) : null}

      {next && mine.length > 1 ? (
        <TrainingActions>
          <BottomButton icon={Play} to={paths.level(vendorKey, next.id)} testId="training-levels-continue">
            {ladder ? TRAINING_COPY.continueLevel(next.order_index + 1) : TRAINING_COPY.continueTo(next.name)}
          </BottomButton>
        </TrainingActions>
      ) : null}
    </TrainingInner>
  );
}

function LevelRow({ level: l, ladder, to }: { level: Level; ladder: boolean; to: string }) {
  const n = l.order_index + 1;
  const courses = TRAINING_COPY.of(Math.min(l.courses_completed || 0, l.courses_total || 0), l.courses_total || 0);
  const bar = l.courses_completed > 0 || l.state === 'in_progress' || l.state === 'ready_for_quiz'
    ? percent(l.courses_completed || 0, l.courses_total || 0)
    : undefined;

  if (l.state === 'locked') {
    // The gate is the PREVIOUS level's exam; previous_level_order is 0-based like order_index.
    const behind = (l.previous_level_order ?? l.order_index - 1) + 1;
    return (
      <Row
        icon={Lock}
        tile="quiet"
        title={l.name}
        state="off"
        onClick={() => {}}
        chips={ladder ? <Chip icon={Lock}>{TRAINING_COPY.pass(behind)}</Chip> : undefined}
        testId={`training-level-${l.id}`}
      />
    );
  }

  const lead = ladder ? String(n) : undefined;
  const icon = ladder ? undefined : BookOpen;

  if (l.state === 'certified') {
    return (
      // A ladder keeps its number on the green tile; a done subject shows the check.
      <Row
        lead={lead}
        tile="done"
        title={l.name}
        chips={<Chip tone="done" icon={Award}>{TRAINING_COPY.certified}</Chip>}
        to={to}
        testId={`training-level-${l.id}`}
      />
    );
  }

  return (
    <Row
      lead={lead}
      icon={icon}
      title={l.name}
      chips={(
        <>
          <Chip>{courses}</Chip>
          {l.state === 'ready_for_quiz' ? <Chip tone="done" icon={Trophy}>{TRAINING_COPY.ready}</Chip> : null}
        </>
      )}
      progress={bar}
      to={to}
      testId={`training-level-${l.id}`}
    />
  );
}
