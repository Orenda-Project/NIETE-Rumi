const HEIGHTS = [30, 52, 40, 66, 48, 72, 38, 58, 44, 70, 34, 62, 50, 72, 42, 56, 36, 68, 46, 60, 32, 54, 40, 48];

/**
 * bd-5rz1v — the bars that move while she records, so she can see the phone is
 * hearing the class. With a live `level` (0..1, from the microphone) the bars
 * follow it; without one (no Web Audio) they move on their own. Flat when paused.
 */
const SoundBars = ({ live, level }: { live: boolean; level: number | null }) => (
  <div aria-hidden="true" className="flex h-[72px] w-full items-center justify-center gap-[5px]">
    {HEIGHTS.map((h, i) => {
      const height = !live ? 8 : level == null ? h : Math.max(8, Math.round(h * (0.25 + 0.75 * Math.min(1, level * 3))));
      return (
        <span
          key={i}
          className={live && level == null ? 'animate-sound-level motion-reduce:animate-none' : 'transition-[height] duration-150'}
          style={{
            width: 7,
            height,
            borderRadius: 4,
            background: live ? '#d32f2f' : '#c4c8cf',
            animationDelay: `${((i * 137) % 900) / 1000}s`,
          }}
        />
      );
    })}
  </div>
);

export default SoundBars;
