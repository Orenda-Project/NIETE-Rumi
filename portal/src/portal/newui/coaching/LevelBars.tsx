import { cn } from '@/lib/utils';

const HEIGHTS = [30, 52, 40, 66, 48, 72, 38, 58, 44, 70, 34, 62, 50, 72, 42, 56, 36, 68, 46, 60];

/**
 * bd-5rz1v.26 — the bars that move while she records, so she can see the phone hears the class
 * (today's SoundBars, in the new UI's tokens). Recording red while live — the one place red means
 * recording — and grey and flat when paused. With a live `level` (0..1 from the microphone) the
 * bars follow it; without one (no Web Audio) they move on their own, only when motion is allowed.
 */
export function LevelBars({ live, level }: { live: boolean; level: number | null }) {
  return (
    <div data-testid="record-level-bars" aria-hidden="true" className="flex h-[72px] w-full items-center justify-center gap-[5px]">
      {HEIGHTS.map((h, i) => {
        const height = !live ? 8 : level == null ? h : Math.max(8, Math.round(h * (0.25 + 0.75 * Math.min(1, level * 3))));
        return (
          <span
            key={i}
            className={cn(
              'w-[7px] rounded-[4px]',
              live ? 'bg-nu-record' : 'bg-nu-surface-box',
              live && level == null ? 'motion-safe:animate-sound-level' : 'motion-safe:transition-[height] motion-safe:duration-150',
            )}
            style={{ height, animationDelay: `${((i * 137) % 900) / 1000}s` }}
          />
        );
      })}
    </div>
  );
}
