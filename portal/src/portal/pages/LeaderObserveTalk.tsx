import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, Loader2, MicOff, Smartphone, Upload, WifiOff } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import PortalLayout from '../components/PortalLayout';
import LoadingState from '../components/LoadingState';
import CoachRecorder from '../components/coaching/coach/CoachRecorder';
import RecordIcon from '../components/coaching/RecordIcon';
import { leader } from '../services/api';
import type { TalkGuide, TalkGuideSection } from '../services/api';
import { acceptFor, checkFile } from '../lib/coachingUpload';
import { canRecordHere } from '../lib/recordingSupport';
import { deleteRecording } from '../lib/recordingStore';
import { SendError } from '../lib/coachingSend';
import type { FinishedRecording } from '../lib/lessonRecorder';
import { firstName, sendTalk } from '../lib/coachObserve';

/**
 * bd-5rz1v.6 — "Talk with the teacher": the debrief, in the portal.
 *
 * The guide is the one WhatsApp sends the coach for this observation (what went
 * well, one thing to grow, one action, the question to end on), written from the
 * draft she just saved. She records the talk here — or uploads one — and her
 * Digital Coach gives HER feedback on it, as on WhatsApp, before the teacher's
 * report can go.
 */

const COPY = {
  title: (name: string) => `Talk with ${name}`,
  about: 'About 10 minutes, after her class. Use this as a guide — your own words are fine.',
  writing: 'Your Digital Coach is writing a guide for this talk…',
  guideFailed: 'The guide could not load. You can still record your talk.',
  sections: { strengths: '💪', growth: '🌱', action: '📋' } as Record<string, string>,
  askLast: 'Ask this last',
  record: 'Record your talk',
  recordSub: 'Your Digital Coach gives you feedback on it.',
  upload: 'Upload Recording',
  uploadSub: 'One already on your phone.',
  label: (name: string) => `Your talk with ${name}`,
  hearing: 'We can hear you both.',
  keepOpen: 'Keep this screen open. Put the phone between the two of you.',
  shortNote: 'That is short. A few minutes of talking gives better feedback.',
  sending: 'Sending your talk…',
  notAudio: 'That is not a recording. Choose a sound file from your phone.',
  tooLarge: 'That recording is too large to send.',
  micBlocked: "We can't use the microphone",
  micHelpApp: 'Open phone Settings → Apps → NIETE → Permissions → Microphone → Allow.',
  micHelpWeb: 'Tap the lock next to the web address, then allow the microphone.',
  tryAgain: 'Try again',
  netTitle: 'The internet stopped',
  netSafe: "Don't worry. The recording is safe on this phone.",
  refused: 'This talk could not be added. Go back to the observation and try again.',
  notReady: 'Save the draft report first — the guide is written from it.',
};

type Stage = 'guide' | 'recording' | 'micBlocked' | 'sending' | 'failed';

const Warning = ({ children }: { children: ReactNode }) => (
  <div className="flex gap-2.5 rounded-xl bg-[#fff6e0] px-3.5 py-3 text-[15px] leading-snug text-[#7a5600]">
    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
    <span>{children}</span>
  </div>
);

const GuideBlock = ({ icon, sec }: { icon: string; sec: TalkGuideSection }) => (
  <div className="flex flex-col gap-1.5 rounded-[14px] bg-white p-3.5">
    <span className="text-[16px] font-bold" dir="auto">{icon} {sec.title}</span>
    {sec.body && <span className="text-[14px] leading-relaxed text-[#3a3f4b]" dir="auto">{sec.body}</span>}
    {sec.say_this && (
      <span className="rounded-md border-l-4 border-accent bg-[#f4f5f6] px-2.5 py-2 text-[14px] italic leading-relaxed" dir="auto">“{sec.say_this}”</span>
    )}
  </div>
);

export const Guide = ({ guide }: { guide: TalkGuide }) => (
  <div className="flex flex-col gap-2.5" data-testid="talk-guide">
    {guide.intro && <p className="text-[15px] leading-relaxed" dir="auto">{guide.intro}</p>}
    {guide.sections
      ? (['strengths', 'growth', 'action'] as const).map((k) => (guide.sections && guide.sections[k]
        ? <GuideBlock key={k} icon={COPY.sections[k]} sec={guide.sections[k] as TalkGuideSection} /> : null))
      : (guide.steps || []).map((st, i) => <GuideBlock key={`${i}-${st.title}`} icon={`${i + 1}.`} sec={st} />)}
    {guide.reflection_question && (
      <GuideBlock icon="❓" sec={{ title: COPY.askLast, say_this: guide.reflection_question }} />
    )}
    {guide.outro && <p className="text-[14px] leading-relaxed text-[#5b6170]" dir="auto">{guide.outro}</p>}
  </div>
);

