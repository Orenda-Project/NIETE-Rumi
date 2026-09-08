/**
 * flow-emulator — plays Meta's side of a WhatsApp Flow from its stored JSON.
 *
 * What it must get right, because the feature scripts and the bot both depend on it:
 *   · screens, their visible components, `${data.x}` / `${form.x}` bindings, Form init-values,
 *     `visible` conditions, the routing model (a transition the model forbids is refused);
 *   · Footer actions: `navigate` (payload becomes the next screen's data), `data_exchange`
 *     (an ENCRYPTED round trip to the bot's endpoint — the bot's own flow-encryption.service is
 *     the counterpart in these tests, so the contract is the real one), `complete` (the
 *     nfm_reply payload: the action payload, or the endpoint's extension_message_response.params);
 *   · a probe shaped like the browser helper's: { text, items:[{text, disabled, kind}] };
 *   · honesty: PhotoPicker and anything else it does not model is refused, not faked.
 *
 * Red-first: fails on develop — the module does not exist.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { createEmulator, FlowTransport } = require('../../bot/scripts/e2e/flow-emulator');
const enc = require('../../bot/shared/services/flow-encryption.service');

const SETTINGS = JSON.parse(fs.readFileSync(path.join(__dirname, '../../.claude/qa/fixtures/flows/SETTINGS_FLOW_ID.json'), 'utf8'));

const NAV = {
  version: '6.3',
  routing_model: { PICK: ['DONE'], DONE: [] },
  screens: [
    { id: 'PICK', title: 'Pick a level', layout: { type: 'SingleColumnLayout', children: [
      { type: 'Form', name: 'f', children: [
        { type: 'TextHeading', text: 'Which level?' },
        { type: 'TextBody', text: 'Hidden hint', visible: false },
        { type: 'RadioButtonsGroup', name: 'level', label: 'Level', required: true, 'data-source': [{ id: 'l1', title: 'Level 1' }, { id: 'l2', title: 'Level 2', enabled: false }] },
        { type: 'TextInput', name: 'note', label: 'Note', required: false },
        { type: 'Footer', label: 'Next', 'on-click-action': { name: 'navigate', next: { type: 'screen', name: 'DONE' }, payload: { level: '${form.level}', note: '${form.note}' } } },
      ] } ] } },
    { id: 'DONE', title: 'Done', terminal: true, data: { level: { type: 'string', __example__: 'l1' } }, layout: { type: 'SingleColumnLayout', children: [
      { type: 'TextBody', text: 'You chose ${data.level}' },
      { type: 'Footer', label: 'Finish', 'on-click-action': { name: 'complete', payload: { level: '${data.level}', note: '${data.note}' } } },
    ] } },
  ],
};

describe('flow-emulator: navigate Flow', () => {
  test('opens on the requested screen and probes what a teacher would see', async () => {
    const em = createEmulator(NAV, { flowId: 'f1', flowToken: 'tok', action: 'navigate', screen: 'PICK' });
    await em.open();
    const p = em.probe();
    expect(p.screen).toBe('PICK');
    expect(p.text).toContain('Which level?');
    expect(p.text).not.toContain('Hidden hint');
    expect(p.items.map((i) => i.text)).toEqual(['Level 1', 'Level 2', 'Note', 'Next']);
    expect(p.items.find((i) => i.text === 'Level 2').disabled).toBe(true);
    expect(p.items.find((i) => i.text === 'Next').disabled).toBe(true);   // required `level` unset
  });

  test('pick fills a required field, the footer enables, navigate carries the payload into the next screen data', async () => {
    const em = createEmulator(NAV, { flowId: 'f1', flowToken: 'tok', action: 'navigate', screen: 'PICK' });
    await em.open();
    expect(em.pick('Level 2')).toEqual({ ok: false, err: 'OPTION_DISABLED:Level 2' });
    expect(em.pick('Level 1')).toEqual({ ok: true, picked: 'Level 1' });
    expect(em.type('remember this')).toEqual({ ok: true, typed: 'remember this' });
    expect(em.state('Next')).toEqual({ found: true, text: 'Next', disabled: false });
    const r = await em.click('Next');
    expect(r).toEqual({ ok: true, clicked: 'Next' });
    expect(em.probe().screen).toBe('DONE');
    expect(em.probe().text).toContain('You chose l1');
  });

  test('complete produces the nfm_reply payload and closes the Flow', async () => {
    const done = [];
    const em = createEmulator(NAV, { flowId: 'f1', flowToken: 'tok', action: 'navigate', screen: 'PICK', onComplete: (r) => done.push(r) });
    await em.open(); em.pick('Level 1'); em.type('n'); await em.click('Next');
    const r = await em.click('Finish');
    expect(r.ok).toBe(true);
    expect(done).toEqual([{ flowId: 'f1', flowToken: 'tok', name: 'flow_f1', response_json: { level: 'l1', note: 'n' } }]);
    expect(em.isOpen()).toBe(false);
  });

  test('click on an OPTION\'s text selects it — the browser helper clicks whatever carries the text (lesson-plan.cjs drives lists this way)', async () => {
    const em = createEmulator(NAV, { flowId: 'f1', flowToken: 'tok', action: 'navigate', screen: 'PICK' });
    await em.open();
    expect(await em.click('Level 1')).toEqual({ ok: true, clicked: 'Level 1' });
    expect(em.state('Next')).toEqual({ found: true, text: 'Next', disabled: false });
    expect(await em.click('Level 2')).toEqual({ ok: false, err: 'DISABLED:Level 2' });
  });

  test('refuses a transition the routing model does not allow, and an unknown item, as harness errors', async () => {
    const bad = JSON.parse(JSON.stringify(NAV)); bad.routing_model.PICK = [];
    const em = createEmulator(bad, { flowId: 'f1', flowToken: 'tok', action: 'navigate', screen: 'PICK' });
    await em.open(); em.pick('Level 1');
    const r = await em.click('Next');
    expect(r).toEqual({ ok: false, err: 'ROUTING_REFUSED:PICK→DONE' });
    // a miss names what WAS on screen, so a failed run explains itself without a re-run
    expect(await em.click('Nope')).toEqual({ ok: false, err: 'NO_ITEM:Nope', seen: ['Level 1', 'Level 2', 'Note', 'Next'] });
    expect(em.pick('Level 9')).toEqual({ ok: false, err: 'OPTION_ABSENT:Level 9' });
  });

  test('click matches the text a teacher sees ANYWHERE on a list row — description and metadata too, as the browser does', async () => {
    // The K-5 lesson rows are titled "○ Memory Lane" and carry "Day 1 · p.2" in the description;
    // lesson-plan.cjs taps "Day 1", which the browser finds because it clicks any text on the row.
    const LIST = { version: '6.3', routing_model: { L: [] }, screens: [{ id: 'L', title: 'Lessons', terminal: true, layout: { type: 'SingleColumnLayout', children: [
      { type: 'NavigationList', name: 'lessons', 'list-items': '${data.items}' } ] } }] };
    const done = [];
    const em = createEmulator(LIST, { flowId: 'f2', flowToken: 'tok', action: 'navigate', screen: 'L', onComplete: (r) => done.push(r), data: { items: [
      { id: 'seg1', 'main-content': { title: '○ Memory Lane', description: 'Day 1 · p.2', metadata: 'All About Me' }, 'on-click-action': { name: 'complete', payload: { lesson: 'seg1' } } },
      { id: 'seg2', 'main-content': { title: '○ Journey Through the Text', description: 'Day 2 · p.3-4' }, 'on-click-action': { name: 'complete', payload: { lesson: 'seg2' } } } ] } });
    await em.open();
    expect(em.probe().items.map((i) => i.text)).toEqual(['○ Memory Lane', '○ Journey Through the Text']);   // probe shows titles, as the screen does
    // probe().text is what the browser's dialog innerText would be — the rows are part of it, so a
    // script asserting /Grade 1/ on the grade screen reads the same thing on both lanes (lesson-plan L10)
    expect(em.probe().text).toContain('○ Memory Lane');
    expect(em.probe().text).toContain('Day 2 · p.3-4');
    expect(await em.click('Day 2')).toEqual({ ok: true, clicked: '○ Journey Through the Text' });
    expect(done.map((d) => d.response_json)).toEqual([{ lesson: 'seg2' }]);
  });

  test('a component it does not model is refused honestly, never faked', async () => {
    const pp = JSON.parse(JSON.stringify(NAV));
    pp.screens[0].layout.children[0].children.push({ type: 'PhotoPicker', name: 'photos', label: 'Add a photo' });
    const em = createEmulator(pp, { flowId: 'f1', flowToken: 'tok', action: 'navigate', screen: 'PICK' });
    await expect(em.open()).rejects.toThrow(/UNSUPPORTED_COMPONENT:PhotoPicker/);
  });
});

describe('flow-emulator: endpoint (data_exchange) Flow against the bot\'s own encryption', () => {
  let server, url, keys, seen;
  beforeAll(async () => {
    keys = enc.generateKeyPair();
    process.env.FLOW_PRIVATE_KEY = keys.privateKey;      // the bot side decrypts with this
    seen = [];
    // A stand-in for /api/flows/settings that speaks the REAL contract: processEncryptedRequest.
    server = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', async () => {
        try {
          const out = await enc.processEncryptedRequest(JSON.parse(b), async (d) => {
            seen.push(d);
            if (d.action === 'ping') return enc.handlePing();
            if (d.action === 'INIT') return { screen: 'SETTINGS_MAIN', data: { languages: [{ id: 'en', title: 'English' }, { id: 'ur', title: 'اردو (Urdu)' }],
              frameworks: [{ id: 'oecd', title: 'OECD 5D Framework' }, { id: 'hots', title: 'HOTS Framework' }], current_language: 'en', current_framework: 'oecd', info_text: 'Default for your region: OECD.' } };
            if (d.action === 'data_exchange' && d.screen === 'SETTINGS_MAIN') return { screen: 'SUCCESS', data: { confirmation_message: 'Your settings have been saved.',
              details_message: `Language: ${d.data.language} | Observation: ${d.data.observation_framework}`,
              extension_message_response: { params: { flow_token: d.flow_token, language: d.data.language, observation_framework: d.data.observation_framework } } } };
            return enc.createErrorResponse('unexpected');
          });
          res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(out);
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${server.address().port}/api/flows/settings`;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  test('the transport encrypts like the WhatsApp client and decrypts the flipped-IV response', async () => {
    const t = new FlowTransport({ publicKeyPem: keys.publicKey });
    const res = await t.exchange(url, { version: '3.0', action: 'ping' });
    expect(res).toEqual({ data: { status: 'active' } });
    expect(seen[seen.length - 1].action).toBe('ping');
  });

  test('INIT loads the first screen from the endpoint; init-values prefill the form; a data_exchange submit reaches SUCCESS with the completion params', async () => {
    const done = [];
    const em = createEmulator(SETTINGS, { flowId: 's1', flowToken: 'user-1:settings:1', action: 'data_exchange',
      transport: new FlowTransport({ publicKeyPem: keys.publicKey }), endpointUrl: url, onComplete: (r) => done.push(r) });
    await em.open();
    const p = em.probe();
    expect(p.screen).toBe('SETTINGS_MAIN');
    expect(p.text).toContain('Default for your region: OECD.');
    expect(p.items.map((i) => i.text)).toEqual(expect.arrayContaining(['English', 'اردو (Urdu)', 'OECD 5D Framework', 'HOTS Framework', 'Save Settings']));
    expect(em.state('Save Settings')).toEqual({ found: true, text: 'Save Settings', disabled: false });   // init-values satisfied `required`
    expect(em.pick('اردو (Urdu)')).toEqual({ ok: true, picked: 'اردو (Urdu)' });
    const r = await em.click('Save Settings');
    expect(r).toEqual({ ok: true, clicked: 'Save Settings' });
    const sent = seen[seen.length - 1];
    expect(sent).toMatchObject({ action: 'data_exchange', screen: 'SETTINGS_MAIN', flow_token: 'user-1:settings:1', data: { language: 'ur', observation_framework: 'oecd' } });
    expect(em.probe().screen).toBe('SUCCESS');
    expect(em.probe().text).toContain('Language: ur | Observation: oecd');
    await em.click('Done');
    expect(done).toEqual([{ flowId: 's1', flowToken: 'user-1:settings:1', name: 'flow_s1',
      response_json: { flow_token: 'user-1:settings:1', language: 'ur', observation_framework: 'oecd' } }]);
  });

  test('an endpoint error response is surfaced, not swallowed', async () => {
    const em = createEmulator(SETTINGS, { flowId: 's1', flowToken: 'user-1:settings:1', action: 'data_exchange',
      transport: new FlowTransport({ publicKeyPem: keys.publicKey }), endpointUrl: url });
    await em.open(); em.pick('English');
    // force the endpoint's error branch by driving from a screen the stub does not know
    em._debugSetScreen('SUCCESS');
    const r = await em.exchange({ anything: 1 });
    expect(r).toEqual({ ok: false, err: 'ENDPOINT_ERROR:unexpected' });
  });
});
