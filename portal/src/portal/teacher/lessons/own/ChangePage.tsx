import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { teacherPath } from '../../routes';
import { DockButton, ListRow } from '../../ui';
import { FOCUS, LIST_CARD } from '../../ui/styles';
import { useCopy } from '../../i18n';
import TeacherPage from '../../TeacherPage';
import { lessonsUrl } from '../paths';
import { OWN } from './copy';
import { CHANGE_PARTS, TEXT_MAX, checkLocal, readChange, type ChangeAt, type Refusal } from './change';
import { requestChange, useLpMakeOwn } from './api';
import { ChangeEntry } from './ChangeEntry';

/**
 * bd-snkn32.15 — "Change this plan": she picks a part, says what should change, and the waiting screen opens on the
 * changed plan (the same Preparing poll and viewer as any own plan). The bot decides; a refusal is told in plain words
 * and she stays. Dark unless lpMakeOwn.
 */
export function ChangePage() {
  const c = readChange(useLocation().search);
  const on = useLpMakeOwn();
  if (!c || on === false) return <Navigate to={teacherPath('lessons')} replace />;
  return <Change c={c} />;
}

function Change({ c }: { c: ChangeAt }) {
  const C = useCopy(OWN);
  const navigate = useNavigate();
  const location = useLocation();
  const [part, setPart] = useState<string | null>(c.part ?? null); // a section card names its section
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Refusal | 'error' | null>(null);
  const back = () => (location.key !== 'default' ? navigate(-1) : navigate(teacherPath('lessons'), { replace: true }));

  async function send() {
    if (busy) return;
    const local = checkLocal(c.band, part, text);
    if (local) { setSaid(local === 'bad_request' ? 'error' : local); return; }
    setBusy(true);
    setSaid(null);
    const r = await requestChange(c.own, part as string, text);
    setBusy(false);
    if (r && 'renderId' in r) {
      navigate(lessonsUrl('preparing', {
        grade: c.grade, subject: c.subject, chapter: c.chapter, lesson: c.lesson, render: r.renderId, title: c.title,
      }), { replace: true });
      return;
    }
    setSaid(r && 'outcome' in r ? r.outcome : 'error');
  }

  const used = c.left <= 0;
  return (
    <TeacherPage
      feature="lessons"
      crumb={c.title ?? C.changeTitle}
      title={used ? C.changeTitle : C.whichPart}
      onBack={back}
      testId="own-change"
      dock={used ? undefined : (
        <DockButton disabled={busy || !part || !text.trim()} testId="own-change-send" onClick={() => { void send(); }}>
          {said === 'error' ? C.tryAgain : C.changeMyPlan}
        </DockButton>
      )}
    >
      {used ? <ChangeEntry at={c} /> : (
        <>
          <div className={LIST_CARD}>
            {CHANGE_PARTS[c.band].map((p, i) => (
              <ListRow
                key={p}
                variant="row"
                first={i === 0}
                label={C.partNames[p]}
                state={part === p ? 'selected' : 'default'}
                onPress={() => setPart(p)}
                testId={`own-part-${p}`}
              />
            ))}
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-[#4b5563]">{C.whatToChange}</span>
            <span className="text-[13px] text-[#6b7280]">{C.changeHint}</span>
            <textarea
              value={text}
              maxLength={TEXT_MAX}
              onChange={(e) => setText(e.target.value)}
              className={`min-h-[96px] rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3 text-[16px] ${FOCUS}`}
              data-testid="own-change-text"
            />
          </label>
          {said ? (
            <p role="alert" className="text-[16px] font-semibold text-[#c8331f]">
              {said === 'error' ? C.couldNotMake : C.refusals[said]}
            </p>
          ) : null}
        </>
      )}
    </TeacherPage>
  );
}
