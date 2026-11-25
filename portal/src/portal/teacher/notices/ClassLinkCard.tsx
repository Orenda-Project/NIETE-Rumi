import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Link2, Moon, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '../../services/api';
import { useCopy } from '../i18n';
import { CLASS_LINK } from '../classlink/copy';
import { useBidi } from '../ui/bidi';
import { copyText, OPEN_HOLD_MS } from '../ui/useOpenTarget';
import { CARD, FOCUS, OUTLINE_WIDE, PRIMARY_WIDE, ROW_DIVIDER } from '../ui/styles';

/**
 * The teacher Home's class link card (switch web_quiz_class_link, OFF by default; tonight's line also needs
 * web_quiz_evening_round). One block per class the teacher teaches (class_teachers) that the server lists: the term's
 * standing link /j/<code>, "Send to class group" (the wa.me link with the URL only, ?f=1) and "Copy". Once the class's
 * link was sent this term the block folds to one line ("Class link sent · Send again"). With the evening round on, a
 * ready round adds tonight's line (its lesson title is data), and once children have played it, their COUNT and the
 * report page's "Evening rounds" section. Never a child's name here.
 *
 * GET /api/portal/class-link → {classes, reportHref} (the server decides who the teacher is from the session; its 404
 * = off → nothing drawn). A Send or Copy tells the server (POST /class-link/tap {classId, how}), fire-and-forget: it
 * logs the forward tap the report's class tab logs, and remembers the class's link as sent this term.
 */
export type ClassLinkRound = { lesson: string | null; played: number };
export type ClassLinkClass = {
  classId: string;
  grade: number | string;
  section: string | null;
  url: string;
  sendHref: string;
  sent: boolean;
  round: ClassLinkRound | null;
};
export type ClassLinkPayload = { classes: ClassLinkClass[]; reportHref: string | null };

const HTTPS = /^https:\/\//;
const WA_ME = /^https:\/\/wa\.me\//;
/** The link as the card shows it: without its scheme, so it fits one line on a phone (Copy and Send carry it whole). */
const shown = (url: string) => url.replace(HTTPS, '');

/** The server's answer, kept only when every field a block draws is usable; else null (nothing drawn). */
export function readPayload(data: unknown): ClassLinkPayload | null {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const raw = Array.isArray(d.classes) ? d.classes : [];
  const classes = raw.filter((c): c is ClassLinkClass => {
    const x = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
    return typeof x.classId === 'string' && typeof x.url === 'string' && HTTPS.test(x.url)
      && typeof x.sendHref === 'string' && WA_ME.test(x.sendHref) && (typeof x.grade === 'number' || typeof x.grade === 'string');
  }).map((c) => ({
    ...c,
    section: typeof c.section === 'string' && c.section.trim() ? c.section.trim() : null,
    sent: c.sent === true,
    round: c.round && typeof c.round === 'object' && Number.isFinite(Number(c.round.played))
      ? { lesson: typeof c.round.lesson === 'string' && c.round.lesson.trim() ? c.round.lesson.trim() : null, played: Math.max(0, Math.floor(Number(c.round.played))) }
      : null,
  }));
  if (!classes.length) return null;
  const reportHref = typeof d.reportHref === 'string' && HTTPS.test(d.reportHref) ? d.reportHref : null;
  return { classes, reportHref };
}

const tap = (classId: string, how: 'forward' | 'copy') => {
  void api.post('/class-link/tap', { classId, how }).catch(() => undefined);
};

function RoundLine({ round, reportHref }: { round: ClassLinkRound; reportHref: string | null }) {
  const C = useCopy(CLASS_LINK);
  const played = round.played > 0;
  const text = played ? C.played(round.played) : round.lesson ? C.ready(round.lesson) : C.readyNoLesson;
  return (
    <div data-testid="class-link-round" className="flex items-start gap-3 rounded-[12px] bg-[#f4f5f8] p-3">
      <Moon className="mt-0.5 h-5 w-5 shrink-0 text-[#33374a]" strokeWidth={2.2} aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="m-0 text-[15px] leading-relaxed text-[#1d2025]" style={{ unicodeBidi: 'plaintext' }}>{text}</p>
        {played && reportHref ? (
          <a
            data-testid="class-link-report"
            href={reportHref}
            target="_blank"
            rel="noopener noreferrer"
            className={cn('flex min-h-[56px] items-center text-[15px] font-semibold text-[#33374a] underline underline-offset-4', FOCUS)}
          >
            {C.seeRounds}
          </a>
        ) : null}
      </div>
    </div>
  );
}

