import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { lessonPlans } from '../../../newui/lessons/lessonPlansApi';
import { dataOf, useLoad } from '../../../newui/lessons/shared';
import { teacherPath } from '../../routes';
import { ChosenSoFar, DockButton, ListRow, StepBar } from '../../ui';
import { FOCUS, LIST_CARD } from '../../ui/styles';
import { useCopy } from '../../i18n';
import TeacherPage from '../../TeacherPage';
import { LoadState } from '../LoadState';
import { LESSONS } from '../copy';
import { lessonsUrl } from '../paths';
import { OWN, type OwnCopy } from './copy';
import {
  FOCI, LEVELS, RESOURCES, SIZES, isComplete, isSecondary, purposesFor, suggestWay, waysFor, type Resource,
} from './rules';
import { nextStep, ownUrl, prevStep, readOwn, stepsFor, toAnswers, type OwnAt } from './state';
import { fetchSloMix, makeOwnPlan, ownable, useLpMakeOwn } from './api';
import { EXTENDS, nextLesson } from './extend';
import type { Refusal } from './change';
import { PagesBox } from './PagesBox';
import { fmtPg, parseLabel, samePages, type PageRange } from './pages';

/**
 * bd-snkn32 — "Make my own" lesson plan (the flow draft, artifact KbsvCwJgs6QWy1DQmGjfzi, screens 3–8): one question
 * per screen, full-width rows, one sticky OK (the WhatsApp-flow form pattern), every answer in the address. Make my
 * plan hands over to the 6-12 Preparing page, whose poll, ready banner and viewer already answer her fork's id.
 *
 * Pages are the chapter's lessons, by their book pages — the draft's fallback where a book has no page images. Grades
 * 1–5 (bd-snkn32.4): step 1 is "Which day?", the chapter's days as the chapter page lists them (no worksheet or
 * revision: there is no day plan to rewrite); the bot rewrites that day's plan in its book's language. Children in class is remembered on this phone (the draft: "she
 * only changes it when it changes"). Dark unless lpMakeOwn: off, this page sends her back to Lesson Plans.
 *
 * bd-snkn32.13 — grades 6–12 also say what the lesson is for, pick from their band's ways, and (Grade 9–12, a lesson
 * whose FBISE SLOs mix Summative and Formative) which outcomes come first.
 */

const SIZE_KEY = 'lp-own-size';
const remembered = (): string | null => { try { return localStorage.getItem(SIZE_KEY); } catch { return null; } };
const remember = (v: string) => { try { localStorage.setItem(SIZE_KEY, v); } catch { /* private window */ } };

export function OwnPage() {
  const s = readOwn(useLocation().search);
  const on = useLpMakeOwn();
  if (!s) return <Navigate to={teacherPath('lessons')} replace />;
  return <Own s={s} on={on} />;
}

