import { Navigate, useParams } from 'react-router-dom';
import { useCopy } from '../i18n';
import { isLadder, providerLabel, trainingPaths, useGet, type Level, type Vendor } from '../../newui/training/trainingApi';
import { ListRow, type ChipData } from '../ui';
import { TRAINING } from './copy';
import { TRAINING_V2_BASE } from './model';
import { LoadState, TrainingPageV2 } from './TrainingFrame';

/**
 * bd-fmf24g.5 — a provider. On a ladder (NIETE) the level page's journey path IS the list of levels, so
 * this goes straight to the level she is on (the first open one not certified; all certified → the last).
 * One level (I-SAPS, Oxbridge) → that level. A set of subjects open in any order (Beacon House) → the
 * subjects as rows, each with its courses done; a locked one shows locked.
 */
const paths = trainingPaths(TRAINING_V2_BASE);

export function TrainingProviderPage() {
  const C = useCopy(TRAINING);
  const { vendorKey = '' } = useParams();
  const vendors = useGet<Vendor[]>('/training/vendors', undefined, (d) => (d as { vendors?: Vendor[] })?.vendors || []);
  const levels = useGet<Level[]>('/training/levels', undefined, (d) => (d as { levels?: Level[] })?.levels || []);

  const mine = (levels.data || []).filter((l) => l.vendor_key === vendorKey).sort((a, b) => a.order_index - b.order_index);
  if (mine.length === 1) return <Navigate to={paths.level(vendorKey, mine[0].id)} replace />;
  if (mine.length > 1 && isLadder(mine[0])) {
    const at = mine.find((l) => l.state !== 'locked' && l.state !== 'certified')
      ?? [...mine].reverse().find((l) => l.state === 'certified')
      ?? mine[0];
    return <Navigate to={paths.level(vendorKey, at.id)} replace />;
  }

  return (
    <TrainingPageV2 crumb={C.crumb()} title={providerLabel(vendorKey, vendors.data)} backTo={paths.home}>
      <LoadState loading={levels.loading} failed={!levels.loading && !!levels.error} onRetry={levels.reload} />
      {mine.length ? (
        <>
          <h2 className="mx-1 mt-1 text-[20px] font-light">{C.subjects}</h2>
          <div className="flex flex-col gap-2.5" data-testid="training-subjects">
            {mine.map((l) => {
              const chip: ChipData | null = l.state === 'certified' ? { text: C.certified, tone: 'done' } : null;
              return (
                <ListRow
                  key={l.id}
                  icon="file"
                  label={l.name}
                  subtitle={C.coursesOf(Math.min(l.courses_completed || 0, l.courses_total || 0), l.courses_total || 0)}
                  chip={chip}
                  state={l.state === 'locked' ? 'locked' : 'default'}
                  to={l.state === 'locked' ? undefined : paths.level(vendorKey, l.id)}
                />
              );
            })}
          </div>
        </>
      ) : null}
    </TrainingPageV2>
  );
}
