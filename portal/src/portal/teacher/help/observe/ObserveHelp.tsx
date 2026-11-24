import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, ExternalLink, ListVideo, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tray } from '../../ui/Tray';
import { StatusChip } from '../../ui/StatusChip';
import { FOCUS } from '../../ui/styles';
import { useCopy, useLang } from '../../i18n';
import { useFlowV6 } from '../../../coach/flow/useCoachFlowV2';
import { HELP } from '../copy';
import { markHelpSeen, type HelpVideo } from '../api';
import { useHelp, usePrefersReducedMotion } from '../useHelp';
import { HelpPlayer } from '../HelpButton';
import { HELP_LIST_PATH } from '../names';
import { IndicatorGuideContext, type IndicatorGuide as FormGuide } from '../../../coach/reports/indicatorGuide';
import { BANDS, INDEX, bandOfRubric, hasIndicator, manualHref, matches, useGuide, type Band, type Guide, type GuideItem } from './guides';
import '../help.css';

/**
 * bd-3xf7vb.1 (queue #217) — the "?" on the coach and principal Observe pages (the operator 21 Nov: "in the question mark
 * thingy on top of the observation ... the principal or the coach can click on 1 to 5 or 6 to 12 and understand their
 * indicators ... we do need a video on how to conduct an observation as well"; approved as mocked 21 Nov 22:12).
 *
 *   The "?"     #85's look (a 40px circle in a 56px target at the end of the header), drawn only with the v6 switch on
 *               for her (coachFlowV2 for a coach, principalFlowV2 for a principal: the 3 accounts). It pulses only
 *               where #85's help is on and she has not opened a help video yet.
 *   The tray    the how-to film for feature "observe" when one is up for her (help switch + manifest, added without a
 *               deploy), else nothing in its place (queue #249, the operator 24 Nov: "Remove the Video coming soon text
 *               from the manual guide"); then Indicator guide: Grades 1–5 and Grades 6–12, the visit's own
 *               band first and marked "This visit"; then All videos where #85's help is on.
 *   The guide   opens INSIDE the tray (tall), so a coach mid-way through the Feedback Form never leaves it: the band
 *               switch, Dr Rifat Yasmeen's credit and "Open the full manual" (her live canvas at that part), a chip per
 *               code first (buttons before search, niete-portal §3), a search under them, and one card per indicator
 *               in her words (the operator 23 Nov: "This is the artifact we want to attach as a guide for fico in the
 *               ?"): what it measures, what to look for, who sets it, how it is scored or where to look, levels 1–4
 *               each with its example behind "Example", her watch-outs, the form's N/A, and that indicator in her
 *               manual. The guide's data loads when a band opens (grey blocks meanwhile, never a spinner).
 *   The form    ObserveHelp wraps a whole Observe / observation screen and provides IndicatorGuideContext (bd-o15qnr.37):
 *               the Feedback Form's "Examples" under an indicator opens THAT indicator's card in this tray, the visit's
 *               band, without leaving the form. Switch off: no provider value, so no "Examples" and no "?".
 */

const LABEL = 'm-0 mt-2 text-[13px] font-bold text-[#6b7280]';
const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;