function Own({ s, on }: { s: OwnAt; on: boolean | null }) {
  const C = useCopy(OWN);
  const L = useCopy(LESSONS);
  const navigate = useNavigate();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Refusal | 'error' | null>(null);
  const [lessons, retry] = useLoad(() => lessonPlans.lessons(s.grade, s.subject, s.chapter), `l:${s.grade}:${s.subject}:${s.chapter}`);
  const plans = (dataOf(lessons) ?? []).filter(ownable);
  const k5 = plans.some((l) => l.lane === 'k5');
  const dayOf = (l: { number: number | null; title: string }) => (l.number != null ? `${C.dayN(l.number)} · ${l.title}` : l.title);
  const seg = plans.find((l) => l.id === s.seg) ?? null;
  const next = nextLesson(dataOf(lessons) ?? [], s.seg); // bd-snkn32.14 — none on the chapter's last lesson
  // bd-snkn32.17 — a grades 1–5 day's book pages: the day's own, hers (pg), and the next day's to extend to.
  const dayPages = seg?.lane === 'k5' ? parseLabel(seg.pages) : null;
  const nextSeg = seg?.lane === 'k5' ? plans[plans.indexOf(seg) + 1] : undefined;
  const nextPages = nextSeg?.lane === 'k5' ? parseLabel(nextSeg.pages) : null;
  const [pgEdit, setPgEdit] = useState<PageRange | null | undefined>(undefined); // undefined: not touched
  const pgNow = pgEdit === undefined ? (s.pg ?? dayPages) : pgEdit;
  const pgOver = { pg: pgNow && dayPages && !samePages(pgNow, dayPages) ? pgNow : undefined };
  const chapterUrl = lessonsUrl('lessons', { grade: s.grade, subject: s.subject, chapter: s.chapter });
  const go = (over: Partial<OwnAt>) => navigate(ownUrl({ ...s, ...over }), { replace: true });
  const askMix = s.grade >= 9 && !!s.seg;
  const [slo] = useLoad(askMix ? () => fetchSloMix(s.seg as string) : null, `slo:${askMix ? s.seg : ''}`);
  const mix = dataOf(slo);
  const steps = stepsFor({ grade: s.grade, mixed: !!mix?.mixed });
  const back = prevStep(s.step, steps);
  const n = steps.indexOf(s.step) + 1;
  const sizeNow = s.size ?? SIZES.find((x) => x === remembered()) ?? null;
  const suggestion = suggestWay({ grade: s.grade, subject: s.subject, segment: s.seg ?? '', size: s.size, resources: ['textbook', ...s.res], level: s.level, way: null, purpose: s.purpose });
  const wayNow = s.way ?? suggestion.way;

  // Off is a real answer (back to the chapter); unknown is not, so the frame waits for /config.
  if (on === false) return <Navigate to={chapterUrl} replace />;

  const ok = (over: Partial<OwnAt>, enabled: boolean) => (
    <DockButton disabled={!enabled} testId="own-ok" onClick={() => go({ ...over, step: nextStep(s.step, steps) ?? s.step })}>{C.ok}</DockButton>
  );

  async function make() {
    if (!seg || busy) return; // her plan's own lane (6–12 or 1–5) decides what is sent: wait for the list
    setBusy(true);
    setFailed(null);
    const r = await makeOwnPlan(seg, toAnswers(s, note, next?.id ?? null));
    setBusy(false);
    if (!r || !('renderId' in r)) { setFailed(r && 'outcome' in r ? r.outcome : 'error'); return; }
    const id = r.renderId;
    navigate(lessonsUrl('preparing', {
      grade: s.grade, subject: s.subject, chapter: s.chapter, lesson: s.seg, render: id, title: seg?.title ?? C.makeMyOwn,
    }), { replace: true });
  }

  const dock = s.step === 'pages' ? ok(dayPages ? pgOver : {}, !!seg && (!dayPages || pgNow !== null))
    : s.step === 'size' ? ok({ size: sizeNow }, !!sizeNow)
      : s.step === 'resources' ? ok({}, true)
        : s.step === 'level' ? ok({}, !!s.level)
          : s.step === 'purpose' ? ok({}, !!s.purpose)
            : s.step === 'way' ? ok({ way: wayNow }, slo.status !== 'loading') // which step is next waits for the SLO mix
              : s.step === 'focus' ? ok({}, !!s.focus)
                : <DockButton disabled={busy || !seg || !isComplete({ grade: s.grade, subject: s.subject, segment: s.seg ?? '', size: s.size, resources: s.res, level: s.level, way: s.way, purpose: s.purpose })} testId="own-make" onClick={() => { void make(); }}>{failed === 'error' ? C.tryAgain : C.makeMyPlan}</DockButton>;

  return (
    <TeacherPage
      feature="lessons"
      crumb={C.title}
      title={s.step === 'check' ? C.yourPlan : s.step === 'pages' && k5 ? C.day : C[s.step]}
      backTo={back ? ownUrl({ ...s, step: back }) : chapterUrl}
      dock={dock}
      testId={`own-${s.step}`}
    >
      {s.step !== 'check' ? <StepBar total={steps.length - 1} current={n} /> : null}
      {s.step === 'pages' ? (
        <>
          <LoadState status={lessons.status} empty={!plans.length} onRetry={retry} />
          <Rows items={plans.map((l) => (l.lane === 'k5' ? { key: l.id, label: dayOf(l), subtitle: l.pages ?? undefined } : { key: l.id, label: l.pages ?? l.title, subtitle: l.pages ? l.title : undefined }))} chosen={[s.seg]} onPick={(k) => { setPgEdit(undefined); go({ seg: k, pg: undefined, ext: null }); }} />
          {next ? <AddNext C={C} chosen={s.ext ?? null} nextLabel={next.pages ?? next.title} onPick={(ext) => go({ ext })} /> : null}
          {dayPages ? <PagesBox key={s.seg ?? ''} C={C} start={s.pg ?? dayPages} day={dayPages} next={nextPages} onChange={setPgEdit} /> : null}
        </>
      ) : null}
      {s.step === 'size' ? (
        <Rows items={SIZES.map((k) => ({ key: k, label: C.sizes[k] }))} chosen={[sizeNow]} onPick={(k) => { remember(k); go({ size: k as OwnAt['size'] }); }} />
      ) : null}
      {s.step === 'resources' ? (
        <Rows
          items={RESOURCES.map((k) => ({ key: k, label: C.resourceNames[k], subtitle: k === 'objects' ? C.objectsHint : undefined }))}
          chosen={['textbook', ...s.res]}
          onPick={(k) => { if (k !== 'textbook') go({ res: s.res.includes(k as Resource) ? s.res.filter((r) => r !== k) : [...s.res, k as Resource] }); }}
        />
      ) : null}
      {s.step === 'level' ? (
        <Rows items={LEVELS.map((k) => ({ key: k, label: C.levels[k] }))} chosen={[s.level]} onPick={(k) => go({ level: k as OwnAt['level'] })} />
      ) : null}
      {s.step === 'purpose' ? (
        <Rows items={purposesFor(s.grade).map((k) => ({ key: k, label: C.purposes[k] }))} chosen={[s.purpose]} onPick={(k) => go({ purpose: k as OwnAt['purpose'] })} />
      ) : null}
      {s.step === 'way' ? (
        <Rows
          items={[suggestion.way, ...waysFor(s).filter((w) => w !== suggestion.way)].map((k) => ({
            key: k, label: C.ways[k], subtitle: k === suggestion.way ? C.suggested : undefined,
          }))}
          chosen={[wayNow]}
          onPick={(k) => go({ way: k as OwnAt['way'] })}
        />
      ) : null}
      {s.step === 'focus' ? (
        <Rows items={FOCI.map((k) => ({ key: k, label: C.foci[k], subtitle: (mix?.[k] ?? []).join(', ') || undefined }))} chosen={[s.focus]} onPick={(k) => go({ focus: k as OwnAt['focus'] })} />
      ) : null}
      {s.step === 'check' ? (
        <Check s={s} C={C} k5={k5} nextLabel={next && s.ext ? next.pages ?? next.title : null} pagesLabel={seg ? (seg.lane === 'k5' ? `${dayOf(seg)}${s.pg ? ` · ${C.pagesShort(fmtPg(s.pg))}` : ''}` : seg.pages ?? seg.title) : '—'} gradeLabel={L.grade(s.grade)} note={note} setNote={setNote} failed={failed} />
      ) : null}
    </TeacherPage>
  );
}

