import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tray } from '../../ui/Tray';
import { FOCUS } from '../../ui/styles';
import { useCopy, useLang } from '../../i18n';
import { HelpTrigger } from '../../help/HelpButton';
import { usePrefersReducedMotion } from '../../help/useHelp';
import { DC_GUIDE } from './copy';
import { useDcGuide, type DcGuideData, type DcItem } from './guide';

/**
 * bd-ra8xu.64.3 (queue #282) — the "?" on HER own Digital Coach report (FICO17 v6) and the guide it opens. The operator,
 * 25 Nov: "for DC the ? needs to also be there. However the descriptions, do update them to be for the teacher intended
 * to record themselves. Right now they are more for the HITL personnel."
 *
 *   The "?"    the help circle every "?" wears (HelpTrigger: 40 px in a 56 px target), at the end of the report's header;
 *              ReportPage draws it only on her own DC report scored on v6 (showsDcGuide). It never pulses: her report's
 *              "?" is not the help videos' first-open nudge.
 *   The tray   tall, her heading; the guide's name and the four level names; "Adapted from Dr Rifat Yasmeen's guide";
 *              a row of code chips per section (buttons, no search: 11 fit on one screen); one card per indicator in
 *              the teacher's words, grouped C · D · F. Only the 11 the Digital Coach scores: the 6 a coach sets in the
 *              room are not in the data at all.
 *   A card     who sets it (the Digital Coach, from her recording), what it means, what the Digital Coach listens for,
 *              levels 1–4 each with its example behind "Example" (none where the draft has none), C2's N/A in her
 *              words, and what to try next time. Unlike the observer's card: no manual links (they open the observer
 *              manual) and no "No N/A here" line (it is about scoring).
 *   The data   loads when the tray opens (guide.ts, a dynamic import): grey blocks meanwhile, never a spinner.
 *
 * The observer's guide (help/observe/ObserveHelp.tsx) is left as it is for coaches and principals; this card follows its
 * look so the two read as one family.
 */

const LABEL = 'm-0 mt-2 text-[13px] font-bold text-[#6b7280]';

