/**
 * Branding Configuration
 *
 * Centralizes all customizable branding for clone deployments.
 * Every value is overridable via environment variables; every URL
 * helper returns `null` (not a placeholder string) when unset, so
 * callers can degrade the message gracefully — a missing PORTAL_URL
 * omits the link rather than shipping a broken example-host URL.
 *
 * Clone users: set the env vars listed in `.env.template`'s
 * "Brand customization" block to personalize the bot for your
 * organization. Leaving them blank disables the corresponding
 * feature surface (e.g. portal deep links are simply omitted from
 * confirmation messages).
 */

// NIETE fork defaults (OPS-114, bd-2381). Amena confirmed the Rumi→NIETE rename is
// program-wide (2026-07-30). This fork's Railway token is read-only (403 on
// variableUpsert), so — exactly like RUMI_LOGO_R2_KEY (bd-2374) — the code DEFAULT
// is the operative config; still overridable via BOT_NAME / ORG_NAME. Convention:
// full "NIETE Teaching Assistant" on formal surfaces, "NIETE" conversationally.
const botName = process.env.BOT_NAME || 'NIETE Teaching Assistant';
const orgName = process.env.ORG_NAME || 'NIETE';
const supportContact = process.env.SUPPORT_CONTACT || null;
const securityContact = process.env.SECURITY_CONTACT || null;
const defaultLanguage = process.env.DEFAULT_LANGUAGE || 'en';

/**
 * Read a URL-shaped env var. Returns the trimmed value with any
 * trailing slash removed, or `null` if unset / empty. Callers MUST
 * treat `null` as "feature surface not configured" and skip the
 * link/footer/contact rather than shipping a placeholder.
 *
 * @param {string} envVar
 * @returns {string|null}
 */
function brandUrl(envVar) {
  const v = process.env[envVar];
  if (!v || !v.trim()) return null;
  return v.trim().replace(/\/$/, '');
}

const websiteUrl = () => brandUrl('WEBSITE_URL');
const portalUrl = () => brandUrl('PORTAL_URL');
const assetBaseUrl = () => brandUrl('ASSET_BASE_URL') || brandUrl('ASSETS_BASE_URL');
const logoUrl = () => brandUrl('LOGO_URL');

// The NIETE app's store listing (bd-onxyu) — where an app-redirect switch sends a
// teacher. Unlike the URLs above it has a code default: like botName, this fork
// cannot set Railway variables, so the default IS the operative config. A clone
// overrides it with APP_STORE_URL.
const NIETE_PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=pk.edu.niete';
const appStoreUrl = () => brandUrl('APP_STORE_URL') || NIETE_PLAY_STORE_URL;

const supportedLanguages = [
  { code: 'en', name: 'English', direction: 'ltr' },
  { code: 'ur', name: 'Urdu', direction: 'rtl' },
  { code: 'ar', name: 'Arabic', direction: 'rtl' },
  { code: 'es', name: 'Spanish', direction: 'ltr' },
];

const welcomeMessages = {
  en: `Welcome! I'm ${botName}, your AI teaching assistant. I'm here to help you become a better teacher.`,
  ur: `!خوش آمدید! میں ${botName} ہوں، آپ کی AI تدریسی معاون۔ میں آپ کی مدد کے لیے حاضر ہوں`,
  ar: `!مرحبا! أنا ${botName}، مساعدك التعليمي بالذكاء الاصطناعي. أنا هنا لمساعدتك`,
  es: `Bienvenido! Soy ${botName}, tu asistente de enseñanza con IA. Estoy aquí para ayudarte.`,
};

function getWelcomeMessage(languageCode) {
  return welcomeMessages[languageCode] || welcomeMessages[defaultLanguage];
}

function isLanguageSupported(languageCode) {
  return supportedLanguages.some(l => l.code === languageCode);
}

module.exports = {
  botName,
  orgName,
  supportContact,
  securityContact,
  defaultLanguage,
  supportedLanguages,
  // URL helpers — return null when unset; callers degrade gracefully.
  websiteUrl,
  portalUrl,
  appStoreUrl,
  assetBaseUrl,
  logoUrl,
  getWelcomeMessage,
  isLanguageSupported,
};