function Rows({ items, chosen, onPick }: {
  items: Array<{ key: string; label: string; subtitle?: string }>; chosen: Array<string | null>; onPick: (k: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className={LIST_CARD}>
      {items.map((it, i) => (
        <ListRow
          key={it.key}
          variant="row"
          first={i === 0}
          label={it.label}
          subtitle={it.subtitle}
          state={chosen.includes(it.key) ? 'selected' : 'default'}
          onPress={() => onPick(it.key)}
          testId={`own-opt-${it.key}`}
        />
      ))}
    </div>
  );
}

/** bd-snkn32.14 — "Add the next lesson's pages": no (the default), cover more in one period, or a double period. */
function AddNext({ C, chosen, nextLabel, onPick }: {
  C: OwnCopy; chosen: OwnAt['ext'] | null; nextLabel: string; onPick: (ext: OwnAt['ext'] | null) => void;
}) {
  return (
    <section className="flex flex-col gap-1.5" data-testid="own-add-next">
      <h2 className="text-[13px] font-semibold text-[#4b5563]">{C.addNext} · {nextLabel}</h2>
      <Rows
        items={[{ key: 'none', label: C.extendNone }, ...EXTENDS.map((k) => ({ key: k, label: C.extends[k], subtitle: C.extendHints[k] }))]}
        chosen={[chosen ?? 'none']}
        onPick={(k) => onPick(k === 'none' ? null : k as OwnAt['ext'])}
      />
    </section>
  );
}

function Check({ s, C, k5, nextLabel, pagesLabel, gradeLabel, note, setNote, failed }: {
  s: OwnAt; C: OwnCopy; k5: boolean; nextLabel: string | null; pagesLabel: string; gradeLabel: string; note: string; setNote: (v: string) => void; failed: Refusal | 'error' | null;
}) {
  const at = (step: OwnAt['step']) => ownUrl({ ...s, step });
  return (
    <>
      <ChosenSoFar
        items={[
          { label: k5 ? C.dayLabel : C.pages, value: pagesLabel, sub: `${gradeLabel} · ${s.subject}`, to: at('pages') },
          ...(nextLabel && s.ext ? [{ label: C.nextLesson, value: C.extends[s.ext], sub: nextLabel, to: at('pages') }] : []),
          { label: C.size, value: s.size ? C.sizes[s.size] : '—', to: at('size') },
          { label: C.resources, value: ['textbook', ...s.res].map((r) => C.resourceNames[r as Resource]).join(', '), to: at('resources') },
          { label: C.level, value: s.level ? C.levels[s.level] : '—', to: at('level') },
          ...(isSecondary(s.grade) ? [{ label: C.purposeLabel, value: s.purpose ? C.purposes[s.purpose] : '—', to: at('purpose') }] : []),
          { label: C.way, value: s.way ? C.ways[s.way] : '—', to: at('way') },
          ...(s.focus ? [{ label: C.focusLabel, value: C.foci[s.focus], to: at('focus') }] : []),
        ]}
      />
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-[#4b5563]">{C.note} · {C.optional}</span>
        <textarea
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          className={`min-h-[56px] rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3 text-[16px] ${FOCUS}`}
          data-testid="own-note"
        />
      </label>
      {failed ? <p role="alert" className="text-[16px] font-semibold text-[#c8331f]">{failed === 'error' ? C.couldNotMake : C.refusals[failed]}</p> : null}
    </>
  );
}