function DcGuideCard({ guide, item, open, onToggle }: { guide: DcGuideData; item: DcItem; open: boolean; onToggle: () => void }) {
  const D = useCopy(DC_GUIDE);
  const lang = useLang();
  const labels = guide.level_labels[lang];
  return (
    <div data-testid="dc-guide-card" data-code={item.code} id={`dc-guide-card-${item.code}`}
      className="scroll-mt-2 overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
      <button type="button" aria-expanded={open} onClick={onToggle}
        className={cn('flex min-h-[60px] w-full items-center gap-3 px-3 py-2 text-start', FOCUS)}>
        <span dir="ltr" className="flex h-8 min-w-[40px] shrink-0 items-center justify-center rounded-[9px] bg-[#e8e9f0] px-1.5 text-[15px] font-bold text-[#33374a]">{item.code}</span>
        <span className="min-w-0 flex-1 text-[16px] font-semibold leading-snug text-[#1d2025]">{item.name[lang]}</span>
        <ChevronDown className={cn('h-5 w-5 shrink-0 text-[#9ca3af]', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open ? (
        <div className="flex flex-col gap-1 px-3.5 pb-3.5 text-[16px] leading-relaxed text-[#1d2025]">
          {item.who === 'dc' ? <p data-testid="dc-guide-who" className="m-0 text-[13px] font-semibold text-[#33374a]">{D.whoDc}</p> : null}
          <p className={LABEL}>{D.measures}</p>
          <p className="m-0">{item.means[lang]}</p>
          <p className={LABEL}>{D.howScored}</p>
          <p className="m-0 text-[15px] text-[#374151]">{item.how[lang]}</p>
          <p className={LABEL}>{D.levels}</p>
          <ol className="m-0 flex list-none flex-col p-0">
            {item.levels.map((lv) => (
              <li key={lv.n} data-testid="dc-guide-level" className="flex items-start gap-2.5 border-t border-[#f0f1f3] py-2 first:border-t-0">
                <span dir="ltr" className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[1.5px] border-[#33374a] text-[14px] font-bold text-[#33374a]">{lv.n}</span>
                <div className="min-w-0 flex-1">
                  <span className="block text-[12px] font-bold text-[#6b7280]">{labels[String(lv.n)]}</span>
                  <p className="m-0">{lv.text[lang]}</p>
                  {lv.example ? (
                    <details data-testid="dc-guide-example" className="group mt-1">
                      <summary className={cn('flex min-h-[44px] cursor-pointer list-none items-center gap-1 text-[14px] font-semibold text-[#33374a] [&::-webkit-details-marker]:hidden', FOCUS)}>
                        <ChevronRight className="h-4 w-4 group-open:rotate-90 rtl:rotate-180 rtl:group-open:rotate-90" aria-hidden="true" />
                        {D.example}
                      </summary>
                      <p className="m-0 whitespace-pre-line rounded-[6px] border-s-[3px] border-[#33374a] bg-[#f9fafb] px-2.5 py-1.5 text-[15px] text-[#374151]">{lv.example[lang]}</p>
                      {lv.why ? <p className="m-0 mt-1 whitespace-pre-line text-[14px] text-[#4b5563]"><b>{D.why}:</b> {lv.why[lang]}</p> : null}
                    </details>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          {item.na ? (
            <p data-testid="dc-guide-na" className="m-0 mt-1 rounded-[10px] bg-[#f4f5f8] px-2.5 py-2 text-[15px]">
              <b className="block text-[#33374a]">{item.na.title[lang]}</b>{item.na.when[lang]}
            </p>
          ) : null}
          {item.tips.length ? (
            <>
              <p className={LABEL}>{D.watchOut}</p>
              <ul className="m-0 flex list-disc flex-col gap-0.5 ps-5 text-[15px] text-[#374151]">
                {item.tips.map((t, i) => <li key={i}>{t[lang]}</li>)}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** While the guide loads: the shape of what comes (grey blocks, niete-portal §3: no spinner). */
function DcGuidePlaceholder() {
  return (
    <div data-testid="dc-guide-loading" aria-hidden="true" className="flex flex-col gap-2.5">
      {[5, 2, 4].map((n, r) => (
        <div key={r} className="flex gap-1.5">
          {Array.from({ length: n }, (_, i) => <div key={i} className="h-14 w-14 rounded-xl bg-[#eceef2]" />)}
        </div>
      ))}
      <div className="h-[60px] rounded-2xl bg-[#eceef2]" />
      <div className="h-[60px] rounded-2xl bg-[#eceef2]" />
    </div>
  );
}

function DcGuideBody() {
  const D = useCopy(DC_GUIDE);
  const lang = useLang();
  const reduced = usePrefersReducedMotion();
  const loaded = useDcGuide();
  const guide = loaded && loaded !== 'failed' ? loaded : null;
  const [open, setOpen] = useState<string[]>([]);
  const jump = (code: string) => {
    setOpen([code]);
    setTimeout(() => document.getElementById(`dc-guide-card-${code}`)?.scrollIntoView?.({ block: 'start', behavior: reduced ? 'auto' : 'smooth' }), 0);
  };
  const toggle = (code: string) => setOpen((o) => (o.includes(code) ? o.filter((c) => c !== code) : [...o, code]));
  if (loaded === 'failed') return <p data-testid="dc-guide-failed" className="m-0 py-6 text-center text-[16px] text-[#6b7280]">{D.failed}</p>;
  if (!guide) return <DcGuidePlaceholder />;
  return (
    <div className="flex flex-col gap-2.5 pb-2" data-testid="dc-guide">
      <div className="flex flex-col gap-0.5">
        <p className="m-0 text-[13px] leading-relaxed text-[#6b7280]">
          <span className="font-semibold text-[#1d2025] [unicode-bidi:isolate]">{guide.label[lang]}</span>
          {[1, 2, 3, 4].map((n) => <span key={n}> · <b className="text-[#1d2025]">{n}</b> {guide.level_labels[lang][String(n)]}</span>)}
        </p>
        <p data-testid="dc-guide-credit" className="m-0 text-[13px] text-[#6b7280]">{D.credit}</p>
      </div>
      <p className="m-0 text-[14px] font-semibold text-[#4b5563]">{D.indicators}</p>
      <div className="flex flex-col gap-1.5">
        {guide.sections.map((s) => (
          <div key={s.key} className="flex flex-wrap gap-1.5">
            {s.items.map((it) => (
              <button key={it.code} type="button" data-testid="dc-guide-code" dir="ltr" aria-pressed={open.includes(it.code)} onClick={() => jump(it.code)}
                className={cn('h-14 min-w-[56px] rounded-xl border px-1 text-[16px] font-bold',
                  open.includes(it.code) ? 'border-[#33374a] bg-[#33374a] text-white' : 'border-[#e5e7eb] bg-white text-[#33374a]', FOCUS)}>
                {it.code}
              </button>
            ))}
          </div>
        ))}
      </div>
      {guide.sections.map((s) => (
        <section key={s.key} className="flex flex-col gap-2">
          <h3 className="m-0 mt-2 text-[15px] font-bold text-[#33374a]">{s.key} · {s.name[lang]}</h3>
          {s.items.map((it) => (
            <DcGuideCard key={it.code} guide={guide} item={it} open={open.includes(it.code)} onToggle={() => toggle(it.code)} />
          ))}
        </section>
      ))}
    </div>
  );
}

/** The tray the "?" opens. Its body mounts only while open, so the guide's data is fetched on the first open only. */
export function DcGuideTray({ open, onClose }: { open: boolean; onClose: () => void }) {
  const D = useCopy(DC_GUIDE);
  return (
    <Tray open={open} title={D.heading} onClose={onClose} testId="dc-guide-tray" tall>
      <DcGuideBody />
    </Tray>
  );
}

/** The "?" at the end of her report's header, and its tray. */
export function DcGuideButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <HelpTrigger testId="dc-guide-button" fresh={false} onClick={() => setOpen(true)} />
      <DcGuideTray open={open} onClose={() => setOpen(false)} />
    </>
  );
}
