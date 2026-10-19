/**
 * bd-2465 — the single source of truth for the WhatsApp number this portal
 * points teachers at.
 *
 * Every CTA used to carry a hardcoded `wa.me/message/WCYNS4DTDB2MD1` — Rumi's
 * short-link — duplicated across 11 places in 9 files. This is the NIETE
 * deployment, so every one of them opened a chat with the wrong bot, and
 * fixing it meant finding all eleven.
 *
 * A wa.me short-link resolves to whoever owns the code, which is why the wrong
 * number was invisible in the source: the URL contains no phone number to read.
 * The direct `wa.me/<number>` form states plainly which bot it opens.
 *
 * If this portal is ever shared across deployments, make this read a Vite env
 * var (`VITE_WHATSAPP_NUMBER`) with the value below as the fallback. Today
 * NIETE-Rumi is a single-deployment fork, so a constant is honest and one less
 * build variable to get wrong.
 */

/** NIETE's WhatsApp business number, digits only, no `+`. */
export const WHATSAPP_NUMBER = '923206281951';

/** Base chat link. Append `?text=…` for a prefilled message. */
export const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}`;

/** WhatsApp's contact picker: no number, so the sender chooses the chat. Append `?text=…` (a leader sharing a link). */
export const WHATSAPP_URL_PICKER = 'https://wa.me/';
