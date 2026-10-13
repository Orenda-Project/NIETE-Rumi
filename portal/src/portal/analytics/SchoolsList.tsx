import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SchoolsAnalyticsSchool } from '../types/portal';
import type { AnalyticsWords, SortKey } from './copy';
import { count } from './format';
import { METRIC_KEYS, type MetricKey } from './metrics';
import { MetricValue } from './Numbers';
import { DEFAULT_SORT, SORT_KEYS, firstDir, nextSort, searchSchools, sortSchools, type SortState } from './table';

/**
 * bd-s6qbts.3 — every school in the selection, the page's primary unit (PLAN v3 §4). Desktop: a table, every column
 * sortable. Phone: one card per school and a sort menu. Both searchable by name or EMIS code, both in the same
 * order (table.ts).
 */
/** Schools drawn at a time (465 in all): a phone gets a short page, and the search still looks through every one. */
export const PAGE_SIZE = 25;

export function SchoolsList({ c, schools, phone, lpOpensNote }: {
  c: AnalyticsWords;
  schools: SchoolsAnalyticsSchool[];
  phone: boolean;
  lpOpensNote: string | null;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const shown = useMemo(() => sortSchools(searchSchools(schools, query), sort), [schools, query, sort]);
  // A new search or a new set of schools starts again at the top.
  useEffect(() => { setLimit(PAGE_SIZE); }, [query, schools]);
  const visible = shown.slice(0, limit);

  return (
    <section aria-labelledby="schools-heading" className="mb-8">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="schools-heading" className="text-lg font-semibold">{c.schools.title}</h2>
        <p data-testid="search-count" className="text-sm text-muted-foreground">
          {c.schools.count(count(shown.length, c), count(schools.length, c))}
        </p>
      </div>

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
        <p className="text-xs text-muted-foreground">
          {c.schools.legendLowN} · {c.schools.legendNone}
        </p>
      </div>

      {phone ? (
        <PhoneCards c={c} schools={visible} sort={sort} onSort={setSort} lpOpensNote={lpOpensNote} />
      ) : (
        <Table c={c} schools={visible} sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} lpOpensNote={lpOpensNote} />
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
    </section>
  );
}

function Name({ s, c }: { s: SchoolsAnalyticsSchool; c: AnalyticsWords }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span data-testid="school-name" className="font-semibold text-foreground">{s.name}</span>
      {s.emis ? <span data-testid="school-emis" className="text-xs text-muted-foreground">{c.schools.emis(s.emis)}</span> : null}
    </span>
  );
}

function RegionTag({ region }: { region: string }) {
  return <span className="inline-block whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-foreground">{region}</span>;
}

function Table({ c, schools, sort, onSort, lpOpensNote }: {
  c: AnalyticsWords;
  schools: SchoolsAnalyticsSchool[];
  sort: SortState;
  onSort: (k: SortKey) => void;
  lpOpensNote: string | null;
}) {
  const numeric = (k: SortKey) => k !== 'name' && k !== 'region';
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-sm">
      <table data-testid="schools-table" className="w-full min-w-[1100px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/60">
            {SORT_KEYS.map((k) => {
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
              <td className="px-3 py-2.5 align-top"><RegionTag region={s.region} /></td>
              {METRIC_KEYS.map((k) => (
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

const CARD_KEYS: readonly MetricKey[] = METRIC_KEYS;

function PhoneCards({ c, schools, sort, onSort, lpOpensNote }: {
  c: AnalyticsWords;
  schools: SchoolsAnalyticsSchool[];
  sort: SortState;
  onSort: (s: SortState) => void;
  lpOpensNote: string | null;
}) {
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
            {SORT_KEYS.map((k) => <option key={k} value={k}>{c.schools.columns[k]}</option>)}
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
      {lpOpensNote ? (
        <p data-testid="lp-opens-note" className="mb-3 text-xs text-muted-foreground">{c.metrics.lpsOpened}: {lpOpensNote}</p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {schools.map((s) => (
          <li key={s.schoolId} data-testid="school-card" className="rounded-2xl border border-border bg-white p-4 shadow-sm">
            <div data-testid={`school-card-${s.schoolId}`}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <Name s={s} c={c} />
                <RegionTag region={s.region} />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                {CARD_KEYS.map((k) => (
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
