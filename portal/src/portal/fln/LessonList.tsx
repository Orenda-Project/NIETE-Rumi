/**
 * bd-t7zk3t.11 — S3, a level's lesson list (DESIGN v2 §2 S3 + S5, mockups list_l1_en / list_l1_ur).
 *
 *   sub-header     listSub(level, grades, count) — count from the placement table for this strand (the guide is not
 *                  counted), + "Other levels ▾" (≥48 px) opening the three levels inline
 *   strands        Numeracy's Daily / Weekly · Extended Hour as two tabs when the extended strand exists
 *   rows           chapters as headers, rows in `pos` order; the guide pinned on top, unnumbered; the number shown
 *                  IS `pos` (never an index); title in the plan's own language/dir; chips; minutes; ✓ when opened.
 *                  The screener's chip is the answer key, never a sounds count.
 *   Next           a thin marker on the first unopened numbered row, scrolled into view on first load — unless the
 *                  teacher is coming back from a plan, when the saved scroll position is restored instead
 *   Back           grades 1–5 → the New-lesson page; 6–12 → the level chooser
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useFln } from './FlnContext';
import { FlnNotAvailable, FlnUnavailable } from './FlnGate';
import { bdiRuns } from './Bdi';
import { Chrome } from './plan/text';
import { levelForGrade, num, type FlnSubjectKey, type Strand } from './strings';
import type { FlnChapter, FlnRow } from './types';
import { LEVEL_GRADE, NEW_LESSON, TopBar, isGuideRow, listUrl, planUrl, useCatalogue } from './listShared';

const SCROLL_KEY = 'fln:list-scroll:';

const isGuide = isGuideRow;
const isScreener = (r: FlnRow) => !!r.chips?.screener || r.label === 'screener';

function readScroll(key: string): number | null {
  try {
    const v = window.sessionStorage.getItem(SCROLL_KEY + key);
    if (v == null) return null;
    window.sessionStorage.removeItem(SCROLL_KEY + key);
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
function saveScroll(key: string) {
  try { window.sessionStorage.setItem(SCROLL_KEY + key, String(Math.round(window.scrollY || 0))); } catch { /* storage blocked */ }
}

/** Chapters in order, rows by pos, every guide pinned to the top of the first chapter. */
function arrange(chapters: FlnChapter[]): FlnChapter[] {
  const out = chapters.map((c) => ({ ...c, plans: c.plans.filter((r) => !isGuide(r)).sort((a, b) => a.pos - b.pos) }));
  const guides = chapters.flatMap((c) => c.plans.filter(isGuide));
  if (guides.length && out.length) out[0] = { ...out[0], plans: [...guides, ...out[0].plans] };
  return out.filter((c) => c.plans.length);
}

