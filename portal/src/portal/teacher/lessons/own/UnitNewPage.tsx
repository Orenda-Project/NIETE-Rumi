import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import TeacherPage from '../../TeacherPage';
import { useCopy } from '../../i18n';
import { ChoiceChips } from '../../ui';
import { DockButton } from '../../ui/DockButton';
import { FOCUS } from '../../ui/styles';
import { dataOf, useLoad } from '../../../newui/lessons/shared';
import { LoadState } from '../LoadState';
import { RadioList } from './Options';
import { UNIT } from './unitCopy';
import { MAX_CHAPTERS, PACES, PERIODS, createUnit, unitChapters, unitPaces, useLpOwnUnit, type Pace, type PaceCounts } from './unitApi';
import { OWN_UNIT, readUnitNew, unitNewUrl, unitUrl } from './unitPaths';

/**
 * bd-snkn32.59.1 (queue #165, mockups 4 and 5) — a new unit: the first and last chapter of her book (at most 3), her
 * period (her last unit's for this class is chosen first) and the pace, each pace with its day count from the server.
 * "See the days" saves the unit and opens it, where she changes the days. Every pick is in the address.
 */
export function UnitNewPage() {
  const U = useCopy(UNIT);
  const on = useLpOwnUnit();
  const navigate = useNavigate();
  const at = readUnitNew(useLocation().search);
  const [load] = useLoad(at ? () => unitChapters(at.grade, at.subject) : null, at ? `${at.grade}:${at.subject}` : '');
  const book = dataOf(load);
  const [counts, setCounts] = useState<PaceCounts | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const period = at?.period ?? book?.period ?? null;
  const go = (over: Partial<NonNullable<typeof at>>) => at && navigate(unitNewUrl({ ...at, ...over }), { replace: true });

  useEffect(() => {
    setCounts(null);
    if (!at || at.from == null || at.to == null || period == null) return;
    let live = true;
    void unitPaces({ grade: at.grade, subject: at.subject, from: at.from, to: at.to, period }).then((c) => { if (live) setCounts(c); });
    return () => { live = false; };
  }, [at?.grade, at?.subject, at?.from, at?.to, period]); // eslint-disable-line react-hooks/exhaustive-deps

  if (on === false || !at) return <Navigate to={OWN_UNIT} replace />;

  const tap = (n: number) => {
    // First tap: the first chapter. Second tap: the last (either side, at most 3 chapters). A third tap starts again.
    if (at.from == null || at.to != null) return go({ from: n, to: undefined });
    const [lo, hi] = [Math.min(n, at.from), Math.max(n, at.from)];
    return hi - lo + 1 <= MAX_CHAPTERS ? go({ from: lo, to: hi }) : go({ from: n, to: undefined });
  };
  const pace: Pace = at.pace ?? 'recommended';
  const ready = at.from != null && at.to != null && period != null && !!counts && (pace !== 'faster' || counts.faster != null);

  async function make() {
    if (!at || !ready || busy || at.from == null || at.to == null || period == null) return;
    setBusy(true);
    setFailed(false);
    const unit = await createUnit({ grade: at.grade, subject: at.subject, from: at.from, to: at.to, period, pace });
    setBusy(false);
    if (!unit) { setFailed(true); return; }
    navigate(unitUrl(unit.id), { replace: true });
  }

  const paces = PACES.filter((p) => !counts || p !== 'faster' || counts.faster != null).map((p) => ({
    key: p,
    label: counts && counts[p] != null ? U.paceDays(U.paces[p], counts[p] as number) : U.paces[p],
    subtitle: U.paceHints[p],
  }));

  return (
    <TeacherPage crumb={U.wholeUnit} title={U.chapters} backTo={OWN_UNIT} testId="unit-new"
      dock={<DockButton testId="unit-see-days" disabled={!ready || busy} onClick={() => { void make(); }}>{U.seeDays}</DockButton>}>
      <LoadState status={load.status} empty={!!book && !book.chapters.length} onRetry={() => go({})} />
      {book ? (
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <p className="text-[14px] text-[#4b5563]">{U.pickHint}</p>
            <div className="flex flex-col gap-2" data-testid="unit-chapters">
              {book.chapters.map((c) => {
                const inRange = at.from != null && c.number >= at.from && c.number <= (at.to ?? at.from);
                const tag = c.number === at.from ? U.from : c.number === at.to ? U.to : U.bookDays(c.days);
                return (
                  <button key={c.number} type="button" data-testid={`unit-ch-${c.number}`} aria-pressed={inRange} onClick={() => tap(c.number)}
                    className={cn('flex min-h-[56px] items-center gap-3 rounded-2xl border px-4 py-2 text-start', FOCUS,
                      inRange ? 'border-[#4f46e5] bg-[#eef2ff]' : 'border-[#e5e7eb] bg-white')}>
                    <b className="w-14 shrink-0 text-[14px]">{U.chapterN(c.number)}</b>
                    <span dir="auto" className="min-w-0 flex-1 text-[16px] font-semibold">{c.title}</span>
                    <span className="shrink-0 text-[13px] text-[#6b7280]">{tag}</span>
                  </button>
                );
              })}
            </div>
          </section>
          <section className="flex flex-col gap-1">
            <ChoiceChips label={U.periodQ} options={PERIODS.map((m) => ({ key: String(m), label: U.minutes(m) }))}
              value={period != null ? String(period) : null} onChange={(k) => go({ period: Number(k) })} />
            <p className="text-[13px] text-[#6b7280]">{U.periodSaved}</p>
          </section>
          <section className="flex flex-col gap-2" data-testid="unit-paces">
            <h2 className="text-[16px] font-semibold">{U.pace}</h2>
            <RadioList label={U.pace} items={paces} value={pace} onPick={(k) => go({ pace: k as Pace })} />
          </section>
          {failed ? <p role="alert" className="text-[14px] text-[#b91c1c]">{U.couldNotMake}</p> : null}
        </div>
      ) : null}
    </TeacherPage>
  );
}
