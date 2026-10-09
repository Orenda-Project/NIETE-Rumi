import { useEffect, useMemo, useState } from 'react';
import { useCopy } from '../i18n';
import { Link } from 'react-router-dom';
import { ChevronRight, PencilLine, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { findContinue, type ContinueTarget } from '../../newui/training/continue';
import { trainingPaths, useGet, type Level, type Vendor } from '../../newui/training/trainingApi';
import { teacherPath } from '../routes';
import { StatusChip } from '../ui';
import { CARD, FOCUS } from '../ui/styles';
import { TRAINING } from './copy';
import {
  certificateSummary, continueCard, courseTiles, teachingLevels, TRAINING_V2_BASE,
  type Bands, type CertLike, type CourseTile,
} from './model';
import { LoadState, ProviderMark, TrainingPageV2 } from './TrainingFrame';

/**
 * bd-fmf24g.5 — the teacher v2 Training page (v28 canvas Training.dc.html).
 *
 *   Teaching level   flat information under the title: her picked bands (GET /training/bands) as chips,
 *                    then a separate Edit control that opens My profile, where the bands are changed.
 *   Continue         continue.ts decides where (as the new UI's Training): the card names the provider and
 *                    level, with that level's real parts done; the button goes there.
 *   Certificates     the achievement card: how many she has (GET /training/certificates) and the real logos
 *                    of the providers they are from; opens the certificates page.
 *   Courses          a tile per provider: its real logo inside a ring of the vendor's parts done.
 */
const paths = trainingPaths(TRAINING_V2_BASE);

export function TrainingHub() {
  const C = useCopy(TRAINING);
  const vendors = useGet<Vendor[]>('/training/vendors', undefined, (d) => (d as { vendors?: Vendor[] })?.vendors || []);
  const levels = useGet<Level[]>('/training/levels', undefined, (d) => (d as { levels?: Level[] })?.levels || []);
  const certs = useGet<CertLike[]>('/training/certificates', undefined, (d) => (d as { certificates?: CertLike[] })?.certificates || []);
  const bands = useGet<Bands>('/training/bands');

  // undefined while working it out, null when there is nothing to continue.
  const [target, setTarget] = useState<ContinueTarget | null | undefined>(undefined);
  useEffect(() => {
    if (!vendors.data || !levels.data) return undefined;
    let live = true;
    setTarget(undefined);
    findContinue(vendors.data, levels.data, TRAINING_V2_BASE).then((t) => { if (live) setTarget(t); });
    return () => { live = false; };
  }, [vendors.data, levels.data]);

  const loading = vendors.loading || levels.loading;
  const failed = !loading && !!(vendors.error || levels.error);
  const retry = () => { vendors.reload(); levels.reload(); certs.reload(); bands.reload(); };
  const ok = !loading && !failed && !!vendors.data && !!levels.data;
  const nothing = ok && (levels.data?.length ?? 0) === 0;

  const tiles = useMemo(() => (ok ? courseTiles(vendors.data!, levels.data!, paths) : []), [ok, vendors.data, levels.data]);
  const card = ok ? continueCard(target, vendors.data!, levels.data!) : null;
  const summary = certificateSummary(certs.data);
  const levelsShown = teachingLevels(bands.data);

  const context = (
    <div className="flex flex-wrap items-center gap-2" data-testid="training-level-indicator">
      <span className="text-[13px] font-medium text-[#6b7280]">{C.teachingLevel}</span>
      {levelsShown.map((l) => (
        <span key={l} className="inline-flex h-7 items-center rounded-full bg-[#e5e7eb] px-3 text-[13px] font-semibold text-[#374151]">{l}</span>
      ))}
      <Link to={teacherPath('profile')} aria-label={C.editLevel} className={cn('inline-flex min-h-[56px] items-center px-0.5', FOCUS, 'rounded-full')}>
        <span className="inline-flex h-[34px] items-center gap-1.5 rounded-full border-[1.5px] border-[#c7cad6] bg-white px-[13px] text-[13px] font-semibold text-[#33374a]">
          <PencilLine className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
          {C.edit}
        </span>
      </Link>
    </div>
  );

  return (
    <TrainingPageV2 crumb={C.home} title={C.title} backTo={teacherPath('home')} context={context}>
      <LoadState loading={loading} failed={failed} onRetry={retry} />

      {nothing ? <p className="rounded-2xl border border-[#e5e7eb] bg-white p-5 text-center text-[15px] text-[#6b7280]">{C.nothingYet}</p> : null}

      {card ? (
        <section aria-label={C.continue} data-testid="training-continue-card" className="overflow-hidden rounded-[18px] border-2 border-[#33374a] bg-white shadow-[0_4px_14px_rgba(51,55,74,.14)]">
          <Link to={card.to} className={cn('flex items-center gap-3.5 px-3.5 pb-2.5 pt-3.5', FOCUS)}>
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-[#e5e7eb] bg-white">
              <ProviderMark logo={card.logo} initials={card.initials} size={44} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span dir="auto" className="line-clamp-2 text-[20px] font-semibold leading-tight">{C.levelTitle(card.levelNumber, card.levelName) || card.provider}</span>
              <span className="text-[13px] text-[#6b7280]">{card.provider}</span>
            </span>
            <StatusChip text={C.pct(card.pct)} tone="info" />
          </Link>
          <div
            className="relative mx-3.5 mb-3 h-2 overflow-hidden rounded-full bg-[#e5e7eb]"
            role="progressbar" aria-label={C.of(card.partsDone, card.partsTotal)} aria-valuenow={card.pct} aria-valuemin={0} aria-valuemax={100}
          >
            <i className="absolute inset-y-0 start-0 rounded-full bg-[#2f7a52]" style={{ width: `${card.pct}%` }} />
          </div>
          <Link to={card.to} data-testid="training-continue" className={cn('mx-3 mb-3 flex min-h-[56px] items-center justify-center gap-2 rounded-[14px] bg-[#33374a] text-[16px] font-semibold text-white', FOCUS)}>
            <Play className="h-[18px] w-[18px] rtl:rotate-180" fill="currentColor" aria-hidden="true" />
            {C.continue}
          </Link>
        </section>
      ) : null}

      {ok ? (
        <Link
          to={paths.certificates}
          data-testid="training-certificates"
          aria-label={`${C.certificates}, ${C.earned(summary.count)}`}
          className={cn(CARD, 'flex min-h-[84px] items-center gap-3.5 py-3 pe-2.5 ps-3.5', FOCUS)}
        >
          <Medal />
          <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="text-[17px] font-semibold">{C.certificates}</span>
            <span className="text-[13px] text-[#6b7280]">{certs.data ? C.earned(summary.count) : C.noValue}</span>
          </span>
          {summary.providers.length ? (
            <span className="flex shrink-0 items-center" aria-hidden="true">
              {summary.providers.map((p, i) => (
                <span key={p.key} className={cn('flex h-7 w-7 items-center justify-center rounded-[8px] bg-white shadow-[0_0_0_2px_#fff] ring-1 ring-[#e5e7eb]', i > 0 && '-ms-2')}>
                  <ProviderMark logo={p.logo} initials={p.initials} size={22} />
                </span>
              ))}
            </span>
          ) : null}
          <ChevronRight className="h-[22px] w-[22px] shrink-0 text-[#9ca3af] rtl:rotate-180" strokeWidth={2.4} aria-hidden="true" />
        </Link>
      ) : null}

      {tiles.length ? (
        <>
          <h2 className="mx-1 mt-3 flex items-center gap-2 text-[20px] font-light">
            {C.courses}
            <StatusChip text={String(tiles.length)} tone="info" />
          </h2>
          <div className="[display:grid] grid-cols-2 gap-3" data-testid="training-courses">
            {tiles.map((t) => <CourseTileCard key={t.key} tile={t} />)}
          </div>
        </>
      ) : null}
    </TrainingPageV2>
  );
}

function CourseTileCard({ tile: t }: { tile: CourseTile }) {
  const C = useCopy(TRAINING);
  const sub = t.sub?.kind === 'level' ? C.levelOf(t.sub.n, t.sub.of) : t.sub?.kind === 'courses' ? C.coursesOf(t.sub.done, t.sub.total) : null;
  return (
    <Link
      to={t.to}
      data-testid={`training-provider-${t.key}`}
      className={cn(CARD, 'flex min-h-[150px] flex-col items-start justify-between gap-3 rounded-[18px] p-4', FOCUS)}
    >
      <span
        role="img"
        aria-label={t.done ? C.done : C.pct(t.pct)}
        className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full"
        style={{ background: t.done ? '#2f7a52' : `conic-gradient(#2f7a52 0 ${t.pct}%, #e5e7eb ${t.pct}% 100%)` }}
      >
        <span className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white">
          <ProviderMark logo={t.logo} initials={t.initials} size={28} />
        </span>
      </span>
      <span className="flex flex-col items-start gap-1">
        <b className="text-[18px] font-semibold leading-tight">{t.label}</b>
        {t.done ? <StatusChip text={C.done} tone="done" /> : (
          <span className="text-[13px] text-[#6b7280]">{[C.pct(t.pct), sub].filter(Boolean).join(' · ')}</span>
        )}
      </span>
    </Link>
  );
}

/** The achievement mark: a gold medal with two sparkles (one twinkles where motion is allowed). */
function Medal() {
  return (
    <span aria-hidden="true" className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#fdf3d7] text-[#d4a017]">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="9" r="6.5" fill="#fff" />
        <path d="M8.6 14.6 7 22.5l5-3 5 3-1.6-7.9" />
        <path d="m12 5.6 1.05 2.15 2.35.33-1.7 1.65.4 2.35L12 10.98l-2.1 1.1.4-2.35-1.7-1.65 2.35-.33z" fill="currentColor" stroke="none" />
      </svg>
      <i className="absolute -end-[5px] -top-[3px] flex leading-none motion-safe:animate-pulse">
        <svg width="14" height="14" viewBox="0 0 24 24"><path d="M12 0l2.6 9.4L24 12l-9.4 2.6L12 24l-2.6-9.4L0 12l9.4-2.6z" fill="currentColor" /></svg>
      </i>
      <i className="absolute -start-1 bottom-[3px] flex leading-none">
        <svg width="9" height="9" viewBox="0 0 24 24"><path d="M12 0l2.6 9.4L24 12l-9.4 2.6L12 24l-2.6-9.4L0 12l9.4-2.6z" fill="currentColor" /></svg>
      </i>
    </span>
  );
}
