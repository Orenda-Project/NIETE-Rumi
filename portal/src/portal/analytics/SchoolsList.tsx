import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AnalyticsWords, SortKey } from './copy';
import { count } from './format';
import { isScoreKey, type ColumnKey } from './metrics';
import { MetricValue } from './Numbers';
import { DEFAULT_SORT, firstDir, nextSort, searchSchools, sortKeysFor, sortSchools, type SchoolRow, type SortState } from './table';

/**
 * bd-s6qbts.3 — every school in the selection (PLAN v3 §4). Desktop: a table, every column sortable. Phone: one card
 * per school and a sort menu. Both searchable by name or EMIS code, both in the same order (table.ts).
 *
 * bd-97x22y.2 — a sector's school breakdown (PLAN v6 §2): the schools of one region, with the tab's own `columns`
 * (LP Engagement: teachers and LPs opened; Coaching: coach visits; …). The region is the breakdown's title, so no
 * region column.
 */
/** Schools drawn at a time (465 in all): a phone gets a short page, and the search still looks through every one. */
export const PAGE_SIZE = 25;

export function SchoolsList({ c, schools, phone, lpOpensNote, columns }: {
  c: AnalyticsWords;
  schools: SchoolRow[];
  phone: boolean;
  lpOpensNote: string | null;
  columns: readonly ColumnKey[];
}) {
  const sortKeys = sortKeysFor(columns);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const shown = useMemo(() => sortSchools(searchSchools(schools, query), sort), [schools, query, sort]);
  // A new search or a new set of schools starts again at the top.
  useEffect(() => { setLimit(PAGE_SIZE); }, [query, schools]);
  const visible = shown.slice(0, limit);

  return (
    // The breakdown around it (Breakdown.tsx) carries the heading: "School breakdown — <region>" and Back.
    <div>
      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <label className="relative block w-full md:max-w-sm">
          <span className="sr-only">{c.schools.search}</span>
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            data-testid="school-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={c.schools.searchHint}
            className="h-11 w-full rounded-xl border border-border bg-white ps-9 pe-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        <p className="flex flex-col gap-0.5 text-xs text-muted-foreground md:items-end">
          <span data-testid="search-count" className="text-sm">{c.schools.count(count(shown.length, c), count(schools.length, c))}</span>
          {columns.some(isScoreKey) ? <span>{c.schools.legendLowN} · {c.schools.legendNone}</span> : null}
        </p>
      </div>

      {phone ? (
        <PhoneCards c={c} schools={visible} sort={sort} onSort={setSort} lpOpensNote={lpOpensNote} columns={columns} sortKeys={sortKeys} />
      ) : (
        <Table c={c} schools={visible} sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} lpOpensNote={lpOpensNote} columns={columns} sortKeys={sortKeys} />
      )}

      {shown.length > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p data-testid="showing" className="text-sm text-muted-foreground">
            {c.schools.showing(count(visible.length, c), count(shown.length, c))}
          </p>
          {visible.length < shown.length && (
            <button
              type="button"
              data-testid="show-more"
              onClick={() => setLimit((n) => n + PAGE_SIZE)}
              className="h-11 rounded-xl border border-border bg-white px-4 text-sm font-semibold text-foreground shadow-sm hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {c.schools.more(count(Math.min(PAGE_SIZE, shown.length - visible.length), c))}
            </button>
          )}
        </div>
      )}

      {shown.length === 0 && (
        <p className="rounded-xl border border-dashed border-border bg-white p-6 text-center text-sm text-muted-foreground">
          {schools.length === 0 ? c.schools.empty : c.schools.none}
        </p>
      )}
    </div>
  );
}

function Name({ s, c }: { s: SchoolRow; c: AnalyticsWords }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span data-testid="school-name" className="font-semibold text-foreground">{s.name}</span>
      {s.emis ? <span data-testid="school-emis" className="text-xs text-muted-foreground">{c.schools.emis(s.emis)}</span> : null}
    </span>
  );
}

