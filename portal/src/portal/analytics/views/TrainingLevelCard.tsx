import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { AnalyticsWords } from '../copy';
import { count } from '../format';
import type { Look } from './trainingLook';

/**
 * bd-97x22y.4 — her TrainingLevelCard.jsx, 1 to 1: a coloured header (icon, the small label, the name, % passed), then
 * Passed / In Progress / Not Started, a progress bar, and "What is this level?" opening her definition — what is
 * covered, or (Beaconhouse) its courses, each opening its modules.
 *
 * Her % is Math.round(passed ÷ (passed + in progress + not started) × 100), 0 when there is nobody.
 */
export interface LevelDefinition {
  short: string;
  full?: string;
  coverage?: ReadonlyArray<readonly [string, string]>;
  courses?: ReadonlyArray<{
    name: string;
    desc: string;
    modules: ReadonlyArray<{ name: string; desc: string; items: ReadonlyArray<{ code: string; desc: string }> }>;
  }>;
}

export function TrainingLevelCard({ c, testId, look, label, name, passed, inProgress, notStarted, definition }: {
  c: AnalyticsWords;
  testId: string;
  look: Look;
  /** The small line above the name (hers: "Beginning Teacher" on level 0; none on the partners). */
  label: string | null;
  name: string;
  passed: number;
  inProgress: number;
  notStarted: number;
  definition: LevelDefinition | null;
}) {
  const [open, setOpen] = useState(false);
  const t = c.trainingLevels;
  const total = passed + inProgress + notStarted;
  const rate = total > 0 ? Math.round((passed / total) * 100) : 0;
  const { Icon } = look;

  return (
    <article
      data-testid={testId}
      data-color={look.color}
      className="min-w-0 overflow-hidden rounded-xl"
      style={{ border: `2px solid ${look.color}`, boxShadow: `0 1px 4px ${look.color}18` }}
    >
      <header className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: look.color }}>
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.20)' }}>
          <Icon className="h-[18px] w-[18px] text-white" />
        </span>
        <span className="min-w-0 flex-1">
          {label ? <span data-testid="level-label" className="block text-xs font-medium text-white opacity-75">{label}</span> : null}
          <span data-testid="level-name" className="block truncate text-sm font-bold leading-tight text-white" title={name}>{name}</span>
        </span>
        <span data-testid="level-pct" data-pct="passed" className="text-xs font-bold text-white opacity-80">{c.percent(String(rate))}</span>
      </header>

      <div className="bg-white px-4 py-4">
        <div className="mb-3 grid grid-cols-3 gap-2">
          <Stat testId="count-passed" value={count(passed, c)} label={t.states.passed} color={look.color} />
          <Stat testId="count-inProgress" value={count(inProgress, c)} label={t.states.inProgress} color="#F59E0B" />
          <Stat testId="count-notStarted" value={count(notStarted, c)} label={t.states.notStarted} color="#D1D5DB" />
        </div>

        <div aria-hidden="true" className="mb-3 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: look.light }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${rate}%`, backgroundColor: look.color }} />
        </div>

        {definition?.short ? (
          <button
            type="button"
            data-testid="level-what"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex min-h-[32px] w-full items-center gap-1.5 text-start text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ color: look.color }}
          >
            <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            {open ? t.hideWhatIs : t.whatIs}
          </button>
        ) : null}

        {open && definition ? <Definition c={c} look={look} definition={definition} /> : null}
      </div>
    </article>
  );
}

function Stat({ testId, value, label, color }: { testId: string; value: string; label: string; color: string }) {
  return (
    <div className="text-center">
      <p data-testid={testId} className="text-2xl font-bold leading-none tabular-nums" style={{ color }}>{value}</p>
      <p className="mt-1 text-xs text-gray-400">{label}</p>
    </div>
  );
}

function Definition({ c, look, definition }: { c: AnalyticsWords; look: Look; definition: LevelDefinition }) {
  const t = c.trainingLevels;
  return (
    <div data-testid="level-definition" className="mt-3 space-y-3 border-t border-gray-100 pt-3">
      <p className="text-xs leading-relaxed text-gray-600">{definition.short}</p>
      {definition.full ? <p className="text-xs italic leading-relaxed text-gray-500">{definition.full}</p> : null}
      {definition.coverage && definition.coverage.length ? (
        <div className="rounded-lg p-3" style={{ backgroundColor: look.light }}>
          <p className="mb-2 text-xs font-bold uppercase tracking-wider" style={{ color: look.color }}>{t.covered}</p>
          <div className="space-y-1.5">
            {definition.coverage.map(([code, text]) => (
              <div key={code} className="flex gap-2">
                <span className="min-w-fit text-xs font-bold" style={{ color: look.color }}>{code}</span>
                <span className="text-xs leading-relaxed text-gray-600">{text}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {definition.courses && definition.courses.length ? (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: look.color }}>{t.partners.courses}</p>
          {definition.courses.map((course) => <Course key={course.name} course={course} look={look} />)}
        </div>
      ) : null}
    </div>
  );
}

function Course({ course, look }: { course: NonNullable<LevelDefinition['courses']>[number]; look: Look }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="level-course" className="overflow-hidden rounded-lg border" style={{ borderColor: `${look.color}40` }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        style={{ backgroundColor: `${look.color}0a` }}
      >
        <span className="min-w-0">
          <span className="block text-xs font-bold" style={{ color: look.color }}>{course.name}</span>
          <span className="mt-0.5 block text-xs leading-snug text-gray-500">{course.desc}</span>
        </span>
        <ChevronDown aria-hidden="true" className={`ms-2 h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: look.color }} />
      </button>
      {open ? (
        <div className="divide-y divide-gray-100" style={{ borderTop: `1px solid ${look.color}20` }}>
          {course.modules.map((mod) => (
            <div key={mod.name} className="px-3 py-3">
              <p className="mb-0.5 text-xs font-semibold text-gray-800">{mod.name}</p>
              <p className="mb-2 text-xs leading-snug text-gray-500">{mod.desc}</p>
              <div className="space-y-1 rounded p-2" style={{ backgroundColor: look.light }}>
                {mod.items.map((item) => (
                  <div key={item.code + item.desc} className="flex gap-2 text-xs">
                    <span className="w-10 shrink-0 font-bold" style={{ color: look.color }}>{item.code}</span>
                    <span className="text-gray-600">{item.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
