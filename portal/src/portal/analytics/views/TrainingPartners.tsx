import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { TrainingBandSplit, TrainingLevelsResponse } from '../../types/portal';
import type { AnalyticsWords } from '../copy';
import { count } from '../format';
import { TrainingBarChart } from './TrainingBarChart';
import { TrainingLevelCard } from './TrainingLevelCard';
import {
  BEACONHOUSE_LOOK, HER_GREEN, HIGH_COLOR, LEVEL_LOOK, MIDDLE_COLOR, OXBRIDGE_LOOK, ROW_COLOR,
} from './trainingLook';

/**
 * bd-97x22y.4 — her Mid / High "Training Partners" (Trainings.jsx: three partner buttons, each opening its panel):
 *   Oxbridge     her level card, "Teachers per session" (middle / high bars) and "Breakdown by session" with
 *                "Completed all" (OxbridgeFunnelContent.jsx)
 *   NIETE        the (NIETE) Skilled Practitioner and Teacher Leader cards and her per-sector table
 *   Beaconhouse  her level card (with its courses), "Teachers per level" and "Breakdown by level" with "Unique
 *                teachers (any level)"
 * Numbers from GET /analytics/training-levels?band=midhigh (overview.partners, overview.levels, regions).
 */
export type PartnerId = 'oxbridge' | 'niete' | 'beaconhouse';

const PARTNERS: readonly PartnerId[] = ['oxbridge', 'niete', 'beaconhouse'];

const LOOK: Record<PartnerId, string> = { oxbridge: OXBRIDGE_LOOK.color, niete: HER_GREEN, beaconhouse: BEACONHOUSE_LOOK.color };

