/**
 * bd-t7zk3t.12 — the builder's entry on the leader home ("My Patch", LeaderHome): one card in the page's own card
 * style that opens /portal/fln/send. NOTHING unless GET /api/portal/fln/me says share:true, so the home is unchanged
 * for everyone else and whenever FLN is off. `lang` = the page's language when it has one (My Patch is English).
 */
import { Link } from 'react-router-dom';
import { BookOpen, ChevronRight } from 'lucide-react';
import { SHARE_DIR, shareStrings, type ShareLang } from './share/strings.share';
import { langOf, useFlnMe } from './share/useFlnMe';
import './share/share.css';

export default function FlnSendCard({ lang: pageLang }: { lang?: ShareLang }) {
  const me = useFlnMe();
  if (!me || me.share !== true) return null;
  const lang = pageLang ?? langOf(me);
  const S = shareStrings(lang);
  return (
    <div className="fln-root mb-8" lang={lang} dir={SHARE_DIR[lang]}>
      <Link
        to="/portal/fln/send"
        data-testid="fln-send-card"
        className="flex min-h-[56px] items-center gap-4 rounded-lg border border-border bg-white p-6 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="shrink-0 rounded-lg bg-accent/10 p-3">
          <BookOpen className="h-6 w-6 text-accent" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-lg font-medium">{S.cardTitle}</span>
          <span className="text-sm text-muted-foreground">{S.cardBody}</span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
      </Link>
    </div>
  );
}
