/**
 * bd-5ls6qy.7 — a slash command inside Urdu text is printed left-to-right.
 *
 * Ahmed (ICT, 8 Oct): "NIETE teaching assistant guides to type /menu in Urdu language and it
 * demonstrates it in reverse order "menu/"". The Urdu line ends "… /menu ٹائپ کریں۔". The
 * paragraph is right-to-left, and the leading `/` is a bidi-neutral character sitting between
 * an Arabic-script letter and the Latin run `menu`, so UAX#9 resolves it to the paragraph's
 * direction and paints it on the far side: "menu/". The same line showed "(1-4)" as "(4-1)".
 *
 * The fix (language-protocol §9.2): every Latin command atom in RTL prose is wrapped in
 * LRI U+2066 … PDI U+2069, an isolate, so it paints as one contiguous `/menu` and cannot leak
 * its direction into the sentence. `ux-strings.js` readingNotAvailable already did this; the
 * older strings were never swept.
 *
 * Two layers:
 *   1. The catalogs the bot sends from, loaded and walked as data (the real objects).
 *   2. A ratchet over every RTL string literal in the bot's teacher-facing code, so an inline
 *      string added tomorrow with a bare `/menu` fails here instead of in a teacher's chat.
 *      Excluded: HTML pages (they isolate with CSS `.ltr`), LLM prompt text (the model is
 *      instructed, not the teacher), and URLs.
 */

// helper-agent builds an LLM client at load; no network is touched by these tests.
jest.mock('../../shared/services/llm-client', () => ({ getClient: () => ({}) }));

const fs = require('fs');
const path = require('path');

const LRI = '⁦';
const PDI = '⁩';
const RTL = /[֐-ࣿ]/;
// A slash command a teacher can type. `reading test` is the one two-word command.
const CMD = /\/(reading test|menu|observe2|observe|video|language|quiz|portal|trainings?|status|register|roster|class|settings|cancel|remark|certificates?)\b/gi;

/** Every bare (un-isolated) command occurrence in s. */
function bareCommands(s) {
  const out = [];
  for (const m of s.matchAll(CMD)) {
    const before = s.slice(0, m.index);
    const prev = before.slice(-1);
    // part of a URL or a path (`${portalBase}/portal/login`, `https://…/menu`), not a command
    if (/[\w}.:/]/.test(prev)) continue;
    const after = s.slice(m.index + m[0].length);
    if (prev === LRI && after.startsWith(PDI)) continue;
    out.push(m[0]);
  }
  return out;
}

function walk(obj, at, sink, seen = new Set()) {
  if (obj == null) return;
  if (typeof obj === 'string') { if (RTL.test(obj)) sink.push([at, obj]); return; }
  if (typeof obj !== 'object' || seen.has(obj)) return;
  seen.add(obj);
  for (const [k, v] of Object.entries(obj)) walk(v, `${at}.${k}`, sink, seen);
}

describe('bd-5ls6qy.7 — the reported string', () => {
  const HelperAgentService = require('../../shared/services/helper-agent.service');

  test('AWAITING_MENU_CHOICE in Urdu carries /menu and (1-4) inside isolates', () => {
    const ur = HelperAgentService.getEscapePathMessage('AWAITING_MENU_CHOICE', 'ur');
    expect(ur).toContain(`${LRI}/menu${PDI}`);
    expect(ur).toContain(`${LRI}(1-4)${PDI}`);
    expect(bareCommands(ur)).toEqual([]);
  });

  test('the English line is untouched (its paragraph is already left-to-right)', () => {
    const en = HelperAgentService.getEscapePathMessage('AWAITING_MENU_CHOICE', 'en');
    expect(en).toBe('📋 Please choose an option (1-4) from the menu above.\n\nOr type /menu to see the menu again.');
  });

  test('every escape-path state, in every RTL language, isolates its commands', () => {
    const states = ['CONDUCTING_CONVERSATION', 'AWAITING_MENU_CHOICE', 'AWAITING_VIDEO_TOPIC',
      'AWAITING_LESSON_PLAN', 'AWAITING_CLASSROOM_AUDIO', 'UNKNOWN_STATE_FOR_DEFAULT'];
    const bad = [];
    for (const st of states) {
      for (const lang of ['ur', 'ar']) {
        const s = HelperAgentService.getEscapePathMessage(st, lang); // a missing `ar` falls back to English
        if (s && RTL.test(s) && bareCommands(s).length) bad.push(`${st}.${lang}: ${bareCommands(s)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('bd-5ls6qy.7 — the catalogs the bot sends from', () => {
  const catalogs = {
    UX_STRINGS: () => require('../../shared/config/ux-strings').UX_STRINGS,
    observeStrings: () => require('../../shared/services/observe/observe-strings').observeStrings('ur'),
    observe2Strings: () => require('../../shared/services/observe/observe2/strings').observe2Strings('ur'),
    capabilities: () => require('../../shared/config/capabilities.config'),
  };

  test.each(Object.keys(catalogs))('%s: no bare slash command in any RTL string', (name) => {
    const sink = [];
    walk(catalogs[name](), name, sink);
    expect(sink.length).toBeGreaterThan(0); // the walk really reached RTL copy
    const bad = sink.filter(([, s]) => bareCommands(s).length).map(([at, s]) => `${at}: ${bareCommands(s)}`);
    expect(bad).toEqual([]);
  });
});

describe('bd-5ls6qy.7 — ratchet: no bare command in an RTL string literal anywhere teacher-facing', () => {
  const ROOT = path.resolve(__dirname, '../..');
  const EXCLUDE = [
    /\/tests?\//,
    /\.page\.js$/,                                  // HTML pages: `.ltr` span via CSS
    /\/templates\//,                                // HTML report templates
    /\/child-test\/render\//,                       // HTML renderers
    /\/quiz\/web-quiz-/,                            // HTML quiz pages
    /\/openai\.service\.js$/,                       // LLM prompt text, not sent to a teacher
    /\/transcript-enhancer\.service\.js$/,          // LLM prompt text
    /\/config\/system-messages\.js$/,              // orphaned: nothing requires it (tests/setup/orphan-modules)
  ];
  const LIT = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/gs;

  function files(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) return d.name === 'node_modules' ? [] : files(p);
      return d.name.endsWith('.js') ? [p] : [];
    });
  }

  test('every RTL literal isolates its slash commands', () => {
    const targets = [...files(path.join(ROOT, 'shared')), ...files(path.join(ROOT, 'workers')),
      path.join(ROOT, 'whatsapp-bot.js')].filter((f) => !EXCLUDE.some((rx) => rx.test(f)));
    const bad = [];
    for (const f of targets) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(LIT)) {
        // decode the escapes the way the runtime will, so `⁦/menu⁩` counts as isolated
        const lit = m[0].slice(1, -1).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
        if (!RTL.test(lit)) continue;
        const b = bareCommands(lit);
        if (b.length) bad.push(`${path.relative(ROOT, f)}:${src.slice(0, m.index).split('\n').length} ${b.join(' ')}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
