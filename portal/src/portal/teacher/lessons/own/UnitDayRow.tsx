import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tray } from '../../ui';
import { FOCUS } from '../../ui/styles';
import type { UnitCopy } from './unitCopy';
import { canEdit, type EditOp, type UnitDay } from './unitEdit';
import type { UnitPlan } from './unitApi';

/** Review and test days are coloured (mockup 6); lesson and practice days stay plain. */
const KIND_TONE: Record<UnitDay['kind'], string> = {
  lesson: 'bg-[#f3f4f6] text-[#374151]', practice: 'bg-[#f3f4f6] text-[#374151]',
  review: 'bg-[#fef3c7] text-[#92400e]', test: 'bg-[#dbeafe] text-[#1e40af]',
};

/**
 * bd-snkn32.59.1 (queue #165, mockups 6–8) — one day of her unit. While no plan is made (`editing`): its ⋯ opens the
 * change menu (option A: Move up, Move down, Join with next day, Split into 2 days, Close). Open plan is always there
 * (off while a change is not saved: `busy`).
 */
export function UnitDayRow({ U, n, day, days, plan, editing, onEdit, onOpen, busy }: {
  U: UnitCopy; n: number; day: UnitDay; days: readonly UnitDay[]; plan: UnitPlan; editing: boolean;
  onEdit: (op: EditOp) => void; onOpen: () => void; busy: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const at = n - 1;
  const can = canEdit(days, at);
  const any = can.up || can.down || can.join || can.split;
  const pick = (op: EditOp) => { setMenu(false); onEdit(op); };
  const item = (label: string, op: EditOp, ok: boolean, id: string) => (ok ? (
    <button key={id} type="button" data-testid={`unit-menu-${id}`} onClick={() => pick(op)}
      className={cn('flex min-h-[56px] w-full items-center rounded-2xl border border-[#e5e7eb] bg-white px-4 text-start text-[16px] font-semibold', FOCUS)}>
      {label}
    </button>
  ) : null);
  return (
    <li className="flex min-h-[64px] items-center gap-3 border-t border-[#f1f2f4] px-4 py-2 first:border-t-0" data-testid={`unit-day-${n}`}>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <b className="text-[14px] text-[#6b7280]">{U.dayN(n)}</b>
          {day.kind !== 'lesson' ? <span className={cn('rounded-full px-2 text-[12px] font-semibold', KIND_TONE[day.kind])}>{U.kinds[day.kind]}</span> : null}
        </span>
        <span dir="auto" className="text-[16px] font-semibold text-[#111827]">{day.topic}{day.part ? ` ${U.part(day.part)}` : ''}</span>
        {day.kind === 'lesson' || day.kind === 'practice' ? <span className="text-[13px] text-[#6b7280]">{plan ? U.made : U.notMade}</span> : null}
      </span>
      {editing && any ? (
        <button type="button" aria-label={`${U.more} · ${U.dayN(n)}`} data-testid={`unit-more-${n}`} onClick={() => setMenu(true)}
          className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-full', FOCUS)}>
          <MoreHorizontal className="h-6 w-6" aria-hidden="true" />
        </button>
      ) : null}
      <button type="button" disabled={busy} data-testid={`unit-open-${n}`} onClick={onOpen}
        className={cn('min-h-[48px] shrink-0 rounded-2xl border px-3 text-[14px] font-semibold', FOCUS, busy ? 'border-[#e5e7eb] text-[#9ca3af]' : 'border-[#e5e7eb] bg-white')}>
        {U.openPlan}
      </button>
      {menu ? (
        <Tray open onClose={() => setMenu(false)} title={`${U.dayN(n)} · ${U.more}`}>
          <div className="flex flex-col gap-2" data-testid="unit-menu">
            {item(U.moveUp, { op: 'move', at, dir: -1 }, can.up, 'up')}
            {item(U.moveDown, { op: 'move', at, dir: 1 }, can.down, 'down')}
            {item(U.join, { op: 'join', at }, can.join, 'join')}
            {item(U.split, { op: 'split', at }, can.split, 'split')}
            <button type="button" onClick={() => setMenu(false)} className={cn('min-h-[56px] rounded-2xl px-4 text-[16px]', FOCUS)}>{U.close}</button>
          </div>
        </Tray>
      ) : null}
    </li>
  );
}
