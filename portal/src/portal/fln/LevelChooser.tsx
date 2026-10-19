/**
 * bd-t7zk3t.11 — S3b, "Which level?" for grades 6–12 (DESIGN v2 §3, mockup levels_g8_en).
 *
 * The screener comes first, highlighted, with ITS OWN minutes (`levels[].screener_minutes`, e.g. 53 — never an
 * invented "10 min") and its own one-line note (`note_en/ur`), the chip "Answer key audio · teacher only" and no ✓.
 * Reading Hour has one screener for all levels; Numeracy one per level (one card each). Then the three level cards:
 * descriptor, grades the material presumes, the real lesson count, and the screener's group → our level.
 * A level → the same page with ?grade=&level=; the screener → its plan.
 */
import { Link } from 'react-router-dom';
import { useFln } from './FlnContext';
import { FlnNotAvailable, FlnUnavailable } from './FlnGate';
import { bdiRuns } from './Bdi';
import { num, type FlnSubjectKey } from './strings';
import type { FlnLevel } from './types';
import { NEW_LESSON, TopBar, listUrl, planUrl, useCatalogue } from './listShared';

export function LevelChooser({ subject, grade }: { subject: FlnSubjectKey; grade: number }) {
  const { s, lang, dir } = useFln();
  const rtl = dir === 'rtl';
  const [state, retry] = useCatalogue({ grade, subject });

  const top = <TopBar back={NEW_LESSON} backLabel={s.back} title={`${s.grade(grade)}${s.sep}${s.subject[subject]}`} rtl={rtl} />;

  if (state.k === 'error') return <div className="fln-page">{top}<FlnUnavailable lang={lang} onRetry={retry} /></div>;
  if (state.k === 'off') return <div className="fln-page">{top}<FlnNotAvailable lang={lang} /></div>;
  if (state.k === 'loading') {
    return (
      <div className="fln-page" aria-busy="true">
        {top}
        {<>
          <div className="fln-skel fln-skel-title" data-fln-skeleton="chooser" />
          <div className="fln-skel fln-skel-card" />
          <div className="fln-skel fln-skel-card" />
          <div className="fln-skel fln-skel-card" />
          <div className="fln-skel fln-skel-card" />
        </>}
      </div>
    );
  }

  const levels = [...state.cat.levels].sort((a, b) => a.level - b.level);
  // One card per distinct screener, in level order.
  const screeners: FlnLevel[] = [];
  for (const l of levels) if (l.screener_id && !screeners.some((x) => x.screener_id === l.screener_id)) screeners.push(l);
  const perLevel = screeners.length > 1;

  return (
    <div className="fln-page">
      {top}
      <h1 className="fln-h1">{s.chooser.title}</h1>
      <p className="fln-lead">{s.chooser.line}</p>

      {screeners.map((l) => {
        const note = lang === 'ur' ? l.note_ur : l.note_en;
        return (
          <Link key={l.screener_id} to={planUrl(l.screener_id as number)} className="fln-card fln-card-hi" data-fln-screener={l.screener_id}>
            <span className="fln-ic fln-ic-star" aria-hidden="true">★</span>
            <span className="fln-card-body">
              <b>
                {s.chooser.screener}
                {perLevel && <>{s.sep}{s.level(l.level)}</>}
                {l.screener_minutes != null && <>{s.sep}{s.minutes(l.screener_minutes)}</>}
              </b>
              {note && <small className="fln-note">{bdiRuns(note, rtl)}</small>}
              <span className="fln-cs">
                {l.screener_audio ? <span className="fln-mini fln-mini-b">{s.chip.answerKey}</span> : null}
                <span className="fln-mini fln-mini-x">{s.chooser.startHere}</span>
              </span>
            </span>
            <span className="fln-go" aria-hidden="true">{rtl ? '‹' : '›'}</span>
          </Link>
        );
      })}

      <div className="fln-fl">
        {levels.map((l) => (
          <Link key={l.level} to={listUrl(subject, grade, l.level)} className={`fln-card fln-c-${subject}`} data-fln-level={l.level}>
            <span className="fln-ic" aria-hidden="true"><bdi>{num(l.level, lang)}</bdi></span>
            <span className="fln-card-body">
              <b>{s.level(l.level)}{s.sep}{s.levelGrades[l.level]}</b>
              <small>{s.levelDesc[subject][l.level]}{s.sep}{s.lessons(l.count)}</small>
              <small className="fln-map">{s.chooser.groupMap[l.level]}</small>
            </span>
            <span className="fln-go" aria-hidden="true">{rtl ? '‹' : '›'}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default LevelChooser;
