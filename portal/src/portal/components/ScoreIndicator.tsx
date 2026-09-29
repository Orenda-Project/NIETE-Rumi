import { cn } from '@/lib/utils';
import { scoreBandFor, bandLabel, BAND_TONE } from '../lib/scoreBands';

interface ScoreIndicatorProps {
  percentage: number | null | undefined;
  size?: 'small' | 'medium' | 'large';
  /** Kept for call-site compatibility; the band IS the label now. */
  showLabel?: boolean;
}

/**
 * An observation score, shown as its BAND — never the number
 * (operator, 2026-09-29). Every page that used to draw a percentage circle
 * reads through here, so they all switched together.
 */
const ScoreIndicator = ({ percentage, size = 'medium' }: ScoreIndicatorProps) => {
  const band = scoreBandFor(percentage);
  if (!band) return null;

  const sizeClasses = {
    small: 'px-2 py-0.5 text-xs',
    medium: 'px-3 py-1 text-sm',
    large: 'px-4 py-1.5 text-base',
  };

  return (
    <span
      data-testid="score-band"
      data-band={band}
      className={cn(
        'inline-flex items-center rounded-full border font-semibold whitespace-nowrap',
        sizeClasses[size],
        BAND_TONE[band],
      )}
    >
      {bandLabel(band)}
    </span>
  );
};

export default ScoreIndicator;