const LeaderObserveTalk = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [guide, setGuide] = useState<TalkGuide | null>(null);
  const [guideState, setGuideState] = useState<'loading' | 'ready' | 'failed' | 'not_ready'>('loading');
  const [canRecord, setCanRecord] = useState(false);
  const [stage, setStage] = useState<Stage>('guide');
  const [progress, setProgress] = useState(0);
  const [failure, setFailure] = useState<SendError | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ blob: Blob; filename: string; recordingId: string | null } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    leader.getObservation(id)
      .then((v) => { if (live) setName((v.teacher && v.teacher.name) || v.report.teacherName || ''); })
      .catch(() => {});
    leader.getTalkGuide(id)
      .then((r) => { if (!live) return; setGuide(r.guide || null); setGuideState('ready'); })
      .catch((err) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (live) setGuideState(status === 409 ? 'not_ready' : 'failed');
      });
    canRecordHere().then((ok) => { if (live) setCanRecord(ok); }).catch(() => {});
    return () => { live = false; };
  }, [id]);

  const first = firstName(name);

  const send = async (audio: { blob: Blob; filename: string; recordingId: string | null }) => {
    if (!id) return;
    setPending(audio);
    setFailure(null);
    setProgress(0);
    setStage('sending');
    try {
      await sendTalk(id, { blob: audio.blob, filename: audio.filename }, leader, undefined, setProgress);
      if (audio.recordingId) { try { await deleteRecording(audio.recordingId); } catch { /* gone */ } }
      navigate(`/portal/leader/observe/${id}`);
    } catch (err) {
      setFailure(err instanceof SendError ? err : new SendError('network'));
      setStage('failed');
    }
  };

  const onRecorded = (out: FinishedRecording) => {
    void send({ blob: out.blob, filename: `Talk${out.type.ext}`, recordingId: out.id });
  };

  const onFile = (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    const problem = checkFile(file, 'audio');
    if (problem) { setFileError(problem === 'too_large' ? COPY.tooLarge : COPY.notAudio); return; }
    void send({ blob: file, filename: file.name, recordingId: null });
  };

  if (!id) return null;
  if (guideState === 'loading' && !name) return <PortalLayout><LoadingState type="full" /></PortalLayout>;

  return (
    <PortalLayout bare={stage === 'recording' || stage === 'sending'}>
      <div className="mx-auto flex w-full max-w-md flex-col gap-3 pb-8">
        <div className="flex h-12 items-center gap-1">
          {stage !== 'recording' && stage !== 'sending' && (
            <button type="button" onClick={() => navigate(`/portal/leader/observe/${id}`)} aria-label="Back"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-primary">
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}
          <h1 className="text-lg font-bold text-primary" dir="auto">{COPY.title(first)}</h1>
        </div>

        {stage === 'guide' && (
          <>
            {guideState === 'not_ready' ? <Warning>{COPY.notReady}</Warning> : (
              <>
                <p className="text-[14px] leading-relaxed text-[#5b6170]">{COPY.about}</p>
                {guideState === 'loading' && (
                  <div className="flex items-center gap-3 rounded-2xl bg-white p-4 text-[15px]">
                    <Loader2 className="h-6 w-6 text-primary motion-safe:animate-spin" aria-hidden="true" />{COPY.writing}
                  </div>
                )}
                {guideState === 'failed' && <Warning>{COPY.guideFailed}</Warning>}
                {guideState === 'ready' && guide && <Guide guide={guide} />}

                {canRecord && (
                  <button type="button" onClick={() => setStage('recording')}
                    className="mt-1 flex items-center gap-4 rounded-2xl border-[3px] border-[#d32f2f] bg-[#d32f2f] p-3.5 text-left">
                    <RecordIcon size={52} onRed />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[18px] font-bold text-white">{COPY.record}</span>
                      <span className="text-[13px] text-[#fde3e1]">{COPY.recordSub}</span>
                    </span>
                  </button>
                )}
                <button type="button" onClick={() => input.current?.click()}
                  className="flex items-center gap-4 rounded-2xl border-2 border-primary bg-white p-3.5 text-left text-primary">
                  <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[14px] bg-[#eef0f4]"><Upload className="h-6 w-6" aria-hidden="true" /></span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[18px] font-bold">{COPY.upload}</span>
                    <span className="text-[13px] text-[#5b6170]">{COPY.uploadSub}</span>
                  </span>
                </button>
                <input ref={input} data-testid="talk-input" type="file" accept={`${acceptFor('audio')},audio/*`} className="hidden"
                  onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
                {fileError && <Warning>{fileError}</Warning>}
              </>
            )}
          </>
        )}

        {stage === 'recording' && (
          <CoachRecorder
            label={COPY.label(name || first)}
            copy={{ hearing: COPY.hearing, keepOpen: COPY.keepOpen, shortNote: COPY.shortNote }}
            shortMs={3 * 60_000}
            onFinished={onRecorded}
            onMicBlocked={() => setStage('micBlocked')}
          />
        )}

        {stage === 'micBlocked' && (
          <div className="flex flex-col items-center gap-4 px-1 pt-4 text-center">
            <span className="flex h-24 w-24 items-center justify-center rounded-full bg-[#fdecea]"><MicOff className="h-11 w-11 text-[#c62828]" aria-hidden="true" /></span>
            <h2 className="text-[23px] font-bold">{COPY.micBlocked}</h2>
            <p className="w-full rounded-xl bg-white p-3.5 text-left text-[15px] leading-relaxed text-[#5b6170]">
              {Capacitor.isNativePlatform() ? COPY.micHelpApp : COPY.micHelpWeb}
            </p>
            <button type="button" onClick={() => setStage('recording')} className="h-14 w-full rounded-xl bg-primary text-lg font-bold text-white">{COPY.tryAgain}</button>
            <button type="button" onClick={() => { setStage('guide'); setTimeout(() => input.current?.click(), 0); }}
              className="h-[52px] w-full rounded-xl border-2 border-primary bg-white text-[17px] font-bold text-primary">{COPY.upload}</button>
          </div>
        )}

        {stage === 'sending' && (
          <div className="flex flex-col items-center gap-4 px-1 pt-10 text-center">
            <span className="flex h-24 w-24 items-center justify-center rounded-full bg-[#e3f4ea]"><Upload className="h-11 w-11 text-[#1b6b43]" aria-hidden="true" /></span>
            <h2 className="text-[23px] font-bold">{COPY.sending}</h2>
            <div className="relative h-4 w-full overflow-hidden rounded-full bg-[#e5e7eb]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.max(4, progress)}%` }} />
            </div>
            <div className="flex w-full items-center gap-3 rounded-xl bg-white p-3.5 text-left text-[15px] leading-snug text-[#3a3f4b]">
              <Smartphone className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" /><span>Keep this screen open until it is done.</span>
            </div>
          </div>
        )}

        {stage === 'failed' && failure && (
          <div className="flex flex-col items-center gap-4 px-1 pt-10 text-center">
            <span className="flex h-24 w-24 items-center justify-center rounded-full bg-[#fff6e0]">
              {failure.kind === 'network' ? <WifiOff className="h-11 w-11 text-[#7a5600]" aria-hidden="true" /> : <AlertTriangle className="h-11 w-11 text-[#7a5600]" aria-hidden="true" />}
            </span>
            {failure.kind === 'network' ? (
              <>
                <h2 className="text-[23px] font-bold">{COPY.netTitle}</h2>
                <p className="text-[17px] leading-relaxed text-[#3a3f4b]">{COPY.netSafe}</p>
                <button type="button" onClick={() => pending && send(pending)} className="mt-2 h-[60px] w-full rounded-[14px] bg-primary text-[19px] font-bold text-white">{COPY.tryAgain}</button>
              </>
            ) : (
              <>
                <p className="text-[17px] leading-relaxed text-[#3a3f4b]">{COPY.refused}</p>
                <button type="button" onClick={() => navigate(`/portal/leader/observe/${id}`)} className="mt-2 h-[60px] w-full rounded-[14px] bg-primary text-[19px] font-bold text-white">{COPY.tryAgain}</button>
              </>
            )}
          </div>
        )}
      </div>
    </PortalLayout>
  );
};

export default LeaderObserveTalk;
