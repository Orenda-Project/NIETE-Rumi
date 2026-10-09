import { TrendChart } from '../ui/TrendChart';
import { BAND_ROWS, type TrendPoint } from './model';

/**
 * bd-fmf24g.8 — Rating over time on the five BAND rows (Excellent on top), never a number: one dot per rated observation,
 * oldest on the left, joined by a line. bd-4404s7.1: the drawing is the kit's TrendChart (band-rows mode), shared with the
 * coach's score chart; this keeps the Analytics call site as it was.
 */
export function BandChart({ points, label, dateLabel, rows = BAND_ROWS, colour }: { points: TrendPoint[]; label: string; dateLabel: (iso: string) => string; rows?: ReadonlyArray<{ key: string; label: string }>; colour?: string }) {
  return <TrendChart points={points.map((p) => ({ date: p.date, row: p.row }))} rows={rows} label={label} dateLabel={dateLabel} colour={colour} />;
}
