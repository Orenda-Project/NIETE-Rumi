import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Check, CircleAlert, Lock } from 'lucide-react';
import api from '../../services/api';
import { Chip } from '../Chip';
import { BottomButton } from '../BottomButton';
import { ToggleList } from '../ToggleList';
import { TRAINING_COPY } from '../copy';
import { Loading, NotLoaded, TrainingActions, TrainingInner } from './frame';
import { statusOf, trainingBase, trainingPaths, useGet } from './trainingApi';

/**
 * bd-5rz1v.25 — /portal/training/grades, My grades (deep-screens.html, Training 10): BandPicker
 * in the kit, reached from the account sheet (and from Training only when nothing is assigned).
 *
 * The 48-hour rule is the server's (band-selection.service, bd-43487); this screen re-derives
 * nothing. GET /training/bands sends `can_change` and `hours_remaining`; POST /training/bands
 * refuses a change inside the window with 429. Both become CHIPS:
 *   can change   amber "Locked 48h after save" (any save starts the window)
 *   inside it    amber "Locked · 31h", the toggles and Save off
 *   a 429        the same chip, with the hours the server reports once asked again
 * The server's `notice` and 429 `error` are sentences; they are not shown. (A server change would
 * be cleaner: `cooldown_hours` in the GET instead of the sentence, and `hours_remaining` in the
 * 429 body, which applyBandSelection already computes and the route drops.)
 */
type Bands = {
  options?: Array<{ id: string; title: string }>;
  selected?: string[];
  can_change?: boolean;
  is_first_selection?: boolean;
  hours_remaining?: number;
};

/** "Primary (Grades 1-5)" → "Primary" and "1–5". A title in any other shape is shown whole. */
function split(title: string): { label: string; range: string | null } {
  const m = title.match(/^(.*?)\s*\(\s*grades?\s*(\d+)\s*[-–]\s*(\d+)\s*\)\s*$/i);
  return m ? { label: m[1], range: TRAINING_COPY.range(m[2], m[3]) } : { label: title, range: null };
}

export default function TrainingGrades() {
  const { pathname } = useLocation();
  const paths = trainingPaths(trainingBase(pathname));
  const bands = useGet<Bands>('/training/bands');
  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<'saved' | 'locked' | 'failed' | null>(null);

  const d = bands.data;
  useEffect(() => { if (d) setChosen(Array.isArray(d.selected) ? d.selected : []); }, [d]);

  const canChange = d ? d.can_change !== false && outcome !== 'locked' : false;
  const hours = d && d.can_change === false ? Math.max(1, Math.round(Number(d.hours_remaining) || 0)) : null;

  const save = async () => {
    if (!canChange || saving || !chosen.length) return;
    setSaving(true);
    setOutcome(null);
    try {
      await api.post('/training/bands', { bands: chosen });
      setOutcome('saved');
      bands.reload();
    } catch (err) {
      if (statusOf(err) === 429) {
        // The server's cooldown: ask again for the hours left, and show them as the chip.
        setOutcome('locked');
        bands.reload();
      } else {
        setOutcome('failed');
      }
    } finally {
      setSaving(false);
    }
  };

  const options = (d?.options || []).map((o) => {
    const { label, range } = split(o.title);
    return { key: o.id, label, aside: range ? <Chip>{range}</Chip> : undefined };
  });

  return (
    <TrainingInner crumb={TRAINING_COPY.crumb()} title={TRAINING_COPY.myGrades} backTo={paths.home}>
      {bands.loading && !d ? <Loading /> : null}
      {!bands.loading && bands.error ? <NotLoaded onRetry={bands.reload} /> : null}

      {d ? (
        <div className="flex flex-col gap-3 md:max-w-[560px]">
          <ToggleList
            mode="multi"
            label={TRAINING_COPY.grades}
            options={options}
            value={chosen}
            onChange={setChosen}
            disabled={!canChange || saving}
          />
          <div className="flex flex-wrap gap-1.5">
            {hours != null
              ? <Chip tone="waiting" icon={Lock}>{TRAINING_COPY.lockedFor(hours)}</Chip>
              : outcome === 'locked'
                ? <Chip tone="waiting" icon={Lock}>{TRAINING_COPY.locked}</Chip>
                : <Chip tone="waiting" icon={Lock}>{TRAINING_COPY.lockedAfterSave}</Chip>}
            {outcome === 'saved' ? <Chip tone="done" icon={Check}>{TRAINING_COPY.saved}</Chip> : null}
            {outcome === 'failed' ? <Chip tone="error" icon={CircleAlert}>{TRAINING_COPY.notSaved}</Chip> : null}
          </div>
        </div>
      ) : null}

      {d ? (
        <TrainingActions>
          <BottomButton icon={Check} onClick={save} disabled={!canChange || saving || !chosen.length} testId="training-grades-save">
            {TRAINING_COPY.save}
          </BottomButton>
        </TrainingActions>
      ) : null}
    </TrainingInner>
  );
}
