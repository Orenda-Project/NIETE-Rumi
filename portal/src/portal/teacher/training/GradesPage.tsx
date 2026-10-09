import { Check } from 'lucide-react';
import { useCopy } from '../i18n';
import { cn } from '@/lib/utils';
import { TRAINING_INNER } from './copy';
import { split, useTrainingGrades } from '../../newui/training/TrainingGrades';
import { StatusChip } from '../ui';
import { FOCUS } from '../ui/styles';
import { DockButton } from './parts';
import { LoadState, TrainingPageV2 } from './TrainingFrame';

/**
 * bd-fmf24g.12 — My grades (v28 canvas TrainingGrades): her bands as big tick rows with their grade range,
 * the 48-hour lock as a chip, Save. The 48-hour rule and the save are the server's through
 * useTrainingGrades (GET/POST /training/bands, 429 → locked), unchanged; only the look is v2.
 */
export function GradesPage() {
  const T = useCopy(TRAINING_INNER);
  const { paths, bands, d, chosen, setChosen, saving, outcome, canChange, hours, save } = useTrainingGrades();
  const off = !canChange || saving;
  const toggle = (id: string) => {
    if (off) return;
    setChosen(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  };

  return (
    <TrainingPageV2
      crumb={T.crumb()}
      title={T.myGrades}
      backTo={paths.home}
      dock={d ? <DockButton icon={Check} onClick={save} disabled={!canChange || saving || !chosen.length} testId="training-grades-save">{T.save}</DockButton> : undefined}
    >
      <LoadState loading={bands.loading && !d} failed={!bands.loading && !!bands.error} onRetry={bands.reload} />
      {d ? (
        <>
          <div role="group" aria-label={T.grades} className="flex flex-col gap-2.5">
            {(d.options || []).map((o) => {
              const { label, range } = split(o.title);
              const on = chosen.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  disabled={off}
                  onClick={() => toggle(o.id)}
                  className={cn(
                    'flex min-h-[72px] w-full items-center gap-3.5 rounded-2xl border-2 py-2.5 pe-3.5 ps-3 text-start',
                    on ? 'border-[#33374a] bg-[#f4f5f8]' : 'border-[#e5e7eb] bg-white',
                    off && 'opacity-60',
                    FOCUS,
                  )}
                >
                  <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border-2 text-white', on ? 'border-[#33374a] bg-[#33374a]' : 'border-[#c7cad6]')}>
                    {on ? <Check className="h-4 w-4" strokeWidth={3.2} aria-hidden="true" /> : null}
                  </span>
                  <span className="flex-1 text-[17px] font-semibold">{label}</span>
                  {range ? <StatusChip text={range} tone="info" /> : null}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-1.5 px-1">
            {hours != null ? <StatusChip text={T.lockedFor(hours)} tone="waiting" />
              : outcome === 'locked' ? <StatusChip text={T.locked} tone="waiting" />
                : <StatusChip text={T.lockedAfterSave} tone="waiting" />}
            {outcome === 'saved' ? <StatusChip text={T.saved} tone="done" tick /> : null}
            {outcome === 'failed' ? <StatusChip text={T.notSaved} tone="error" /> : null}
          </div>
        </>
      ) : null}
    </TrainingPageV2>
  );
}
