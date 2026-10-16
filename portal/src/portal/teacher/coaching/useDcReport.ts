import { useCallback, useEffect, useRef, useState } from 'react';
import { portal } from '../../services/api';
import { sendVoiceAnswer, useVoiceAnswer } from '../../lib/voiceAnswer';
import { useStableSignedUrl } from '../../lib/stableSignedUrl';
import type { CoachingProgress, SessionDetail } from '../../types/portal';
import { useCopy } from '../i18n';
import { COACHING } from './copy';
import { loadJourney, type JourneyPoint } from './report';

/**
 * A DC observation as it is worked on, shared by the report page (ReportPage) and the one screen (NewObservation):
 * the progress, polled as the lesson page always has (5 s for two minutes, then 15 s) until ready or stopped; once
 * done, the session and its journey; and her answer to the one question, by text or voice. Drawn by reportLive's
 * <Reflection>.
 */

export type DcReportState = { progress: CoachingProgress | null; detail: SessionDetail | null; journey: JourneyPoint[] };

export function useDcReport(id: string | null) {
  const C = useCopy(COACHING);
  const [state, setState] = useState<DcReportState>({ progress: null, detail: null, journey: [] });
  const [missing, setMissing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(Date.now());

  const check = useCallback(async () => {
    if (!id) return;
    try {
      const p = await portal.getCoachingProgress(id);
      if (p.stage === 'done') {
        const [d, journey] = await Promise.all([portal.getCoachingSession(id), loadJourney(id)]);
        setState({ progress: p, detail: d.session, journey });
        return;
      }
      setState((s) => ({ ...s, progress: p }));
      if (p.stage === 'stopped') return;
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) { setMissing(true); return; }
    }
    const waited = Date.now() - startedAt.current;
    timer.current = setTimeout(() => { void check(); }, waited < 120_000 ? 5_000 : 15_000);
  }, [id]);

  useEffect(() => {
    startedAt.current = Date.now();
    void check();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [check]);

  const recheck = () => {
    if (timer.current) clearTimeout(timer.current);
    void check();
  };

  // Her answer to the one question.
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  // bd-ncfml5 — the follow-up as a voice note (ICT feedback row 7), when the bot could voice it.
  const [sentAudio, setSentAudio] = useState<string | null>(null);
  const [sendError, setSendError] = useState(false);
  const sendAnswer = async () => {
    const text = answer.trim();
    if (!text || !id) return;
    setSending(true);
    setSendError(false);
    try {
      const r = await portal.submitCoachingReflection(id, text);
      setSent(r?.acknowledgement || C.answerSent);
      setSentAudio(r?.acknowledgementAudioUrl || null);
      recheck();
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  };
  // bd-eygg2f — or her spoken answer: recorded here, uploaded to R2, transcribed by the bot.
  const voice = useVoiceAnswer();
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!voice.clip) { setClipUrl(null); return undefined; }
    const url = URL.createObjectURL(voice.clip.blob);
    setClipUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [voice.clip]);
  const sendVoice = async () => {
    if (!voice.clip || !id) return;
    setSending(true);
    setSendError(false);
    try {
      const r = await sendVoiceAnswer(id, voice.clip);
      setSent(r?.acknowledgement || C.answerSent);
      setSentAudio(r?.acknowledgementAudioUrl || null);
      voice.discard();
      recheck();
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  };

  const { progress, detail } = state;
  const ready = progress?.stage === 'done' && !!detail;
  const asked = progress?.stage === 'reflection' && !sent ? progress.reflection : null;
  // bd-ymavij — every poll re-signs the question's audio; keep one link under the player so a tap is never thrown away.
  const askedAudio = useStableSignedUrl(asked?.audioUrl);

  return {
    state, missing, ready, asked, askedAudio,
    answer, setAnswer, sending, sent, sentAudio, sendError, sendAnswer,
    voice, clipUrl, sendVoice,
  };
}

export type DcReport = ReturnType<typeof useDcReport>;

