/**
 * The WhatsApp text "Share link" opens (contracts/deep-link.md v2):
 *
 *   📘 <subject> · Level <n>         ← the leader's chrome language; the LEVEL, never a grade
 *   <the plan's title>               ← the plan's own language, never translated
 *   https://<portal>/portal/fln/p/<id>?src=wa   ← alone on its line, so no bidi reordering can touch it
 *
 * Urdu chrome: «📘 ریڈنگ آور — اردو — سطح ۱» («—» separators, Urdu digits). At most 300 code points: the title is cut
 * with «…», the URL never is. Plain text — WhatsApp renders no HTML, so nothing here is escaped or isolated.
 */
import { WHATSAPP_URL_PICKER } from '@/lib/whatsapp';
import { fillText, shareStrings, type ShareLang, type ShareSubject } from './strings.share';

export const MAX_CODE_POINTS = 300;

export interface ShareMessageInput {
  uiLang: ShareLang;
  subject: ShareSubject;
  level: number;
  title: string;
  url: string;
}

/** `url` with `src=wa` once (the receiver's open_link event reads it; the page ignores it). */
export function withSrc(url: string): string {
  if (/[?&]src=wa(&|#|$)/.test(url)) return url;
  const [base, hash] = url.split('#', 2);
  const joined = `${base}${base.includes('?') ? '&' : '?'}src=wa`;
  return hash !== undefined ? `${joined}#${hash}` : joined;
}

/** The kicker line: the subject and the level, in the chrome's language. */
export function kickerLine(uiLang: ShareLang, subject: ShareSubject, level: number): string {
  const S = shareStrings(uiLang);
  return `📘 ${S.subject[subject]}${S.sep}${fillText(S.level, { n: level }, uiLang)}`;
}

export function shareMessage({ uiLang, subject, level, title, url }: ShareMessageInput): string {
  const line1 = kickerLine(uiLang, subject, level);
  const line3 = withSrc(url);
  const clean = String(title || '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
  const room = MAX_CODE_POINTS - Array.from(line1).length - Array.from(line3).length - 2;
  const chars = Array.from(clean);
  const line2 = chars.length <= room ? clean : `${chars.slice(0, Math.max(0, room - 1)).join('').trimEnd()}…`;
  const out = `${line1}\n${line2}\n${line3}`;
  // trimEnd above can only shorten; pad nothing. Guard the budget anyway (a very long URL leaves no room for a title).
  if (Array.from(out).length > MAX_CODE_POINTS) return `${line1}\n${line3}`;
  return out;
}

/** The wa.me link that opens WhatsApp's contact picker with `message` typed in. */
export function waUrl(message: string): string {
  return `${WHATSAPP_URL_PICKER}?text=${encodeURIComponent(message)}`;
}
