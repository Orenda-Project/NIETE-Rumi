import { useEffect, useState } from 'react';
import { readConfigShared } from '@/portal/lib/useNewUi';

/**
 * The WhatsApp chat links this portal points people at.
 *
 * The portal is ONE build served by every tier (sandbox, staging, production), so it carries no bot number. A
 * number baked in here sent sandbox and staging testers to the production bot. The server knows its own tier's bot
 * (WHATSAPP_BOT_NUMBER, else REFERRAL_BOT_NUMBER — dashboard/routes/app-login.routes.js botNumber()) and sends it as
 * `bot` on GET /api/portal/config, read signed out too. No number there (unset, still loading, a failed read) means
 * no chat button — never a fallback to another bot.
 *
 * The direct `wa.me/<number>` form (not a wa.me short-link) states plainly which bot it opens.
 */

/** WhatsApp's contact picker: no number, so the sender chooses the chat. Append `?text=…` (a leader sharing a link). */
export const WHATSAPP_URL_PICKER = 'https://wa.me/';

/** A bot number as wa.me digits, or null when it is not one (missing, or too short to be a number). */
export function validBotNumber(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const digits = String(value).replace(/\D/g, '');
  return digits.length >= 10 ? digits : null;
}

/** The chat with `bot` (with `text` typed, when given), or null without a bot number. */
export function botChatUrl(bot: unknown, text?: string): string | null {
  const n = validBotNumber(bot);
  if (!n) return null;
  return text === undefined ? `${WHATSAPP_URL_PICKER}${n}` : `${WHATSAPP_URL_PICKER}${n}?text=${encodeURIComponent(text)}`;
}

/**
 * This tier's bot number from /config, or null (while it is read, when the server names none, or when the read
 * fails). Every caller on a page shares ONE /config read (readConfigShared), kept for 30 s.
 */
export function useBotNumber(): string | null {
  const [bot, setBot] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    readConfigShared()
      .then((cfg) => { if (live) setBot(validBotNumber(cfg?.bot)); })
      .catch(() => { if (live) setBot(null); });
    return () => { live = false; };
  }, []);
  return bot;
}

/** The chat with this tier's bot (with `text` typed, when given), or null: render no chat button then. */
export function useBotChatUrl(text?: string): string | null {
  return botChatUrl(useBotNumber(), text);
}
