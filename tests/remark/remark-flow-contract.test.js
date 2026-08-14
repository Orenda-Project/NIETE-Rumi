/**
 * bd-2712 — contract guards for the /remark Supervisor Remark FLOW.
 *
 * These are cross-ARTIFACT guards, which is what this feature has been missing.
 * bd-2531 shipped 12 unit-test files over modules that had no production caller
 * (remark-flow, remark-screens, remark-write, remark-score all had ZERO non-test
 * consumers), and bd-2711 shipped a send path that could never send because every
 * test injected a fake sender. Unit tests over pure functions were never the gap;
 * agreement BETWEEN the pieces was.
 *
 * So each test here pins one artifact against another:
 *   flow JSON  ↔ itself       (every ${data.x} declared, caps, forward-only)
 *   flow JSON  ↔ remark-rubric (a 5→7 indicator revision must fail loudly)
 *   detector   ↔ endpoint tag  (the tag the endpoint emits is the one detected)
 *   catalog    ↔ WhatsApp caps (measured in CODE POINTS, not .length)
 */
const fs = require('fs');
const path = require('path');

const FLOW_PATH = path.join(__dirname, '../../docs/flows/remark-flow.json');
const flow = JSON.parse(fs.readFileSync(FLOW_PATH, 'utf8'));
const screens = Object.fromEntries(flow.screens.map((s) => [s.id, s]));

const { INDICATORS, INDICATOR_COUNT, SCALE } = require('../../bot/shared/services/remark/remark-rubric');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
const { detectFlowType } = require('../../bot/shared/utils/flow-type-detector');

const cp = (s) => [...String(s)].length;

function countComponents(node, acc = { n: 0 }) {
  if (Array.isArray(node)) node.forEach((c) => countComponents(c, acc));
  else if (node && typeof node === 'object') {
    if (node.type) acc.n += 1;
    Object.values(node).forEach((v) => countComponents(v, acc));
  }
  return acc.n;
}

