import { CalendarRange } from 'lucide-react';
import { useCopy } from '../../i18n';
import { ListRow } from '../../ui';
import { dataOf, useLoad } from '../../../newui/lessons/shared';
import { UNIT } from './unitCopy';
import { listUnits } from './unitApi';
import { unitUrl } from './unitPaths';

/** bd-snkn32.59.1 (queue #165) — her units under Make my own's starts (mockup 2, "My plans and units"). */
export function MyUnits() {
  const U = useCopy(UNIT);
  const [load] = useLoad(() => listUnits(), 'own:units');
  const list = dataOf(load) ?? [];
  if (!list.length) return null;
  return (
    <section className="mt-3.5 flex flex-col gap-2" data-testid="own-units">
      <h2 className="mx-1 text-[20px] font-light">{U.myUnits}</h2>
      {list.map((u) => (
        <ListRow key={u.id} variant="card" glyph={<CalendarRange className="h-6 w-6" strokeWidth={2} aria-hidden="true" />}
          label={u.start_kind === 'goals' ? U.goalUnitLabel(u.goals?.[0] ?? '', u.goals?.length ?? 0) // bd-snkn32.59.4: no chapter
            : `${U.chapterN(u.chapter_from ?? 0)}${u.chapter_to !== u.chapter_from ? ` – ${u.chapter_to}` : ''}`}
          subtitle={`${U.unitDays(u.days)} · ${U.minutes(u.period_minutes)}`} to={unitUrl(u.id)} />
      ))}
    </section>
  );
}
