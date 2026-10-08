import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { ReportCopy } from './copy';
import { useKitCopy } from './useKitCopy';

/**
 * bd-fmf24g.2.3 — ReportBody (COMPONENTS.md §8): the finished report, for a Digital Coach lesson and a coach visit
 * alike, in the order of the bot's hero-report PNG (report-v2/hero-report.template.js): the indigo hero (eyebrow,
 * N mark, headline, the %, the marks of 52, name · topic · date) → identity line → Your scores (score/max, a bar
 * ≥80 green, ≥60 amber, else coral, a "Why:" line; `na` = Not assessed, no bar) → Moments to remember → Your
 * strength → Your next horizon → From your classroom → Your journey (her scores over her lessons) → Last time we
 * asked → Try next class (green) → From {coach} (notes, her commitment, closing) → footer.
 *
 * A section with no data is left out — that is the whole DC / coach-visit difference (DC: the AI's try-next and
 * "Last time we asked"; coach visit: her own commitment and the coach's section). No sample: the page passes the
 * real report. Photos without an image are left out. Section words: copy.report.
 */

export interface ReportScore {
  code: string;
  label: string;
  score?: number;
  max?: number;
  why?: string;
  /** Not assessed: no bar. */
  na?: boolean;
}

export interface ReportData {
  headline: string;
  marks: number;
  max: number;
  teacher: string;
  topic: string;
  date: string;
  eyebrow?: string;
  identity?: string;
  sections: readonly ReportScore[];
  moment?: { quote: string; why?: string } | null;
  strength?: { title: string; note?: string } | null;
  horizon?: { title: string; note?: string } | null;
  photos?: ReadonlyArray<{ src?: string; cap: string }> | null;
  journey?: { points: readonly number[]; first: string; last: string; note?: string } | null;
  lastAsked?: { text: string; status: string; tone?: 'done' | 'waiting' | 'info'; line?: string } | null;
  tryNext?: string | null;
  debrief?: { heading: string; initials?: string; note?: string; commitment?: string; closing?: string } | null;
}

export interface ReportBodyProps {
  data: ReportData;
  copy?: Partial<ReportCopy>;
  className?: string;
}

const CARD = 'rounded-[18px] border border-[#e5e7eb] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.05)]';
const LABEL = 'm-0 mb-2.5 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[.08em] text-[#6b7280]';
const PILL = 'inline-flex h-6 items-center whitespace-nowrap rounded-full px-[9px] text-[12px] font-bold normal-case tracking-normal';
const PILL_TONE = { done: 'bg-[#eaf6ef] text-[#2f7a52]', waiting: 'bg-[#fef3c7] text-[#b45309]', info: 'bg-[#f3f4f6] text-[#374151]' };
const pct = (s = 0, m = 0) => (m ? Math.round((100 * s) / m) : 0);
const band = (v: number) => (v >= 80 ? 'bg-[#47ba7d]' : v >= 60 ? 'bg-[#e0a52e]' : 'bg-[#dd7a5c]');