describe('bd-2712 — flow JSON is internally consistent', () => {
  test('every ${data.x} reference is declared in its own screen data', () => {
    // whatsapp-flows rule 5: an undeclared field renders as the LITERAL string
    // "${data.foo}" to the principal. Nothing errors.
    for (const screen of flow.screens) {
      const refs = new Set(
        [...JSON.stringify(screen).matchAll(/\$\{data\.([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]),
      );
      const declared = new Set(Object.keys(screen.data || {}));
      const missing = [...refs].filter((r) => !declared.has(r));
      expect({ screen: screen.id, missing }).toEqual({ screen: screen.id, missing: [] });
    }
  });

  test('no screen exceeds Meta\'s 50-component ceiling', () => {
    for (const screen of flow.screens) {
      expect(countComponents(screen.layout)).toBeLessThanOrEqual(50);
    }
  });

  test('routing_model is forward-only', () => {
    // Meta rejects publish with INVALID_ROUTING_MODEL on any backward route
    // (whatsapp-flows rule 7), and a rejected publish is discovered late.
    const order = flow.screens.map((s) => s.id);
    for (const [from, dests] of Object.entries(flow.routing_model)) {
      for (const to of dests) {
        expect(order.indexOf(to)).toBeGreaterThan(order.indexOf(from));
      }
    }
  });

  test('the terminal screen is marked terminal + success', () => {
    expect(screens.SUCCESS.terminal).toBe(true);
    expect(screens.SUCCESS.success).toBe(true);
  });
});

describe('bd-2712 — flow JSON tracks the rubric', () => {
  test('one name + one options field per indicator, matching INDICATOR_COUNT', () => {
    // The rubric has ALREADY been revised twice (7 → 10 → 5 indicators). When it
    // is revised again, this fails instead of publishing a form that silently
    // collects four of seven scores — which computeS would then reject on submit,
    // after the principal has done the work.
    const declared = Object.keys(screens.RUBRIC.data);
    for (const ind of INDICATORS) {
      expect(declared).toContain(`ind${ind.ordinal}_name`);
      expect(declared).toContain(`ind${ind.ordinal}_options`);
    }
    const nameFields = declared.filter((k) => /^ind\d+_name$/.test(k));
    expect(nameFields).toHaveLength(INDICATOR_COUNT);
  });

  test('every indicator has a required Dropdown bound to its own options', () => {
    const json = JSON.stringify(screens.RUBRIC.layout);
    for (const ind of INDICATORS) {
      expect(json).toContain(`"score_${ind.ordinal}"`);
      expect(json).toContain(`\${data.ind${ind.ordinal}_options}`);
    }
  });

  test('the comment TextArea sits at Meta\'s hard 600 ceiling, not above it', () => {
    const ta = JSON.stringify(screens.RUBRIC.layout).match(/"max-length":\s*(\d+)/);
    expect(ta).not.toBeNull();
    expect(Number(ta[1])).toBeLessThanOrEqual(600);
  });
});

describe('bd-2712 — the detector recognises what the endpoint emits', () => {
  test('remark_action routes to the remark branch', () => {
    // The endpoint tags SUCCESS with remark_action (whatsapp-flows rule 10).
    // Without this the submission hits the catch-all "Thanks for your response!
    // Type /menu…" and the principal cannot tell whether it saved.
    expect(detectFlowType({ remark_action: 'submitted' })).toBe('remark');
  });

  test('it is checked BEFORE the attendance_marking near-catch-all', () => {
    // attendance_marking matches any flow_token containing ':'. A remark payload
    // that ever carried one must still resolve to remark.
    expect(detectFlowType({ remark_action: 'submitted', flow_token: 'uid:remark:1' }))
      .toBe('remark');
  });

  test('an unrelated payload is NOT claimed by remark', () => {
    expect(detectFlowType({ training_action: 'x' })).not.toBe('remark');
    expect(detectFlowType({})).not.toBe('remark');
  });
});

describe('bd-2712 — catalog copy is complete and within WhatsApp caps', () => {
  const keys = Object.keys(UX_STRINGS).filter((k) => k.startsWith('remark'));

  test('there are remark keys at all', () => {
    expect(keys.length).toBeGreaterThan(0);
  });

  test('every remark key is complete in en AND ur', () => {
    // A partial map silently degrades an Urdu principal to English rather than
    // failing (language-protocol invariant: never ship a partial map).
    for (const k of keys) {
      expect(Object.keys(UX_STRINGS[k]).sort()).toEqual(['en', 'ur']);
    }
  });

  test.each([
    ['remarkPickerLabel', 20],   // Dropdown label
    ['remarkLevelLabel', 20],    // Dropdown label
    ['remarkCommentLabel', 20],  // TextArea label — CLIPS silently past 20
    ['remarkContinue', 20],      // Footer
    ['remarkSubmit', 20],        // Footer
    ['remarkFlowButton', 20],    // interactive button — tightest field there is
    ['remarkFlowHeader', 60],    // message header
  ])('%s fits its %i code-point cap in both languages', (key, cap) => {
    for (const lang of ['en', 'ur']) {
      expect(cp(UX_STRINGS[key][lang])).toBeLessThanOrEqual(cap);
    }
  });
});

describe('bd-2712 — anchor options carry the VERBATIM rubric', () => {
  // Required late so the endpoint's lazy supabase require is never triggered at
  // module load (the process.exit(78) trap this feature hit four times).
  const { anchorOptions } = require('../../bot/shared/routes/remark-endpoint');

  test.each(['en', 'ur'])('%s: 4 options, descending, verbatim anchors', (lang) => {
    for (const ind of INDICATORS) {
      const opts = anchorOptions(ind, lang);
      expect(opts.map((o) => o.id)).toEqual(['4', '3', '2', '1']);
      for (const o of opts) {
        expect(o.title).toBe(SCALE[o.id][lang]);
        // Verbatim — not paraphrased, not truncated. STEPS reads these anchors.
        expect(o.description).toBe(ind.anchors[o.id][lang]);
        expect(cp(o.description)).toBeLessThanOrEqual(300);
      }
    }
  });
});

describe('bd-2712 follow-ups — the comment label and the "another?" button', () => {
  const fs2 = require('fs');
  const BOT = fs2.readFileSync(path.join(__dirname, '../../bot/whatsapp-bot.js'), 'utf8');

  test('the comment label does NOT claim to be optional', () => {
    // Meta appends its own "(Optional)" to any required:false field, so a label
    // saying so renders as "Comment (optional) (Optional)" — the same defect
    // recorded against the old attendance flow (bd-2532).
    for (const lang of ['en', 'ur']) {
      expect(UX_STRINGS.remarkCommentLabel[lang].toLowerCase()).not.toContain('optional');
      expect(UX_STRINGS.remarkCommentLabel[lang]).not.toContain('اختیاری');
    }
  });

  test('the comment field is still marked optional in the FLOW, not the label', () => {
    // The optionality signal has to live somewhere — assert it MOVED rather than
    // vanished, or the field silently becomes required.
    //
    // Walked rather than regex-matched: a `[^}]*` pattern stops dead at the `}`
    // inside "${data.comment_label}", so the regex version failed against correct
    // JSON. Structure questions get structural answers.
    let comment = null;
    (function walk(node) {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') {
        if (node.type === 'TextArea' && node.name === 'comment') comment = node;
        Object.values(node).forEach(walk);
      }
    })(screens.RUBRIC.layout);

    expect(comment).not.toBeNull();
    expect(comment.required).toBe(false);
  });

  test('exactly ONE follow-up button is offered', () => {
    // Two buttons would make "I am done" cost a tap. Finishing is the common
    // case, so it must be the do-nothing path.
    const block = BOT.slice(BOT.indexOf("flowType === 'remark'"));
    const buttons = block.slice(0, 1800).match(/buttons:\s*\[([^\]]*)\]/);
    expect(buttons).not.toBeNull();
    expect((buttons[1].match(/id:/g) || []).length).toBe(1);
  });

  test('the ack and the prompt are ONE message, not two', () => {
    // Shipped wrong first: the ack said "Send /remark again for the next
    // teacher." AND a button appeared underneath, telling her the same thing
    // twice — once as prose she must retype, once as a tap. The confirmation is
    // now the button message's own body.
    const block = BOT.slice(BOT.indexOf("flowType === 'remark'"));
    const scoped = block.slice(0, 2200);
    // Exactly one send on the has-teachers-left path.
    const inButtons = scoped.slice(scoped.indexOf('if (left > 0)'), scoped.indexOf('} else {'));
    expect(inButtons).toContain('sendInteractiveButtons');
    expect(inButtons).not.toContain('sendMessage');
    // And the retype instruction is gone from the catalog entirely.
    expect(UX_STRINGS.remarkAckMoreLeft).toBeUndefined();
  });

  test('the button is only offered when a teacher actually remains', () => {
    const block = BOT.slice(BOT.indexOf("flowType === 'remark'"), BOT.indexOf("flowType === 'remark'") + 1800);
    expect(block).toMatch(/if\s*\(\s*left\s*>\s*0\s*\)/);
  });

  test('tapping it re-enters through the GATED command, not the flow sender', () => {
    // A cycle can close between two teachers. Re-entering via
    // handleRemarkCommand re-checks capability AND the open cycle; calling
    // sendFlow directly would skip both.
    const route = BOT.slice(BOT.indexOf("buttonId === 'remark_next'"));
    expect(route.slice(0, 400)).toContain('handleRemarkCommand');
    expect(route.slice(0, 400)).not.toContain('sendFlow');
  });

  test('the button title fits the 20 code-point cap in both languages', () => {
    for (const lang of ['en', 'ur']) {
      expect(cp(UX_STRINGS.remarkAnotherButton[lang])).toBeLessThanOrEqual(20);
    }
  });
});
