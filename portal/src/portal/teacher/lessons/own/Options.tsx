import type { KeyboardEvent } from 'react';
import { FOCUS, LIST_CARD, radioKeyDown } from '../../ui/styles';

/**
 * the two answer shapes of "Make my own" (the unified spec's layout rule 3: single looks single, multi
 * looks multi). RadioList: one answer, an empty ring that fills (role radiogroup). TickList: square boxes, the textbook
 * locked on, and the hint "Tick all you have". 56px rows, label straight above, every row keeps its `own-opt-<key>` handle.
 */

export type Option = { key: string; label: string; subtitle?: string };

const ROW = `flex min-h-[56px] w-full items-center gap-3 border-t border-[#f1f2f4] px-4 py-2 text-start first:border-t-0 ${FOCUS}`;

function Words({ o }: { o: Option }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="text-[16px] font-semibold text-[#111827]">{o.label}</span>
      {o.subtitle ? <span className="text-[13px] text-[#6b7280]">{o.subtitle}</span> : null}
    </span>
  );
}

export function RadioList({ label, items, value, onPick }: {
  label: string; items: readonly Option[]; value: string | null; onPick: (key: string) => void;
}) {
  if (!items.length) return null;
  const keys = items.map((o) => o.key);
  const onKey = (e: KeyboardEvent<HTMLElement>) => radioKeyDown(e, keys, value && keys.includes(value) ? value : null, onPick);
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKey} className={LIST_CARD}>
      {items.map((o) => {
        const on = o.key === value;
        return (
          <button key={o.key} type="button" role="radio" aria-checked={on} data-radio-key={o.key} data-testid={`own-opt-${o.key}`}
            tabIndex={on || (value === null && o.key === keys[0]) ? 0 : -1} onClick={() => onPick(o.key)} className={ROW}>
            <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? 'border-[#4f46e5]' : 'border-[#9ca3af]'}`}>
              {on ? <span className="h-2.5 w-2.5 rounded-full bg-[#4f46e5]" /> : null}
            </span>
            <Words o={o} />
          </button>
        );
      })}
    </div>
  );
}

export function TickList({ label, allLabel, items, chosen, locked, onChange }: {
  label: string; allLabel: string; items: readonly Option[]; chosen: readonly string[]; locked: readonly string[];
  onChange: (keys: string[]) => void;
}) {
  const inOrder = (keys: readonly string[]) => items.map((o) => o.key).filter((k) => keys.includes(k));
  const toggle = (k: string) => {
    if (locked.includes(k)) return;
    onChange(inOrder(chosen.includes(k) ? chosen.filter((c) => c !== k) : [...chosen, k]));
  };
  return (
    <div className="flex flex-col gap-2">
      {/* A hint that more than one may be ticked (the mockup), never a select-all: she ticks only what she has. */}
      <p className="text-[14px] text-[#6b7280]">{allLabel}</p>
      <div role="group" aria-label={label} className={LIST_CARD}>
        {items.map((o) => {
          const on = chosen.includes(o.key) || locked.includes(o.key);
          const fixed = locked.includes(o.key);
          return (
            <button key={o.key} type="button" role="checkbox" aria-checked={on} aria-disabled={fixed || undefined}
              data-testid={`own-opt-${o.key}`} onClick={() => toggle(o.key)} className={ROW}>
              <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-[12px] font-bold text-white ${on ? `border-[#4f46e5] bg-[#4f46e5]${fixed ? ' opacity-60' : ''}` : 'border-[#9ca3af]'}`}>
                {on ? '✓' : null}
              </span>
              <Words o={o} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
