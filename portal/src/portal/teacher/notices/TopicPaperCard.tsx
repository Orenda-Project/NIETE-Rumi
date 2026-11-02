import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '../../services/api';
import { useCopy } from '../i18n';
import { TOPIC_PAPER } from '../topicpaper/copy';
import { newPaperPath } from '../assessment/paths';
import { CARD, FOCUS, PRIMARY_WIDE } from '../ui/styles';

/**
 * bd-pw1ccr.26 — the teacher Home's "Make my paper" card (switch topic_nudge_portal_card_enabled, OFF by default):
 * drawn only while her topic-end nudge is held for WhatsApp's window (GET /api/portal/me/topic-paper → {held}; the
 * server answers 404 while off and only for group B). The tap opens Topics on that chapter and tells the server
 * (POST /me/topic-paper/opened), which stops the WhatsApp retry. The card stays until she makes the paper.
 */
type Held = { topicId: string; topicName: string | null; grade: number; subject: string; chapter: number };

export function topicPaperHref(h: Held): string {
  const q = new URLSearchParams({ by: 'topics', grade: String(h.grade), subject: h.subject, chapter: String(h.chapter) });
  return `${newPaperPath('class')}?${q.toString()}`;
}

export function TopicPaperCard() {
  const C = useCopy(TOPIC_PAPER);
  const [held, setHeld] = useState<Held | null>(null);

  useEffect(() => {
    let live = true;
    api.get('/me/topic-paper')
      .then(({ data }) => { if (live && data?.held) setHeld(data.held as Held); })
      .catch(() => { /* off (404) or unreadable: nothing drawn */ });
    return () => { live = false; };
  }, []);

  if (!held) return null;

  const opened = () => { void api.post('/me/topic-paper/opened', { topicId: held.topicId }).catch(() => undefined); };

  return (
    <section aria-label={C.title} data-testid="topic-paper-card" className={cn(CARD, 'flex flex-col gap-3 p-4')}>
      <h2 className="m-0 flex items-center gap-2 text-[18px] font-semibold leading-snug">
        <FileText className="h-5 w-5 shrink-0 text-[#33374a]" strokeWidth={2.2} aria-hidden="true" />
        {C.title}
      </h2>
      <p className="m-0 text-[15px] leading-relaxed text-[#374151]" style={{ unicodeBidi: 'plaintext' }}>
        {held.topicName ? C.bodyTopic(held.topicName, held.chapter) : C.body(held.chapter)}
      </p>
      <Link to={topicPaperHref(held)} onClick={opened} className={cn(PRIMARY_WIDE, FOCUS, 'text-center')}>{C.cta}</Link>
    </section>
  );
}
