/**
 * ICT sheet, Assessment Generator rows 6-7 (bd-zrdvmi.24): the editor's live summary of the paper as it stands —
 * Bloom's levels as shares, and question types. Only when some question carries a level, so papers made before the
 * bot tagged levels keep the editor they had. Editor-only: the printed paper is the bot's and never shows this.
 */
import { useCopy } from '../i18n';
import { ASSESSMENT } from './copy';
import { editSummary, type SummaryRow } from './editSummary';
import { Chip } from './ui';

export function EditSummaryCard({ rows }: { rows: SummaryRow[] }) {
  const C = useCopy(ASSESSMENT);
  const s = editSummary(rows);
  if (!s.levels.length) return null;
  return (
    <div data-testid="edit-summary" className="space-y-2 rounded-2xl bg-white p-3.5">
      <p className="text-[13px] font-bold uppercase tracking-[.04em] text-[#6b7280]">{C.levelsTitle}</p>
      <div className="flex flex-wrap gap-1.5">
        {s.levels.map((l) => <Chip key={l.level ?? '-'}>{C.share(l.level ? C.bloom(l.level) : C.noLevel, l.pct)}</Chip>)}
      </div>
      <p className="text-[13px] font-bold uppercase tracking-[.04em] text-[#6b7280]">{C.typesTitle}</p>
      <div className="flex flex-wrap gap-1.5">
        {s.types.map((t) => <Chip key={t.type}>{C.typeTally(t.type, t.count)}</Chip>)}
      </div>
    </div>
  );
}