function Table({ c, schools, sort, onSort, lpOpensNote, columns, sortKeys }: {
  c: AnalyticsWords;
  schools: SchoolRow[];
  sort: SortState;
  onSort: (k: SortKey) => void;
  lpOpensNote: string | null;
  columns: readonly ColumnKey[];
  sortKeys: readonly SortKey[];
}) {
  const numeric = (k: SortKey) => k !== 'name' && k !== 'region';
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-sm">
      <table data-testid="schools-table" className="w-full min-w-[34rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/60">
            {sortKeys.map((k) => {
              const on = sort.key === k;
              const Icon = on ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
              return (
                <th
                  key={k}
                  scope="col"
                  aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={cn('px-3 py-2.5 align-bottom font-semibold text-foreground', numeric(k) ? 'text-end' : 'text-start')}
                >
                  <button
                    type="button"
                    data-testid={`sort-${k}`}
                    onClick={() => onSort(k)}
                    className={cn('inline-flex items-end gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', numeric(k) ? 'justify-end text-end' : 'text-start')}
                  >
                    <span className="flex flex-col">
                      <span>{c.schools.columns[k]}</span>
                      {c.schools.columnHints[k] ? <span className="whitespace-nowrap text-[11px] font-normal text-muted-foreground">{c.schools.columnHints[k]}</span> : null}
                      {k === 'lpsOpened' && lpOpensNote ? (
                        <span data-testid="lp-opens-note" className="whitespace-nowrap text-[11px] font-normal text-muted-foreground">{lpOpensNote}</span>
                      ) : null}
                    </span>
                    <Icon className={cn('mb-0.5 h-3.5 w-3.5 shrink-0', on ? 'text-foreground' : 'text-muted-foreground/60')} aria-hidden="true" />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {schools.map((s) => (
            <tr key={s.schoolId} data-testid={`school-row-${s.schoolId}`} className="border-b border-border last:border-b-0 hover:bg-secondary/40">
              <th scope="row" data-testid="school-row" className="min-w-[15rem] px-3 py-2.5 text-start align-top font-normal">
                <Name s={s} c={c} />
              </th>
              {columns.map((k) => (
                <td key={k} className="px-3 py-2.5 text-end align-top">
                  <MetricValue k={k} row={s} c={c} testId={`cell-${k}`} className="items-end" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Teachers sits in the card's header beside the name (bd-9vkl9x); the tab's other columns two across under it.
function PhoneCards({ c, schools, sort, onSort, lpOpensNote, columns, sortKeys }: {
  c: AnalyticsWords;
  schools: SchoolRow[];
  sort: SortState;
  onSort: (s: SortState) => void;
  lpOpensNote: string | null;
  columns: readonly ColumnKey[];
  sortKeys: readonly SortKey[];
}) {
  const cardKeys = columns.filter((k) => k !== 'teachers');
  return (
    <>
      <div className="mb-3 flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
          {c.schools.sortBy}
          <select
            data-testid="sort-menu"
            value={sort.key}
            onChange={(e) => {
              const key = e.target.value as SortKey;
              onSort({ key, dir: firstDir(key) });
            }}
            className="h-11 rounded-xl border border-border bg-white px-3 text-sm text-foreground"
          >
            {sortKeys.map((k) => <option key={k} value={k}>{c.schools.columns[k]}</option>)}
          </select>
        </label>
        <button
          type="button"
          data-testid="sort-direction"
          aria-label={c.schools.reverse}
          title={c.schools.reverse}
          onClick={() => onSort({ key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
          className="flex h-11 items-center gap-1.5 rounded-xl border border-border bg-white px-3 text-sm text-foreground"
        >
          {sort.dir === 'asc' ? <ArrowUp className="h-4 w-4" aria-hidden="true" /> : <ArrowDown className="h-4 w-4" aria-hidden="true" />}
          {sort.dir === 'asc' ? c.schools.sortAsc : c.schools.sortDesc}
        </button>
      </div>
      {lpOpensNote && columns.includes('lpsOpened') ? (
        <p data-testid="lp-opens-note" className="mb-3 text-xs text-muted-foreground">{c.metrics.lpsOpened}: {lpOpensNote}</p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {schools.map((s) => (
          <li key={s.schoolId} data-testid="school-card" className="rounded-2xl border border-border bg-white p-4 shadow-sm">
            <div data-testid={`school-card-${s.schoolId}`}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <Name s={s} c={c} />
                {columns.includes('teachers') ? (
                  <span data-testid="cell-teachers" className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {c.scope.teachers(count(s.teachers, c))}
                  </span>
                ) : null}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                {cardKeys.map((k) => (
                  <div key={k} className="flex flex-col">
                    <dt className="text-xs text-muted-foreground">{c.metrics[k]}</dt>
                    <dd><MetricValue k={k} row={s} c={c} long testId={`cell-${k}`} /></dd>
                  </div>
                ))}
              </dl>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