function ClassBlock({ c, first, showBody, reportHref, onSent }: { c: ClassLinkClass; first: boolean; showBody: boolean; reportHref: string | null; onSent: (id: string) => void }) {
  const C = useCopy(CLASS_LINK);
  const bidi = useBidi();
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const label = bidi(C.classLabel(c.grade, c.section));

  const send = () => { tap(c.classId, 'forward'); onSent(c.classId); };
  const copy = async () => {
    const ok = await copyText(c.url);
    setCopied(ok ? 'copied' : 'failed');
    if (ok) { tap(c.classId, 'copy'); onSent(c.classId); }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied('idle'), OPEN_HOLD_MS);
  };

  const round = c.round ? <RoundLine round={c.round} reportHref={reportHref} /> : null;
  const edge = first ? '' : cn(ROW_DIVIDER, 'pt-4');

  if (c.sent && copied === 'idle') {
    return (
      <div data-testid="class-link-class" data-sent="1" className={cn('flex flex-col gap-2', edge)}>
        <div className="flex min-h-[56px] items-center gap-3">
          <Check className="h-5 w-5 shrink-0 text-[#2f7a52]" strokeWidth={2.4} aria-hidden="true" />
          <p data-testid="class-link-sent" className="m-0 flex min-w-0 flex-1 flex-col text-[15px] font-semibold leading-snug text-[#1d2025]">
            <span>{label}</span>
            <span className="text-[13px] font-medium text-[#6b7280]">{C.sent}</span>
          </p>
          <a
            data-testid="class-link-send"
            href={c.sendHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={send}
            className={cn('flex min-h-[56px] shrink-0 items-center rounded-2xl px-3 text-[15px] font-semibold text-[#33374a] underline underline-offset-4', FOCUS)}
          >
            {C.sendAgain}
          </a>
        </div>
        {round}
      </div>
    );
  }

  return (
    <div data-testid="class-link-class" className={cn('flex flex-col gap-3', edge)}>
      <p className="m-0 text-[16px] font-semibold leading-snug text-[#33374a]">{label}</p>
      {showBody ? <p className="m-0 text-[15px] leading-relaxed text-[#374151]">{C.body}</p> : null}
      <div className="rounded-[12px] bg-[#f3f4f6] px-3 py-3">
        <span className="sr-only">{C.theLink}</span>
        <p data-testid="class-link-url" dir="ltr" className="m-0 select-all break-all text-start font-mono text-[14px] leading-snug text-[#1d2025]">{shown(c.url)}</p>
      </div>
      <a
        data-testid="class-link-send"
        href={c.sendHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={send}
        className={cn(PRIMARY_WIDE, FOCUS)}
      >
        <Send className="h-5 w-5 shrink-0 rtl:-scale-x-100" strokeWidth={2.2} aria-hidden="true" />
        {C.send}
      </a>
      <button type="button" data-testid="class-link-copy" onClick={() => void copy()} className={cn(OUTLINE_WIDE, FOCUS)}>
        {copied === 'copied' ? <Check className="h-5 w-5 shrink-0" aria-hidden="true" /> : <Copy className="h-5 w-5 shrink-0" aria-hidden="true" />}
        {copied === 'copied' ? C.copied : copied === 'failed' ? C.copyFailed : C.copy}
      </button>
      {round}
    </div>
  );
}

export function ClassLinkCard() {
  const C = useCopy(CLASS_LINK);
  const [data, setData] = useState<ClassLinkPayload | null>(null);
  const [sentHere, setSentHere] = useState<Record<string, true>>({});

  useEffect(() => {
    let live = true;
    api.get('/class-link')
      .then(({ data: body }) => { if (live) setData(readPayload(body)); })
      .catch(() => { /* off (404) or unreadable: nothing drawn */ });
    return () => { live = false; };
  }, []);

  if (!data) return null;
  const onSent = (id: string) => setSentHere((s) => ({ ...s, [id]: true }));
  // The card's one sentence sits in the first class still to send (none once every link went out).
  const firstOpen = (data.classes.find((c) => !c.sent && !sentHere[c.classId]) || { classId: null }).classId;

  return (
    <section aria-label={C.title} data-testid="class-link-card" className={cn(CARD, 'flex flex-col gap-3 p-4')}>
      <h2 className="m-0 flex items-center gap-2 text-[18px] font-semibold leading-snug">
        <Link2 className="h-5 w-5 shrink-0 text-[#33374a]" strokeWidth={2.2} aria-hidden="true" />
        {C.title}
      </h2>
      {data.classes.map((c, i) => (
        <ClassBlock
          key={c.classId}
          c={{ ...c, sent: c.sent || !!sentHere[c.classId] }}
          first={i === 0}
          showBody={c.classId === firstOpen}
          reportHref={data.reportHref}
          onSent={onSent}
        />
      ))}
    </section>
  );
}
