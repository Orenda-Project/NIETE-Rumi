/**
 * ICT sheet, Assessment Generator rows 6-7 (bd-zrdvmi.24): the editor's live summary of the paper as it stands —
 * Bloom's levels as shares, and question types. Only when some question carries a level, so papers made before the
 * bot tagged levels keep the editor they had. Editor-only: the printed paper is the bot's and never shows this.
 */
import { useCopy } from '../i18n';
import { ASSESSMENT } from './copy';
import { editSummary, type SummaryRow } from './editSummary';
import { fdeGuide, marksMix } from './fdeLevelGuide';
import { Chip } from './ui';

type Row = SummaryRow & { marks?: number | null };

export function EditSummaryCard({ rows, grade, subject }: { rows: Row[]; grade?: number | null; subject?: string | null }) {
  const C = useCopy(ASSESSMENT);
  const s = editSummary(rows);
  if (!s.levels.length) return null;
  // Row 7 point 7: FDE's expected mix (shares of marks, three bands) beside this paper's own, by marks. Guidance only.
  const guide = fdeGuide(grade, subject);
  const mine = guide ? marksMix(rows) : null;
  const bands = ['Remember', 'Understand', 'Apply'] as const;
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
      {guide && (
        <>
          <div data-testid="fde-target" className="space-y-2">
            <p className="text-[13px] font-bold uppercase tracking-[.04em] text-[#6b7280]">{C.fdeTarget}</p>
            <div className="flex flex-wrap gap-1.5">
              {bands.map((b) => <Chip key={b}>{C.share(C.bloom(b), guide[b])}</Chip>)}
            </div>
          </div>
          {mine && (
            <>
              <p className="text-[13px] font-bold uppercase tracking-[.04em] text-[#6b7280]">{C.paperByMarks}</p>
              <div data-testid="paper-mix" className="flex flex-wrap gap-1.5">
                {bands.map((b) => <Chip key={b}>{C.share(C.bloom(b), mine[b])}</Chip>)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
