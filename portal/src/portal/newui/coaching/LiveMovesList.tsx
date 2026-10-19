import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useCopy } from '../../teacher/i18n';
import type { LiveState, MoveView } from '../../lib/live/liveMovesState';
import type { TeeStatus } from '../../lib/live/sonioxTee';
import type { LiveMoves } from './useLiveMoves';
import { MoveTapSheet } from './MoveTapSheet';
import { LIVE_COPY } from './liveCopy';

/**
 * bd-v0toag.31 — the step list a group D teacher sees while she records (live-moves-layout.html, option A):
 * the caveat, each section with its minutes, then ✓ done (green mark, grey text), ▶ now (amber, with what
 * to say) or ○ to come. Ticks only ever say done: there is no "missed" and no red. Any move can be tapped.
 */

type Mark = 'done' | 'now' | 'later';
const markOf = (m: MoveView, now: number | null): Mark => (m.ticked ? 'done' : m.idx === now ? 'now' : 'later');
const ICON: Record<Mark, string> = { done: '✓', now: '▶', later: '○' };
const ROW: Record<Mark, string> = {
  done: 'text-nu-surface-muted',
  now: 'bg-nu-chip-warning-bg border-s-4 border-s-nu-button-warning',
  later: 'text-nu-surface-text',
};

export function LiveMovesList({ state, now, status, onTap }: {
  state: LiveState;
  now: number | null;
  status: TeeStatus;
  onTap: (idx: number) => void;
}) {
  const L = useCopy(LIVE_COPY);
  const names = L.sections as Record<string, string>;
  return (
    <section data-testid="live-moves" className="overflow-hidden rounded-2xl border-[1.5px] border-nu-surface-line bg-nu-surface-card">
      <p className="px-3 py-2 text-[13px] text-nu-surface-text">{L.caveat}</p>
      {status !== 'live' ? <p data-testid="live-moves-paused" className="px-3 pb-2 text-[13px] font-semibold text-nu-chip-warning">{L.paused}</p> : null}
      {state.sections.map((sec) => (
        <div key={sec.sec}>
          <div className="bg-nu-ink-xlight px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wide text-nu-surface-muted">
            {`${names[sec.sec] ?? sec.sec} · ${L.minutes(sec.minutes)}`}
          </div>
          {state.moves.filter((m) => m.sec === sec.sec).map((m) => {
            const mark = markOf(m, now);
            return (
              <button
                key={m.idx}
                type="button"
                data-testid={`live-move-${m.idx}`}
                data-mark={mark}
                onClick={() => onTap(m.idx)}
                className={cn('flex w-full gap-2 border-b border-nu-surface-line px-3 py-2.5 text-start text-[14px]', ROW[mark])}
              >
                <span aria-hidden="true" className={cn('w-5 flex-none text-center font-bold', mark === 'done' && 'text-nu-done')}>{ICON[mark]}</span>
                <span className="flex flex-col">
                  <span>{m.do}</span>
                  {mark === 'now' && m.say ? <span className="italic text-nu-surface-text">{`“${m.say}”`}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </section>
  );
}

/** The list wired to the hook: a tap opens her choice, the choice goes to `tap`. Nothing without a card. */
export function LiveMovesPanel({ live }: { live: Pick<LiveMoves, 'state' | 'now' | 'status' | 'tap'> }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!live.state) return null;
  const move = open === null ? null : live.state.moves.find((m) => m.idx === open) ?? null;
  return (
    <>
      <LiveMovesList state={live.state} now={live.now} status={live.status} onTap={setOpen} />
      {move ? (
        <MoveTapSheet
          ticked={move.ticked}
          onChoose={(c) => { live.tap(move.idx, c); setOpen(null); }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}