export function LessonList({ subject, grade, level }: { subject: FlnSubjectKey; grade: number; level?: number | null }) {
  const { s, lang, dir } = useFln();
  const rtl = dir === 'rtl';
  const { pathname, search } = useLocation();
  const own = levelForGrade(grade);
  const want = (level === 1 || level === 2 || level === 3 ? level : own) as 1 | 2 | 3 | null;
  // Grades 1–5 asking for another level than their own read that level's book grade; 6–12 send their level.
  const query = useMemo(() => {
    if (want && own && want !== own) return { subject, grade: LEVEL_GRADE[want], level: want };
    return { subject, grade, level: own ? null : want };
  }, [subject, grade, want, own]);
  const [state, retry] = useCatalogue(query);
  // The grade whose rows this list shows (6–12 read their level's book grade), carried to the plan as ?grade=.
  const rowsGrade = own ? query.grade : want ? LEVEL_GRADE[want] : null;
  const [strand, setStrand] = useState<Strand | null>(null);
  const [others, setOthers] = useState(false);
  const rowRefs = useRef(new Map<number, HTMLAnchorElement>());
  const placed = useRef(false);

  const cat = state.k === 'ok' ? state.cat : null;
  const strands = cat?.strands ?? [];
  const active = strands.find((b) => b.strand === strand) ?? strands[0] ?? null;
  const chapters = useMemo(() => (active ? arrange(active.chapters) : []), [active]);
  const rows = chapters.flatMap((c) => c.plans);
  const nextRow = rows.find((r) => !isGuide(r) && !r.opened) ?? null;
  const lvl = (cat?.level ?? want ?? 1) as 1 | 2 | 3;
  const count = rows.find((r) => !isGuide(r))?.count ?? cat?.levels.find((l) => l.level === lvl)?.count ?? 0;

  // First load: restore the position she left for a plan, else bring "Next" into view.
  useEffect(() => {
    if (!cat || placed.current) return;
    placed.current = true;
    const y = readScroll(pathname + search);
    if (y != null) { window.scrollTo(0, y); return; }
    if (nextRow) rowRefs.current.get(nextRow.id)?.scrollIntoView?.({ block: 'center' });
  }, [cat, nextRow, pathname, search]);

  const back = own ? NEW_LESSON : listUrl(subject, grade);
  const top = <TopBar back={back} backLabel={s.back} title={s.subject[subject]} rtl={rtl} />;

  if (state.k === 'off') return <div className="fln-page">{top}<FlnNotAvailable lang={lang} /></div>;
  if (state.k === 'error') return <div className="fln-page">{top}<FlnUnavailable lang={lang} onRetry={retry} /></div>;
  if (state.k === 'loading' || !cat) {
    return (
      <div className="fln-page" aria-busy="true">
        {top}
        <div className="fln-skel fln-skel-sub" data-fln-skeleton="list" />
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="fln-skel fln-skel-row" />)}
      </div>
    );
  }

  const chips = (r: FlnRow): ReactNode[] => {
    const c = r.chips || {};
    const out: ReactNode[] = [];
    if (isScreener(r)) {
      // The answer-key chip promises audio: only when the screener carries some (Num screeners can have 0 clips).
      if ((c.sounds || 0) + (c.words || 0) > 0 || c.narration) out.push(<span key="ak" className="fln-mini fln-mini-b">{s.chip.answerKey}</span>);
      return out;
    }
    if (c.sounds) out.push(<span key="s" className="fln-mini fln-mini-s">🔊 <Chrome text={s.chip.sounds(c.sounds)} rtl={rtl} /></span>);
    if (c.narration) out.push(<span key="n" className="fln-mini fln-mini-s">▶ {s.chip.narration}</span>);
    if (c.textbook) out.push(<span key="t" className="fln-mini fln-mini-b">{s.chip.textbook}</span>);
    if (c.additional) out.push(<span key="a" className="fln-mini fln-mini-x">{s.chip.additional}</span>);
    if (c.video) out.push(<span key="v" className="fln-mini">{s.chip.video}</span>);
    return out;
  };

  return (
    <div className="fln-page">
      {top}
      <div className="fln-sub">
        <span>{s.listSub(lvl, s.levelGrades[lvl], count)}</span>
        <button type="button" className="fln-chip fln-chip-other" aria-expanded={others} onClick={() => setOthers((o) => !o)}>
          {s.otherLevels} <span aria-hidden="true">▾</span>
        </button>
      </div>
      {others && (
        <div className="fln-levels">
          {([1, 2, 3] as const).map((n) => (
            <Link key={n} to={listUrl(subject, grade, n)} className={`fln-chip${n === lvl ? ' on' : ''}`} aria-current={n === lvl ? 'page' : undefined}>
              {s.level(n)}{s.sep}{s.levelGrades[n]}
            </Link>
          ))}
          {!own && <Link to={listUrl(subject, grade)} className="fln-chip">{s.chooseLevel}</Link>}
        </div>
      )}

      {strands.length > 1 && (
        <div className="fln-tabs" role="tablist">
          {strands.map((b) => (
            <button
              key={b.strand}
              type="button"
              role="tab"
              className="fln-tab"
              aria-selected={b === active}
              onClick={() => setStrand(b.strand)}
            >
              {s.strand[b.strand]}
            </button>
          ))}
        </div>
      )}

      <div className="fln-list" role={strands.length > 1 ? 'tabpanel' : undefined}>
        {chapters.map((ch) => {
          const title = (lang === 'ur' ? ch.title_ur : ch.title_en) || s.chapter(ch.chapter_no);
          return (
            <section key={`${active?.strand}-${ch.chapter_no}`}>
              <h2 className="fln-ch">{bdiRuns(title, rtl)}</h2>
              {ch.plans.map((r) => {
                const guide = isGuide(r);
                const isNext = r === nextRow;
                return (
                  <Link
                    key={r.id}
                    to={planUrl(r.id, rowsGrade)}
                    className={`fln-li${isNext ? ' fln-li-next' : ''}`}
                    data-fln-row={r.id}
                    ref={(el) => { if (el) rowRefs.current.set(r.id, el); else rowRefs.current.delete(r.id); }}
                    onClick={() => saveScroll(pathname + search)}
                  >
                    {guide
                      ? <span className="fln-no fln-no-guide" aria-hidden="true">★</span>
                      : <span className="fln-no" data-fln-no=""><bdi>{num(r.pos, lang)}</bdi></span>}
                    <span className="fln-m">
                      {isNext && <span className="fln-next" data-fln-next="">{s.next}</span>}
                      <b><span lang={r.lang} dir={r.dir}>{bdiRuns(r.title, r.dir === 'rtl')}</span></b>
                      <span className="fln-cs">
                        {chips(r)}
                        <span className="fln-min">⏱ {s.minutes(r.minutes)}</span>
                      </span>
                    </span>
                    {r.opened
                      ? <span className="fln-ok" data-fln-opened="" role="img" aria-label={s.opened}>✓</span>
                      : <span className="fln-ok fln-ok-no" aria-hidden="true" />}
                  </Link>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default LessonList;