export function TrainingPartners({ c, data, active, onActive, nieteOrders }: {
  c: AnalyticsWords;
  data: TrainingLevelsResponse;
  active: PartnerId | null;
  onActive: (p: PartnerId | null) => void;
  /** The NIETE levels the Training Level filter leaves (her filter narrows the cards). */
  nieteOrders: number[];
}) {
  const t = c.trainingLevels;
  const p = data.overview.partners;
  const label: Record<PartnerId, string> = { oxbridge: t.partners.oxbridge, niete: t.partners.niete, beaconhouse: t.partners.beaconhouse };
  const summary: Record<PartnerId, string> = {
    oxbridge: p ? t.partners.summary(count(p.oxbridge.passed, c), count(p.oxbridge.inProgress, c)) : '',
    niete: t.partners.nieteSummary,
    beaconhouse: p ? t.partners.summary(count(p.beaconhouse.passed, c), count(p.beaconhouse.inProgress, c)) : '',
  };

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {PARTNERS.map((id) => {
          const on = active === id;
          const color = LOOK[id];
          return (
            <button
              key={id}
              type="button"
              data-testid={`partner-${id}`}
              aria-expanded={on}
              onClick={() => onActive(on ? null : id)}
              className="overflow-hidden rounded-xl text-start transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              style={{ border: `2px solid ${color}`, boxShadow: on ? `0 2px 8px ${color}33` : 'none' }}
            >
              <span className="flex min-h-[48px] items-center justify-between px-4 py-3" style={{ backgroundColor: on ? color : 'transparent' }}>
                <span className="text-sm font-bold" style={{ color: on ? '#fff' : color }}>{label[id]}</span>
                <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${on ? 'rotate-180' : ''}`} style={{ color: on ? '#fff' : color }} />
              </span>
              {!on ? <span data-testid={`partner-summary-${id}`} className="block bg-white px-4 py-3 text-xs text-gray-500">{summary[id]}</span> : null}
            </button>
          );
        })}
      </div>

      {active === 'oxbridge' && p ? <OxbridgePanel c={c} data={data} /> : null}
      {active === 'niete' ? <NietePanel c={c} data={data} orders={nieteOrders} /> : null}
      {active === 'beaconhouse' && p ? <BeaconhousePanel c={c} data={data} /> : null}
    </div>
  );
}

function OxbridgePanel({ c, data }: { c: AnalyticsWords; data: TrainingLevelsResponse }) {
  const t = c.trainingLevels;
  const ox = data.overview.partners!.oxbridge;
  return (
    <div data-testid="partner-panel-oxbridge" className="mt-4 rounded-xl bg-white p-4 sm:p-5" style={{ border: `2px solid ${OXBRIDGE_LOOK.color}`, boxShadow: `0 1px 4px ${OXBRIDGE_LOOK.color}18` }}>
      <div className="mb-5">
        <TrainingLevelCard
          c={c} testId="partner-card-oxbridge" look={OXBRIDGE_LOOK} label={null} name={t.partners.oxbridge}
          passed={ox.passed} inProgress={ox.inProgress} notStarted={ox.notStarted}
          definition={t.partners.oxbridgeDefinition}
        />
      </div>
      <Funnel
        c={c}
        testId="oxbridge"
        chartTitle={t.partners.perSession}
        tableTitle={t.partners.bySession}
        firstColumn={t.partners.columns.session}
        rows={ox.sessions}
        last={{ name: t.partners.completedAll, ...ox.completedAll }}
      />
    </div>
  );
}

function BeaconhousePanel({ c, data }: { c: AnalyticsWords; data: TrainingLevelsResponse }) {
  const t = c.trainingLevels;
  const bh = data.overview.partners!.beaconhouse;
  return (
    <div data-testid="partner-panel-beaconhouse" className="mt-4 rounded-xl bg-white p-4 sm:p-5" style={{ border: `2px solid ${BEACONHOUSE_LOOK.color}`, boxShadow: `0 1px 4px ${BEACONHOUSE_LOOK.color}18` }}>
      <div className="mb-5">
        <TrainingLevelCard
          c={c} testId="partner-card-beaconhouse" look={BEACONHOUSE_LOOK} label={null} name={t.partners.beaconhouse}
          passed={bh.passed} inProgress={bh.inProgress} notStarted={bh.notStarted}
          definition={t.partners.beaconhouseDefinition}
        />
      </div>
      <Funnel
        c={c}
        testId="beaconhouse"
        chartTitle={t.partners.perLevel}
        tableTitle={t.partners.byLevel}
        firstColumn={t.partners.columns.level}
        rows={bh.levels}
        unique={bh.passed}
      />
    </div>
  );
}

/** Her middle / high chart and table under a partner card. */
function Funnel({ c, testId, chartTitle, tableTitle, firstColumn, rows, last, unique }: {
  c: AnalyticsWords;
  testId: string;
  chartTitle: string;
  tableTitle: string;
  firstColumn: string;
  rows: Array<TrainingBandSplit & { name: string }>;
  /** Oxbridge: "Completed all", set apart. */
  last?: TrainingBandSplit & { name: string };
  /** Beaconhouse: unique teachers across its levels. */
  unique?: number;
}) {
  const t = c.trainingLevels.partners;
  const series = [
    { key: 'middle', label: t.columns.middle, color: MIDDLE_COLOR },
    { key: 'high', label: t.columns.high, color: HIGH_COLOR },
  ];
  const byName = new Map(rows.map((r) => [r.name, r]));
  return (
    <div className="mt-4 space-y-5">
      <div>
        <SubTitle>{chartTitle}</SubTitle>
        <TrainingBarChart
          testId={`chart-${testId}`}
          label={chartTitle}
          mode="count"
          legend="circle"
          groups={rows.map((r) => ({ key: r.name, label: r.name }))}
          series={series}
          minWidth={rows.length * 64}
          cell={(g, s) => {
            const v = (byName.get(g)?.[s as 'middle' | 'high']) ?? 0;
            return { value: v, label: '', title: `${g} · ${s === 'middle' ? t.columns.middle : t.columns.high}: ${count(v, c)}` };
          }}
        />
      </div>
      <div>
        <SubTitle>{tableTitle}</SubTitle>
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table data-testid={`table-${testId}`} className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <th scope="col" className="px-4 py-3 text-start font-semibold">{firstColumn}</th>
                <th scope="col" className="px-4 py-3 text-end font-semibold" style={{ color: MIDDLE_COLOR }}>{t.columns.middle}</th>
                <th scope="col" className="px-4 py-3 text-end font-semibold" style={{ color: HIGH_COLOR }}>{t.columns.high}</th>
                <th scope="col" className="px-4 py-3 text-end font-semibold text-gray-700">{t.columns.total}</th>
              </tr>
            </thead>
            <tbody>
              {[...rows, ...(last ? [last] : [])].map((r, i) => {
                const isLast = !!last && r === last;
                return (
                  <tr key={r.name} data-testid={`row-${testId}`} className={`border-t border-gray-100 ${isLast ? 'bg-teal-50 font-semibold' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                    <td className="px-4 py-3 text-gray-800">{r.name}</td>
                    <td className="px-4 py-3 text-end tabular-nums" style={{ color: MIDDLE_COLOR }}>{count(r.middle, c)}</td>
                    <td className="px-4 py-3 text-end tabular-nums" style={{ color: HIGH_COLOR }}>{count(r.high, c)}</td>
                    <td className="px-4 py-3 text-end font-medium tabular-nums text-gray-800">{count(r.total, c)}</td>
                  </tr>
                );
              })}
              {typeof unique === 'number' ? (
                <tr data-testid={`unique-${testId}`} className="border-t-2 border-gray-300 bg-purple-50 font-semibold">
                  <td className="px-4 py-3 text-gray-800">{t.unique}</td>
                  <td colSpan={2} className="px-4 py-3 text-end">
                    <span className="text-xs font-normal text-gray-400">{t.uniqueNote}</span>
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums text-gray-800">{count(unique, c)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function NietePanel({ c, data, orders }: { c: AnalyticsWords; data: TrainingLevelsResponse; orders: number[] }) {
  const t = c.trainingLevels;
  const levels = data.overview.levels.filter((l) => orders.includes(l.levelOrder));
  const name = (order: number) => t.nieteName(data.overview.levels.find((l) => l.levelOrder === order)?.name ?? '');
  return (
    <div data-testid="partner-panel-niete" className="mt-4 space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {levels.map((l) => (
          <TrainingLevelCard
            key={l.levelOrder}
            c={c}
            testId={`level-card-${l.levelOrder}`}
            look={LEVEL_LOOK[l.levelOrder] ?? LEVEL_LOOK[0]}
            label={t.cardLabels[l.levelOrder] ?? null}
            name={t.nieteName(l.name)}
            passed={l.passed}
            inProgress={l.inProgress}
            notStarted={l.notStarted}
            definition={t.definitions[l.levelOrder] ?? null}
          />
        ))}
      </div>
      <div className="rounded-xl bg-white p-4 sm:p-5" style={{ border: `2px solid ${HER_GREEN}`, boxShadow: `0 1px 4px ${HER_GREEN}18` }}>
        <SubTitle>{t.partners.perSector}</SubTitle>
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table data-testid="table-niete" className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <th scope="col" className="px-4 py-3 text-start font-semibold">{t.partners.columns.sector}</th>
                {[2, 3].map((o) => (
                  <th key={o} scope="col" className="px-4 py-3 text-end font-semibold" style={{ color: ROW_COLOR[o] }}>{name(o)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.regions.map((r, i) => (
                <tr key={r.region} data-testid="row-niete" className={`border-t border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                  <td className="px-4 py-3 font-medium text-gray-800">{r.region}</td>
                  {[2, 3].map((o) => (
                    <td key={o} className="px-4 py-3 text-end font-semibold tabular-nums" style={{ color: ROW_COLOR[o] }}>
                      {count(r.levels.find((l) => l.levelOrder === o)?.passed, c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SubTitle({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">{children}</p>;
}
