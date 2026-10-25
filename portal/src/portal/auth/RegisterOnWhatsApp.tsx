import { MessageCircle } from 'lucide-react';
import { botChatUrl, useBotNumber } from '@/lib/whatsapp';
import { BottomButton } from '../newui';
import { useCopy } from '../teacher/i18n';
import { AuthMessage } from './AuthFrame';
import { AUTH } from './copy';

/**
 * bd-x7aprz.3 — the chat with the bot with a command typed. The server sends this deployment's own link with the
 * answer (so the sandbox portal opens the sandbox bot); without one, this tier's bot number from /config
 * (`bot`, useBotNumber). Neither → null: the caller shows no WhatsApp button.
 */
export function chatLink(text: string, fromServer?: string | null, bot?: string | null): string | null {
  return fromServer || botChatUrl(bot ?? null, text);
}

/**
 * bd-x7aprz.3 — what a number that is not registered sees instead of "No account found": the way an account starts.
 * The bot's registration form opens from /register, so the button opens the chat with /register typed.
 */
export function RegisterOnWhatsApp({ href }: { href?: string | null }) {
  const c = useCopy(AUTH);
  const to = chatLink('/register', href, useBotNumber());
  return (
    <div data-testid="register-on-whatsapp" className="mb-1">
      <AuthMessage>{c.notRegistered}</AuthMessage>
      {to ? <BottomButton to={to} icon={MessageCircle}>{c.registerOnWa}</BottomButton> : null}
    </div>
  );
}