function GuideCard({ guide, item, open, onToggle }: { guide: Guide; item: GuideItem; open: boolean; onToggle: () => void }) {
  const H = useCopy(HELP);
  const lang = useLang();
  const labels = guide.level_labels[lang];
  return (
    <div data-testid={`guide-card-${item.code}`} data-code={item.code} id={`guide-card-${item.code}`}
      className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
      <button type="button" aria-expanded={open} onClick={onToggle}
        className={cn('flex min-h-[60px] w-full items-center gap-3 px-3 py-2 text-start', FOCUS)}>
        <span dir="ltr" className="flex h-8 min-w-[40px] shrink-0 items-center justify-center rounded-[9px] bg-[#e8e9f0] px-1.5 text-[15px] font-bold text-[#33374a]">{item.code}</span>
        <span className="min-w-0 flex-1 text-[16px] font-semibold leading-snug text-[#1d2025]">{item.name[lang]}</span>
        <ChevronDown className={cn('h-5 w-5 shrink-0 text-[#9ca3af] transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open ? (
        <div className="flex flex-col gap-1 px-3.5 pb-3.5 text-[16px] leading-relaxed text-[#1d2025]">
          {item.who ? <p className="m-0 text-[13px] font-semibold text-[#33374a]">{item.who === 'dc' ? H.whoDc : H.whoRoom}</p> : null}
          <p className={LABEL}>{H.measures}</p>
          <p className="m-0">{item.means[lang]}</p>
          {item.lookFor.length ? (
            <>
              <p className={LABEL}>{H.lookFor}</p>
              <ol className="m-0 flex list-decimal flex-col gap-0.5 ps-5">
                {item.lookFor.map((l, i) => <li key={i} data-testid="guide-look-for">{l[lang]}</li>)}
              </ol>
            </>
          ) : null}
          <p className={LABEL}>{item.who ? H.howScored : H.whereToLook}</p>
          <p className="m-0 text-[15px] text-[#374151]">{item.how[lang]}</p>
          <p className={LABEL}>{H.levels}</p>
          <ol className="m-0 flex list-none flex-col p-0">
            {item.levels.map((lv) => (
              <li key={lv.n} data-testid="guide-level" className="flex items-start gap-2.5 border-t border-[#f0f1f3] py-2 first:border-t-0">
                <span dir="ltr" className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[1.5px] border-[#33374a] text-[14px] font-bold text-[#33374a]">{lv.n}</span>
                <div className="min-w-0 flex-1">
                  <span data-testid="guide-level-name" className="block text-[12px] font-bold text-[#6b7280]">{labels[String(lv.n)]}</span>
                  <p className="m-0">{lv.text[lang]}</p>
                  <details data-testid="guide-example" className="group mt-1">
                    <summary className={cn('flex min-h-[44px] cursor-pointer list-none items-center gap-1 text-[14px] font-semibold text-[#33374a] [&::-webkit-details-marker]:hidden', FOCUS)}>
                      <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90 rtl:rotate-180 rtl:group-open:rotate-90" aria-hidden="true" />
                      {H.example}
                    </summary>
                    <p className="m-0 whitespace-pre-line rounded-md border-s-[3px] border-[#33374a] bg-[#f9fafb] px-2.5 py-1.5 text-[15px] text-[#374151]">{lv.example[lang]}</p>
                    <p className="m-0 mt-1 whitespace-pre-line text-[14px] text-[#4b5563]"><b>{H.why}:</b> {lv.why[lang]}</p>
                  </details>
                </div>
              </li>
            ))}
          </ol>
          {item.na ? (
            <p className="m-0 mt-1 rounded-[10px] bg-[#f4f5f8] px-2.5 py-2 text-[15px]">
              <b className="block text-[#33374a]">{item.na.title[lang]}</b>{item.na.when[lang]}
            </p>
          ) : <p className="m-0 mt-1 text-[14px] text-[#4b5563]">{H.noNa}</p>}
          {item.tips.length ? (
            <>
              <p className={LABEL}>{H.watchOut}</p>
              <ul className="m-0 flex list-disc flex-col gap-0.5 ps-5 text-[15px] text-[#374151]">
                {item.tips.map((t, i) => <li key={i}>{t[lang]}</li>)}
              </ul>
            </>
          ) : null}
          <a data-testid="guide-card-manual" href={manualHref(guide.band, item.code)} {...ext}
            className={cn('mt-2 flex min-h-[48px] items-center gap-2 self-start text-[15px] font-semibold text-[#33374a] underline underline-offset-2', FOCUS)}>
            <BookOpen className="h-5 w-5 shrink-0" aria-hidden="true" />{H.inManual}<ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
          </a>
        </div>
      ) : null}
    </div>
  );
}

/** While a guide's data loads: the shape of what comes (grey blocks, niete-portal §3: no spinner). */
function GuidePlaceholder({ n }: { n: number }) {
  return (
    <div data-testid="guide-loading" aria-hidden="true" className="flex flex-col gap-2.5">
      <div className="grid grid-cols-6 gap-1.5">
        {Array.from({ length: n }, (_, i) => <div key={i} className="h-[52px] rounded-xl bg-[#eceef2]" />)}
      </div>
      <div className="h-[52px] rounded-[14px] bg-[#eceef2]" />
      <div className="h-[60px] rounded-2xl bg-[#eceef2]" />
    </div>
  );
}

function IndicatorGuide({ band, focus, onBand, onBack }: {
  band: Band; focus: string | null; onBand: (b: Band) => void; onBack: () => void;
}) {
  const H = useCopy(HELP);
  const lang = useLang();
  const loaded = useGuide(band);
  const guide = loaded && loaded !== 'failed' ? loaded : null;
  // Opened from the form's "Examples": that indicator's card is open and scrolled to (the parent remounts us per open).
  const [open, setOpen] = useState<string[]>(focus ? [focus] : []);
  useEffect(() => {
    if (!focus || !guide) return undefined;
    const t = setTimeout(() => document.getElementById(`guide-card-${focus}`)?.scrollIntoView?.({ block: 'start' }), 0);
    return () => clearTimeout(t);
  }, [focus, guide]);
  const [q, setQ] = useState('');
  const jump = (code: string) => {
    setQ('');
    setOpen([code]);
    setTimeout(() => document.getElementById(`guide-card-${code}`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }), 0);
  };
  const toggle = (code: string) => setOpen((o) => (o.includes(code) ? o.filter((c) => c !== code) : [...o, code]));
  const all = guide ? guide.sections.flatMap((s) => s.items) : [];
  const shown = guide ? guide.sections.map((s) => ({ ...s, items: s.items.filter((it) => matches(it, q)) })).filter((s) => s.items.length) : [];
  return (
    <div className="flex flex-col gap-2.5 pb-2" data-testid="observe-guide">
      <button type="button" onClick={onBack} className={cn('flex min-h-[44px] items-center gap-1 self-start text-[15px] font-semibold text-[#33374a]', FOCUS)}>
        <ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />{H.observeHowTo}
      </button>
      <div role="group" className="flex gap-1 rounded-2xl border border-[#e5e7eb] bg-white p-1">
        {BANDS.map((b) => (
          <button key={b} type="button" aria-pressed={band === b} onClick={() => onBand(b)}
            className={cn('min-h-[52px] flex-1 rounded-xl text-[16px] font-semibold', band === b ? 'bg-[#33374a] text-white' : 'text-[#4b5563]', FOCUS)}>
            {b === '1-5' ? H.grades15 : H.grades612}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="m-0 text-[13px] leading-relaxed text-[#6b7280]">
          <span dir="ltr" className="font-semibold text-[#1d2025] [unicode-bidi:isolate]">{INDEX.bands[band].label.en}</span>
          {guide ? [1, 2, 3, 4].map((n) => <span key={n}> · <b className="text-[#1d2025]">{n}</b> {guide.level_labels[lang][String(n)]}</span>) : null}
        </p>
        {guide ? <p className="m-0 text-[13px] text-[#6b7280]">{guide.credit[lang]}</p> : null}
        <a data-testid="guide-manual" href={manualHref(band)} {...ext}
          className={cn('flex min-h-[48px] items-center gap-2 self-start text-[15px] font-semibold text-[#33374a] underline underline-offset-2', FOCUS)}>
          <BookOpen className="h-5 w-5 shrink-0" aria-hidden="true" />{H.fullManual}<ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
        </a>
      </div>
      {loaded === 'failed' ? (
        <p data-testid="guide-failed" className="m-0 py-6 text-center text-[16px] text-[#6b7280]">{H.guideFailed}</p>
      ) : !guide ? <GuidePlaceholder n={INDEX.bands[band].codes.length} /> : (
        <>
          <p className="m-0 text-[14px] font-semibold text-[#4b5563]">{H.pickIndicator}</p>
          <div className="grid grid-cols-6 gap-1.5">
            {all.map((it) => (
              <button key={it.code} type="button" data-testid="guide-code" dir="ltr" onClick={() => jump(it.code)}
                className={cn('min-h-[52px] rounded-xl border text-[16px] font-bold',
                  open.includes(it.code) ? 'border-[#33374a] bg-[#33374a] text-white' : 'border-[#e5e7eb] bg-white text-[#33374a]', FOCUS)}>
                {it.code}
              </button>
            ))}
          </div>
          <label className="flex min-h-[52px] items-center gap-2 rounded-[14px] border border-[#e5e7eb] bg-white px-3">
            <Search className="h-5 w-5 shrink-0 text-[#6b7280]" aria-hidden="true" />
            <input data-testid="guide-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={H.searchGuide}
              aria-label={H.searchGuide} className="min-w-0 flex-1 border-0 bg-transparent text-[16px] outline-none" />
          </label>
          {shown.length ? shown.map((s) => (
            <section key={s.key} className="flex flex-col gap-2">
              <h3 className="m-0 mt-2 text-[15px] font-bold text-[#33374a]">{s.key} · {s.name[lang]}</h3>
              {s.items.map((it) => (
                <GuideCard key={it.code} guide={guide} item={it} open={open.includes(it.code) || (q.trim() !== '' && s.items.length === 1 && shown.length === 1)} onToggle={() => toggle(it.code)} />
              ))}
            </section>
          )) : <p data-testid="guide-none" className="m-0 py-6 text-center text-[16px] text-[#6b7280]">{H.noIndicator}</p>}
        </>
      )}
    </div>
  );
}

type View = 'menu' | Band;
/** Where the tray opens: the menu, or a band's guide (with one indicator open). `n` remounts the guide on every open. */
type At = { view: View; code: string | null; n: number };

export function ObserveHelpTray({ open, at, onView, onClose, band, video, showList }: {
  open: boolean; at: At; onView: (v: View) => void; onClose: () => void; band?: Band; video: HelpVideo | null; showList: boolean;
}) {
  const H = useCopy(HELP);
  const order: Band[] = band === '6-12' ? ['6-12', '1-5'] : ['1-5', '6-12'];
  const view = at.view;
  return (
    <Tray open={open} title={view === 'menu' ? H.observeHowTo : H.guide} onClose={onClose} testId="observe-help-tray" tall={view !== 'menu'}>
      {view === 'menu' ? (
        <div className="flex flex-col gap-3 pb-2">
          {video ? <HelpPlayer video={video} /> : null}
          <p className={cn('m-0 text-[13px] font-bold uppercase tracking-[0.04em] text-[#6b7280] rtl:normal-case rtl:tracking-normal', video && 'mt-2')}>{H.guide}</p>
          {order.map((b) => (
            <button key={b} type="button" data-testid="observe-guide-row" data-band={b} onClick={() => onView(b)}
              className={cn('flex min-h-[64px] w-full items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white px-3 py-2 text-start', FOCUS)}>
              <span dir="ltr" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#e8e9f0] text-[15px] font-bold text-[#33374a]">{b}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5 text-[17px] font-semibold text-[#1d2025]">
                  {b === '1-5' ? H.grades15 : H.grades612}
                  {band === b ? <StatusChip text={H.thisVisit} tone="done" /> : null}
                </span>
                <span className="block text-[13px] text-[#6b7280]">
                  <span dir="ltr" className="[unicode-bidi:isolate]">{INDEX.bands[b].label.en}</span> · {H.indicators(INDEX.bands[b].codes.length)}
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
            </button>
          ))}
          {showList ? (
            <Link to={HELP_LIST_PATH} onClick={onClose} data-testid="help-all" className={cn('flex min-h-[56px] items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white px-3 text-[16px] font-semibold text-[#1d2025]', FOCUS)}>
              <ListVideo className="h-6 w-6 text-[#33374a]" aria-hidden="true" />
              {H.allVideos}
            </Link>
          ) : null}
        </div>
      ) : (
        <IndicatorGuide key={`${view}-${at.n}`} band={view} focus={at.code} onBand={(b) => onView(b)} onBack={() => onView('menu')} />
      )}
    </Tray>
  );
}

/** What the "?" needs from the screen's ObserveHelp: open the tray, and whether to pulse. undefined = no ObserveHelp above. */
type Ctl = { openAt: (view?: View, code?: string | null) => void; fresh: boolean };
const HelpCtl = createContext<Ctl | null | undefined>(undefined);

/**
 * The "?"'s home for one Observe / observation screen: holds the tray and gives the Feedback Form the guide
 * (IndicatorGuideContext). `band` = the visit's grades when the screen is one visit's. Off the switch it only renders
 * its children, so the screen is exactly today's.
 */
export function ObserveHelp({ band, children }: { band?: Band; children: ReactNode }) {
  const flow = useFlowV6();
  const help = useHelp();
  const on = flow === true;
  const helpOn = help.on === true;
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<At>({ view: 'menu', code: null, n: 0 });
  const openAt = useCallback((view: View = 'menu', code: string | null = null) => {
    setAt((a) => ({ view, code, n: a.n + 1 }));
    setOpen(true);
    if (helpOn) markHelpSeen();
  }, [helpOn]);
  const fresh = helpOn && help.data !== null && !help.seen;
  const ctl = useMemo<Ctl | null>(() => (on ? { openAt, fresh } : null), [on, openAt, fresh]);
  const guide = useMemo<FormGuide | null>(() => (on ? {
    has: (rubric, code) => { const b = bandOfRubric(rubric); return !!b && hasIndicator(b, code); },
    open: (rubric, code) => { const b = bandOfRubric(rubric); if (b) openAt(b, code); },
  } : null), [on, openAt]);
  const video = helpOn ? help.data?.videos.find((v) => v.feature === 'observe') ?? null : null;
  return (
    <HelpCtl.Provider value={ctl}>
      <IndicatorGuideContext.Provider value={guide}>
        {children}
        {on ? (
          <ObserveHelpTray open={open} at={at} onView={(view) => setAt((a) => ({ view, code: null, n: a.n + 1 }))}
            onClose={() => setOpen(false)} band={band} video={video} showList={helpOn} />
        ) : null}
      </IndicatorGuideContext.Provider>
    </HelpCtl.Provider>
  );
}

function HelpCircle() {
  const H = useCopy(HELP);
  const ctl = useContext(HelpCtl);
  const reduced = usePrefersReducedMotion();
  if (!ctl) return null;
  const { fresh } = ctl;
  return (
    <button type="button" aria-label={H.help} data-testid="observe-help-button" onClick={() => ctl.openAt('menu')}
      className={cn('relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full', FOCUS)}>
      {fresh && !reduced ? <span aria-hidden="true" className="niete-help-ring pointer-events-none absolute inset-2 rounded-full border-2 border-[#47ba7d]" /> : null}
      <span className="relative flex h-10 w-10 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-[#33374a]">
        <CircleHelp className="h-[22px] w-[22px]" aria-hidden="true" />
        {fresh && reduced ? <span aria-hidden="true" className="absolute -end-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#47ba7d]" /> : null}
      </span>
    </button>
  );
}

/**
 * The "?" in a screen's header. Inside an ObserveHelp (the two Observe frames) it opens that one's tray; on its own (a
 * principal's Observe home, My observations, Pick the teacher) it brings its own, with `band` for the tray's order.
 * Drawn only with the v6 switch on for her (coachFlowV2 / principalFlowV2: the 3 accounts).
 */
export function ObserveHelpButton({ band }: { band?: Band }) {
  const ctl = useContext(HelpCtl);
  if (ctl === undefined) return <ObserveHelp band={band}><HelpCircle /></ObserveHelp>;
  return <HelpCircle />;
}
