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
import { LEVELS, RESOURCES, SIZES, isComplete, suggestWay, waysFor, type Resource } from './rules';
import { OWN_STEPS, nextStep, ownUrl, prevStep, readOwn, toAnswers, type OwnAt } from './state';
import { makeOwnPlan, useLpMakeOwn } from './api';

/**
 * bd-snkn32 — "Make my own" lesson plan (the flow draft, artifact KbsvCwJgs6QWy1DQmGjfzi, screens 3–8): one question
 * per screen, full-width rows, one sticky OK (the WhatsApp-flow form pattern), every answer in the address. Make my
 * plan hands over to the 6-12 Preparing page, whose poll, ready banner and viewer already answer her fork's id.
 *
 * Grades 6–12 only (the rewrite starts from a 6-12 plan). Pages are the chapter's lessons, by their book pages — the
 * draft's fallback where a book has no page images. Children in class is remembered on this phone (the draft: "she
 * only changes it when it changes"). Dark unless lpMakeOwn: off, this page sends her back to Lesson Plans.
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
  const [failed, setFailed] = useState(false);
  const [lessons, retry] = useLoad(() => lessonPlans.lessons(s.grade, s.subject, s.chapter), `l:${s.grade}:${s.subject}:${s.chapter}`);
  const plans = (dataOf(lessons) ?? []).filter((l) => l.lane === 'g612' && l.kind === 'lesson');
  const seg = plans.find((l) => l.id === s.seg) ?? null;
  const chapterUrl = lessonsUrl('lessons', { grade: s.grade, subject: s.subject, chapter: s.chapter });
  const go = (over: Partial<OwnAt>) => navigate(ownUrl({ ...s, ...over }), { replace: true });
  const back = prevStep(s.step);
  const n = OWN_STEPS.indexOf(s.step) + 1;
  const sizeNow = s.size ?? SIZES.find((x) => x === remembered()) ?? null;
  const suggestion = suggestWay({ grade: s.grade, subject: s.subject, segment: s.seg ?? '', size: s.size, resources: ['textbook', ...s.res], level: s.level, way: null });
  const wayNow = s.way ?? suggestion.way;

  // Off is a real answer (back to the chapter); unknown is not, so the frame waits for /config.
  if (on === false) return <Navigate to={chapterUrl} replace />;

  const ok = (over: Partial<OwnAt>, enabled: boolean) => (
    <DockButton disabled={!enabled} testId="own-ok" onClick={() => go({ ...over, step: nextStep(s.step) ?? s.step })}>{C.ok}</DockButton>
  );

  async function make() {
    if (!s.seg || busy) return;
    setBusy(true);
    setFailed(false);
    const id = await makeOwnPlan(s.seg, toAnswers(s, note));
    setBusy(false);
    if (!id) { setFailed(true); return; }
    navigate(lessonsUrl('preparing', {
      grade: s.grade, subject: s.subject, chapter: s.chapter, lesson: s.seg, render: id, title: seg?.title ?? C.makeMyOwn,
    }), { replace: true });
  }

  const dock = s.step === 'pages' ? ok({}, !!seg)
    : s.step === 'size' ? ok({ size: sizeNow }, !!sizeNow)
      : s.step === 'resources' ? ok({}, true)
        : s.step === 'level' ? ok({}, !!s.level)
          : s.step === 'way' ? ok({ way: wayNow }, true)
            : <DockButton disabled={busy || !isComplete({ grade: s.grade, subject: s.subject, segment: s.seg ?? '', size: s.size, resources: s.res, level: s.level, way: s.way })} testId="own-make" onClick={() => { void make(); }}>{failed ? C.tryAgain : C.makeMyPlan}</DockButton>;

  return (
    <TeacherPage
      feature="lessons"
      crumb={C.title}
      title={s.step === 'check' ? C.yourPlan : C[s.step]}
      backTo={back ? ownUrl({ ...s, step: back }) : chapterUrl}
      dock={dock}
      testId={`own-${s.step}`}
    >
      {s.step !== 'check' ? <StepBar total={5} current={n} /> : null}
      {s.step === 'pages' ? (
        <>
          <LoadState status={lessons.status} empty={!plans.length} onRetry={retry} />
          <Rows items={plans.map((l) => ({ key: l.id, label: l.pages ?? l.title, subtitle: l.pages ? l.title : undefined }))} chosen={[s.seg]} onPick={(k) => go({ seg: k })} />
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
      {s.step === 'way' ? (
        <Rows
          items={[suggestion.way, ...waysFor(s).filter((w) => w !== suggestion.way)].map((k) => ({
            key: k, label: C.ways[k], subtitle: k === suggestion.way ? C.suggested : undefined,
          }))}
          chosen={[wayNow]}
          onPick={(k) => go({ way: k as OwnAt['way'] })}
        />
      ) : null}
      {s.step === 'check' ? (
        <Check s={s} C={C} pagesLabel={seg?.pages ?? seg?.title ?? '—'} gradeLabel={L.grade(s.grade)} note={note} setNote={setNote} failed={failed} />
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

function Check({ s, C, pagesLabel, gradeLabel, note, setNote, failed }: {
  s: OwnAt; C: OwnCopy; pagesLabel: string; gradeLabel: string; note: string; setNote: (v: string) => void; failed: boolean;
}) {
  const at = (step: OwnAt['step']) => ownUrl({ ...s, step });
  return (
    <>
      <ChosenSoFar
        items={[
          { label: C.pages, value: pagesLabel, sub: `${gradeLabel} · ${s.subject}`, to: at('pages') },
          { label: C.size, value: s.size ? C.sizes[s.size] : '—', to: at('size') },
          { label: C.resources, value: ['textbook', ...s.res].map((r) => C.resourceNames[r as Resource]).join(', '), to: at('resources') },
          { label: C.level, value: s.level ? C.levels[s.level] : '—', to: at('level') },
          { label: C.way, value: s.way ? C.ways[s.way] : '—', to: at('way') },
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
      {failed ? <p role="alert" className="text-[16px] font-semibold text-[#c8331f]">{C.couldNotMake}</p> : null}
    </>
  );
}
