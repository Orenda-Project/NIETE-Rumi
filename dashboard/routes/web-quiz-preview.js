/**
 * Link previews of shared web-quiz links, answered fast.
 *
 * WhatsApp builds a link's preview on the SENDER's phone, in the composer, before the message goes: it fetches
 * the page (a HEAD, then a GET), reads the og tags in its <head>, then fetches the og:image. A full page render
 * asks the bot for the whole quiz (2-3 s each), so a child who tapped send at once sent a bare link. Here:
 *
 *   isPreviewFetch(req)  a HEAD, or a link-preview fetcher's own user agent (WhatsApp's is exactly
 *                        "WhatsApp/2.x.x.x A|I|N"; a browser's starts "Mozilla/", so a child's browser,
 *                        WhatsApp's in-app one included, never matches)
 *   ttlCache({ max })    a small in-memory map with a per-entry lifetime: what the edge last learned about a
 *                        code (the og facts only, never the quiz) and the share pictures' bytes
 *   ogFacts(payload)     the few fields a preview's head needs, taken from the bot's quiz answer
 */
const PREVIEW_UA_RX = /^(?:WhatsApp\/\d[\d.]*(?:\s+[AIN])?\s*$|facebookexternalhit\/|Facebot\b|meta-externalagent\/|TelegramBot\b|Twitterbot\/|Slackbot|LinkedInBot\/|Discordbot\/|SkypeUriPreview\b)/;

function isPreviewFetch(req) {
  if (req.method === 'HEAD') return true;
  return PREVIEW_UA_RX.test(String((req.get && req.get('user-agent')) || ''));
}

function ttlCache({ max = 500, now = Date.now } = {}) {
  const m = new Map();
  return {
    get(key) {
      const e = m.get(key);
      if (!e) return null;
      if (e.until <= now()) { m.delete(key); return null; }
      return e.value;
    },
    set(key, value, ttlMs) {
      m.delete(key);
      m.set(key, { value, until: now() + ttlMs });
      while (m.size > max) m.delete(m.keys().next().value);
    },
    get size() { return m.size; },
  };
}

/** The fields ogText / ogImageFor / the head read: no questions, no roster, no child but a challenger's first name. */
function ogFacts(p) {
  const q = (p && p.quiz) || {};
  const cls = (p && p.cls) || {};
  return {
    quiz: { lang: q.lang, topic: q.topic, n: q.n || (q.questions || []).length || 0 },
    cls: { label: cls.label },
    challenge: (p && p.challenge) || null,
    art: (p && p.art) || {},
    brand: p && p.brand,
    invited: Boolean(p && p.invited),
  };
}

module.exports = { isPreviewFetch, ttlCache, ogFacts, PREVIEW_UA_RX };
