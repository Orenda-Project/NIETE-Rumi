/**
 * student-join-flow-v2.json — structural test for the LOCALIZED student join Flow.
 *
 * A child opening a quiz link they have never used meets this screen before
 * question 1. The first published version (student-join-flow.json) hardcoded its
 * words in English, so an Urdu child was asked "Your name" / "Your class" and
 * tapped "Start the quiz". A Flow asset is one per WABA and cannot be re-rendered
 * per child (whatsapp-flows skill, rule 12), so the only way a child reads their
 * own language is for every visible word to arrive as navigate-mode screen data.
 *
 * Static (no data_api_version, no endpoint): the bot supplies the data in
 * flow_action_payload.data when it sends the Flow, and the submission comes back
 * as an nfm_reply on the `vqjoin:` token with exactly the fields
 * video-quiz-share.service#handleJoinFlowReply reads.
 */

const fs = require('fs');
const path = require('path');

const FLOWS_DIR = path.resolve(__dirname, '../../docs/flows');
const V2_PATH = path.join(FLOWS_DIR, 'student-join-flow-v2.json');
const LEGACY_PATH = path.join(FLOWS_DIR, 'student-join-flow.json');

const BINDING = /^\$\{data\.([a-zA-Z_][a-zA-Z0-9_]*)\}$/;
const cp = (s) => [...String(s)].length;

function loadFlow(p = V2_PATH) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function collectNodes(node, acc = []) {
  if (Array.isArray(node)) {
    for (const n of node) collectNodes(n, acc);
    return acc;
  }
  if (node && typeof node === 'object') {
    acc.push(node);
    for (const v of Object.values(node)) collectNodes(v, acc);
  }
  return acc;
}

function dataBindings(value) {
  const found = new Set();
  const walk = (v) => {
    if (typeof v === 'string') {
      const re = /\$\{data\.([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
      let m;
      while ((m = re.exec(v)) !== null) found.add(m[1]);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return found;
}

/** Every string a child reads on the screen, with the property it sits in. */
function visibleText(screen) {
  const out = [{ where: 'screen.title', value: screen.title }];
  for (const n of collectNodes(screen.layout)) {
    if (n.type === 'TextHeading' || n.type === 'TextBody' || n.type === 'TextSubheading' || n.type === 'TextCaption') {
      out.push({ where: `${n.type}.text`, value: n.text });
    }
    if (n.type === 'TextInput' || n.type === 'TextArea') {
      out.push({ where: `${n.type}(${n.name}).label`, value: n.label });
      if (n['helper-text'] !== undefined) out.push({ where: `${n.type}(${n.name}).helper-text`, value: n['helper-text'] });
    }
    if (n.type === 'Footer') out.push({ where: 'Footer.label', value: n.label });
  }
  return out;
}

describe('student-join-flow-v2.json', () => {
  test('parses, and is a version that binds screen titles, input labels and footers to data (7.0)', () => {
    const flow = loadFlow();
    // Dynamic screen titles, TextInput labels/helper-text and Footer labels are
    // all served today by 7.0 Flows published on this deployment's WABA
    // (transcript-quiz, assessment-gen/-review, remark), so 7.0 is enough.
    expect(flow.version).toBe('7.0');
  });

  test('exactly one screen, WHO, terminal — the screen the bot opens it on', () => {
    const flow = loadFlow();
    expect(flow.screens).toHaveLength(1);
    expect(flow.screens[0].id).toBe('WHO');
    expect(flow.screens[0].terminal).toBe(true);
  });

  test('is static: no data_api_version, no routing model, no endpoint', () => {
    const flow = loadFlow();
    expect(flow.data_api_version).toBeUndefined();
    expect(flow.routing_model).toBeUndefined();
    expect(JSON.stringify(flow)).not.toMatch(/endpoint_uri|data_exchange/);
  });

  test('every word a child reads is a ${data.*} binding — nothing hardcoded in either language', () => {
    const screen = loadFlow().screens[0];
    const hardcoded = visibleText(screen).filter(({ value }) => !BINDING.test(String(value)));
    expect(hardcoded).toEqual([]);
  });

  test('every binding is declared as a string with an example, and every declaration is used', () => {
    const screen = loadFlow().screens[0];
    const declared = screen.data || {};
    const used = dataBindings(screen.layout);
    if (BINDING.test(screen.title)) used.add(BINDING.exec(screen.title)[1]);

    expect([...used].filter((k) => !(k in declared))).toEqual([]);
    expect(Object.keys(declared).filter((k) => !used.has(k))).toEqual([]);
    for (const [k, spec] of Object.entries(declared)) {
      expect({ k, type: spec.type }).toEqual({ k, type: 'string' });
      expect(typeof spec.__example__).toBe('string');
    }
  });

  test('the examples fit the fields they stand in for (code points)', () => {
    const screen = loadFlow().screens[0];
    const d = screen.data;
    expect(cp(d.title.__example__)).toBeLessThanOrEqual(30);
    expect(cp(d.heading.__example__)).toBeLessThanOrEqual(80);
    expect(cp(d.name_label.__example__)).toBeLessThanOrEqual(20);
    expect(cp(d.class_label.__example__)).toBeLessThanOrEqual(20);
    expect(cp(d.name_help.__example__)).toBeLessThanOrEqual(80);
    expect(cp(d.class_help.__example__)).toBeLessThanOrEqual(80);
    expect(cp(d.cta.__example__)).toBeLessThanOrEqual(35);
  });

  test('asks for a name and a class, both required, as student_name and student_class', () => {
    const nodes = collectNodes(loadFlow().screens[0].layout);
    const inputs = nodes.filter((n) => n.type === 'TextInput');
    expect(inputs.map((n) => n.name)).toEqual(['student_name', 'student_class']);
    for (const n of inputs) expect(n.required).toBe(true);
  });

  test('the footer COMPLETES with exactly the fields handleJoinFlowReply reads', () => {
    // A data_exchange footer would render the same screen and deliver nothing:
    // nfm_reply only fires when the Flow terminates on the client.
    const footer = collectNodes(loadFlow().screens[0].layout).find((n) => n.type === 'Footer');
    expect(footer['on-click-action'].name).toBe('complete');
    expect(footer['on-click-action'].payload).toEqual({
      student_name: '${form.student_name}',
      student_class: '${form.student_class}',
    });
  });

  test('the same contract as the legacy asset, so one reply handler serves both', () => {
    const legacy = loadFlow(LEGACY_PATH);
    const v2 = loadFlow();
    const shape = (f) => {
      const nodes = collectNodes(f.screens[0].layout);
      return {
        screen: f.screens[0].id,
        inputs: nodes.filter((n) => n.type === 'TextInput').map((n) => [n.name, n['input-type'], n.required]),
        footer: nodes.find((n) => n.type === 'Footer')['on-click-action'],
      };
    };
    expect(shape(v2)).toEqual(shape(legacy));
  });
});
