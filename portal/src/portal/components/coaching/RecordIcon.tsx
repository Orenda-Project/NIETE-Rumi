import { Mic } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * bd-5rz1v — the red record button's icon: a red dot with a microphone and two
 * ripples spreading out of it, so it reads as "alive" at a glance. Still for
 * anyone who has asked their phone for less motion.
 *
 * `onRed` (bd-5rz1v.7) is the same icon for a red button: a white dot with a red
 * microphone and white ripples.
 */
const RecordIcon = ({ size = 104, onRed = false, className }: { size?: number; onRed?: boolean; className?: string }) => {
  const core = Math.round(size * 0.6);
  const ripple = onRed ? 'bg-[rgba(255,255,255,0.45)]' : 'bg-[rgba(229,57,53,0.45)]';
  return (
    <span
      aria-hidden="true"
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <span className={`absolute inset-0 rounded-full ${ripple} animate-rec-wave motion-reduce:hidden`} />
      <span className={`absolute inset-0 rounded-full ${ripple} animate-rec-wave [animation-delay:1s] motion-reduce:hidden`} />
      <span
        className={cn(
          'relative inline-flex items-center justify-center rounded-full animate-rec-core motion-reduce:animate-none',
          onRed ? 'bg-white shadow-[0_0_0_5px_rgba(255,255,255,0.25)]' : 'bg-[#d32f2f] shadow-[0_0_0_6px_rgba(229,57,53,0.22)]',
        )}
        style={{ width: core, height: core }}
      >
        <Mic className={onRed ? 'text-[#d32f2f]' : 'text-white'} style={{ width: core * 0.48, height: core * 0.48 }} strokeWidth={2.2} />
      </span>
    </span>
  );
};

export default RecordIcon;