function Card({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return <section aria-label={label} className={cn(CARD, className)}>{children}</section>;
}

export function ReportBody({ data: d, copy, className }: ReportBodyProps) {
  const words = { ...useKitCopy().report, ...copy };
  const percent = pct(d.marks, d.max);
  const photos = (d.photos ?? []).filter((p) => !!p.src);
  const first = String(d.teacher || '').split(' ')[0];

  const pts = d.journey?.points ?? [];
  let journey: { line: string; area: string; last: [number, number] } | null = null;
  if (pts.length > 1) {
    const lo = Math.min(...pts) - 8;
    const hi = Math.max(...pts) + 4;
    const xy = pts.map((v, i) => [Math.round(14 + (i * 298) / (pts.length - 1)), Math.round(96 - ((v - lo) * 78) / (hi - lo))] as [number, number]);
    const lastP = xy[xy.length - 1];
    journey = {
      line: xy.map((q) => q.join(',')).join(' '),
      area: `M${xy.map((q) => q.join(',')).join(' L')} L${lastP[0]},100 L${xy[0][0]},100 Z`,
      last: lastP,
    };
  }

  return (
    <div className={cn('flex w-full flex-col gap-3 text-[#1d2025]', className)}>
      <section aria-label={words.report} className="flex flex-col gap-3 rounded-[22px] bg-[#33374a] px-[18px] pb-4 pt-[18px] text-white">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-bold uppercase tracking-[.08em] text-[#a9e3c4]">{d.eyebrow || words.eyebrow}</span>
          <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#47ba7d] text-[15px] font-black text-white">{words.brandMark}</span>
        </div>
        <p className="m-0 text-[21px] font-semibold leading-[1.35]">{d.headline}</p>
        <div className="flex items-baseline gap-2.5">
          <b className="text-[48px] font-extrabold leading-none tracking-[-.02em]">{`${percent}%`}</b>
          <span className="text-[15px] font-semibold text-[#c6e9d5]">{words.marks(d.marks, d.max)}</span>
        </div>
        <div className="border-t border-white/15 pt-2.5 text-[14px] text-[#e2e5ea]">
          <b className="text-white">{d.teacher}</b>{' · '}{d.topic}{' · '}{d.date}
        </div>
      </section>

      {d.identity ? <p className="m-0 px-1.5 py-0.5 text-[16px] italic leading-[1.5] text-[#374151]">{d.identity}</p> : null}

      <Card label={words.scores}>
        <h3 className={LABEL}>
          {words.scores}
          <span className={cn(PILL, PILL_TONE.info)}>{`${percent}%`}</span>
        </h3>
        <div className="flex flex-col gap-3.5">
          {d.sections.map((s) => {
            const v = pct(s.score, s.max);
            return (
              <div key={s.code}>
                <div className="flex items-baseline gap-2">
                  <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] bg-[#eceef2] text-[12px] font-extrabold text-[#33374a]">{s.code}</span>
                  <span className="flex-1 text-[15px] font-semibold">{s.label}</span>
                  {s.na
                    ? <span className="text-[13px] font-semibold text-[#6b7280]">{words.notAssessed}</span>
                    : <span className="text-[15px] font-bold tabular-nums">{`${s.score}/${s.max}`}</span>}
                </div>
                {!s.na ? (
                  <div className="mb-1.5 ms-[30px] mt-[7px] h-2 overflow-hidden rounded-full bg-[#e8ece9]">
                    <span data-testid="score-bar" style={{ width: `${v}%` }} className={cn('block h-full rounded-full', band(v))} />
                  </div>
                ) : null}
                <p className="m-0 ms-[30px] mt-1.5 text-[13px] leading-[1.45] text-[#5a6272]">
                  <b className="text-[#33374a]">{words.why}</b>{' '}{s.why}
                </p>
              </div>
            );
          })}
        </div>
      </Card>

      {d.moment ? (
        <Card label={words.moment}>
          <h3 className={LABEL}>{words.moment}</h3>
          <p className="m-0 rounded-[14px] bg-[#f3faf6] px-3.5 py-3 text-[17px] font-medium leading-[1.5]">{`“${d.moment.quote}”`}</p>
          {d.moment.why ? <p className="m-0 mt-2 text-[14px] leading-[1.5] text-[#5a6272]">{d.moment.why}</p> : null}
        </Card>
      ) : null}

      {d.strength ? (
        <Card label={words.strength}>
          <div className="mb-2.5"><span className={cn(PILL, PILL_TONE.done)}>{words.strength}</span></div>
          <h3 className="m-0 mb-1.5 text-[18px] font-semibold leading-[1.3]">{d.strength.title}</h3>
          {d.strength.note ? <p className="m-0 text-[15px] leading-[1.5] text-[#374151]">{d.strength.note}</p> : null}
        </Card>
      ) : null}

      {d.horizon ? (
        <Card label={words.horizon}>
          <div className="mb-2.5"><span className={cn(PILL, PILL_TONE.info)}>{words.horizon}</span></div>
          <h3 className="m-0 mb-1.5 text-[18px] font-semibold leading-[1.3]">{d.horizon.title}</h3>
          {d.horizon.note ? <p className="m-0 text-[15px] leading-[1.5] text-[#374151]">{d.horizon.note}</p> : null}
        </Card>
      ) : null}

      {photos.length > 0 ? (
        <Card label={words.photos}>
          <h3 className={LABEL}>{words.photos}</h3>
          <div className="[display:grid] grid-cols-2 gap-2.5">
            {photos.slice(0, 2).map((p) => (
              <figure key={p.src} className="m-0 flex flex-col gap-1.5">
                <img src={p.src} alt={p.cap} loading="lazy" className="aspect-[4/3] w-full rounded-xl bg-[#dfe3e8] object-cover" />
                <figcaption className="text-[12.5px] leading-[1.35] text-[#5a6272]">{p.cap}</figcaption>
              </figure>
            ))}
          </div>
        </Card>
      ) : null}

      {journey && d.journey ? (
        <Card label={words.journey}>
          <h3 className={LABEL}>
            {words.journey}
            <span className={cn(PILL, PILL_TONE.info)}>{words.lessons(pts.length)}</span>
          </h3>
          <svg width="100%" height="110" viewBox="0 0 326 110" preserveAspectRatio="none" role="img" aria-label={words.journeyAria(pts.length)} className="block [direction:ltr]">
            <line x1="10" y1="100" x2="316" y2="100" stroke="#e5e7eb" strokeWidth="1" />
            <path d={journey.area} fill="rgba(71,186,125,0.16)" />
            <polyline points={journey.line} fill="none" stroke="#47ba7d" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={journey.last[0]} cy={journey.last[1]} r="5.5" fill="#2f7a52" />
          </svg>
          <div dir="ltr" className="mt-1.5 flex justify-between text-[11px] font-semibold text-[#6b7280]">
            <span>{d.journey.first}</span>
            <span className="text-[#2f7a52]">{`${d.journey.last} · ${pts[pts.length - 1]}%`}</span>
          </div>
          {d.journey.note ? <p className="m-0 mt-2 text-[14px] text-[#5a6272]">{d.journey.note}</p> : null}
        </Card>
      ) : null}

      {d.lastAsked ? (
        <Card label={words.lastAsked}>
          <h3 className={LABEL}>{words.lastAsked}</h3>
          <p className="m-0 mb-2.5 text-[16px] font-semibold leading-[1.4]">{d.lastAsked.text}</p>
          <div className="flex items-center gap-2 text-[14px] text-[#5a6272]">
            <span className={cn(PILL, PILL_TONE[d.lastAsked.tone ?? 'info'] ?? PILL_TONE.info)}>{d.lastAsked.status}</span>
            {d.lastAsked.line}
          </div>
        </Card>
      ) : null}

      {d.tryNext ? (
        <section aria-label={words.tryNext} className="rounded-[18px] bg-[#2f7a52] p-4 text-white">
          <h3 className={cn(LABEL, 'text-[#c6e9d5]')}>{words.tryNext}</h3>
          <p className="m-0 text-[17px] font-semibold leading-[1.45]">{d.tryNext}</p>
        </section>
      ) : null}

      {d.debrief ? (
        <Card label={d.debrief.heading}>
          <div className="mb-2.5 flex items-center gap-2.5">
            {d.debrief.initials ? (
              <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#33374a] text-[13px] font-bold text-white">{d.debrief.initials}</span>
            ) : null}
            <b className="text-[16px]">{d.debrief.heading}</b>
          </div>
          {d.debrief.note ? <p className="m-0 text-[15px] leading-[1.5] text-[#374151]">{d.debrief.note}</p> : null}
          {d.debrief.commitment ? (
            <>
              <h4 className={cn(LABEL, 'mb-0 mt-3.5')}>{words.commitment}</h4>
              <p className="m-0 mt-2 rounded-[14px] bg-[#f3f4f6] px-3.5 py-3 text-[15px] italic leading-[1.45]">{`“${d.debrief.commitment}”`}</p>
            </>
          ) : null}
          {d.debrief.closing ? <p className="m-0 mt-3 text-[14px] text-[#6b7280]">{d.debrief.closing}</p> : null}
        </Card>
      ) : null}

      <div className="flex items-center justify-between px-1 pt-1.5 text-[13px] text-[#6b7280]">
        <span className="flex items-center gap-2 font-bold text-[#33374a]">
          <span aria-hidden="true" className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] bg-[#47ba7d] text-[12px] font-black text-white">{words.brandMark}</span>
          {words.brand}
        </span>
        <span>{words.madeFor(first)}</span>
      </div>
    </div>
  );
}
