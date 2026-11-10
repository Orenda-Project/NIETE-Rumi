import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChoiceChips } from '../../ui';
import { FOCUS, LIST_CARD } from '../../ui/styles';
import type { OwnCopy } from './copy';
import { changeUrl, type ChangeAt, type Part } from './change';
import type { Way } from './rules';

/**
 * screen 9 of the unified spec: her made plan as section cards, in the plan's order, read from the JSON
 * stored beside the PDF (the PDF stays the source). Each card: its heading (and, 6–12, its I do / We do / You do tag),
 * its way when set, 3 lines then Show all, and "Change this section (N left)" into the change page on that section.
 * After a change the changed card says Changed with Before / After; the rest say Unchanged. No card can be deleted or
 * skipped, and there is no whole-plan card: I do → We do → You do always stays.
 *
 * The 6–12 phase tags are this file's reading of the 6–12 sections (development = I do + We do, activity = You do);
 * the spec leaves 6–12 GRR headings as an open question.
 */
export type Section = { part: Part; text: string; way?: Way; before?: string };
type Phase = 'i_do' | 'we_do' | 'you_do';

const PHASES: Partial<Record<Part, Phase[]>> = { development: ['i_do', 'we_do'], activity: ['you_do'] };
/** The GRR phases a 6–12 section carries (a 1–5 part is its own phase, so no tag). */
export const phaseOf = (part: Part): Phase[] => PHASES[part] ?? [];

export function PlanSections({ C, at, sections, changed = null }: {
  C: OwnCopy; at: ChangeAt; sections: readonly Section[]; changed?: Part | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] font-semibold text-[#33374a]" data-testid="own-grr">{C.grrLine}</p>
      {sections.map((s) => <Card key={s.part} C={C} at={at} s={s} changed={changed} />)}
    </div>
  );
}

function Card({ C, at, s, changed }: { C: OwnCopy; at: ChangeAt; s: Section; changed: Part | null }) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<'before' | 'after'>('after');
  const name = C.partNames[s.part];
  const phase = phaseOf(s.part);
  const mine = changed === s.part;
  const text = mine && side === 'before' && s.before != null ? s.before : s.text;
  const long = text.split('\n').length > 3 || text.length > 180;
  return (
    <section className={`${LIST_CARD} flex flex-col gap-2 px-4 py-3`} data-testid={`own-sec-${s.part}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[16px] font-semibold text-[#111827]">{s.way ? `${name} · ${C.ways[s.way]}` : name}</h2>
        {phase.length ? (
          <span className="rounded-full bg-[#eef2ff] px-2 py-0.5 text-[12px] font-semibold text-[#4338ca]" data-testid={`own-sec-phase-${s.part}`}>
            {phase.map((p) => C.partNames[p]).join(' · ')}
          </span>
        ) : null}
        {changed ? (
          <span className={`ms-auto text-[12px] font-semibold ${mine ? 'text-[#047857]' : 'text-[#6b7280]'}`} data-testid={`own-sec-badge-${s.part}`}>
            {mine ? C.changed : C.unchanged}
          </span>
        ) : null}
      </div>
      {mine && s.before != null ? (
        <ChoiceChips
          label={`${name}: ${C.before} / ${C.after}`} hideLabel
          options={[{ key: 'before', label: C.before }, { key: 'after', label: C.after }]}
          value={side} onChange={(k) => setSide(k as 'before' | 'after')}
        />
      ) : null}
      <p dir="auto" className={`whitespace-pre-line text-[15px] text-[#33374a] ${open ? '' : 'line-clamp-3'}`} data-testid={`own-sec-text-${s.part}`}>{text}</p>
      {long ? (
        <button type="button" onClick={() => setOpen(!open)} className={`self-start text-[14px] font-semibold text-[#4f46e5] ${FOCUS}`} data-testid={`own-sec-more-${s.part}`}>
          {open ? C.showLess : C.showAll}
        </button>
      ) : null}
      {at.left > 0 ? (
        <Link to={changeUrl({ ...at, part: s.part })} className={`min-h-[48px] self-start py-3 text-[15px] font-semibold text-[#4f46e5] ${FOCUS}`} data-testid={`own-sec-change-${s.part}`}>
          {C.changeSection(at.left)}
        </Link>
      ) : null}
    </section>
  );
}
