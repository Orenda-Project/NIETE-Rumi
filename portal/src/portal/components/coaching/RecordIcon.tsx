import { Mic } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * bd-5rz1v — the red record button's icon: a red dot with a microphone and two
 * ripples spreading out of it, so it reads as "alive" at a glance. Still for
 * anyone who has asked their phone for less motion.
 */
const RecordIcon = ({ size = 104, className }: { size?: number; className?: string }) => {
  const core = Math.round(size * 0.6);
  return (
    <span
      aria-hidden="true"
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <span className="absolute inset-0 rounded-full bg-[rgba(229,57,53,0.45)] animate-rec-wave motion-reduce:hidden" />
      <span className="absolute inset-0 rounded-full bg-[rgba(229,57,53,0.45)] animate-rec-wave [animation-delay:1s] motion-reduce:hidden" />
      <span
        className="relative inline-flex items-center justify-center rounded-full bg-[#d32f2f] shadow-[0_0_0_6px_rgba(229,57,53,0.22)] animate-rec-core motion-reduce:animate-none"
        style={{ width: core, height: core }}
      >
        <Mic className="text-white" style={{ width: core * 0.48, height: core * 0.48 }} strokeWidth={2.2} />
      </span>
    </span>
  );
};

export default RecordIcon;
