/**
 * L8 — child-test simulation driver (bd-s1oo0.8).
 *
 * The driver plays a coach against a WhatsApp bot: it sends the fixture voice notes and strip photos as
 * real WhatsApp media, follows the list / buttons / check Flow, and writes every send and reply to a
 * timeline. These tests run it for real against bot/scripts/e2e/mock-graph-api.js (the same mock the
 * E2E lane uses) with a FAKE PEER BOT on the far side — a stand-in for the network boundary, speaking
 * the CONTRACT §5/§6 conversation (ctst_ ids). No first-party module is mocked.
 *
 * Red-first: fails on childtest-golive — bot/scripts/e2e/child-test-sim/ does not exist.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { createMockGraphApi } = require('../../../bot/scripts/e2e/mock-graph-api');

const SIM = '../../../bot/scripts/e2e/child-test-sim';
const { createTimeline, summarise } = require(SIM + '/timeline');
const { mockTransport, sandboxTransport, assertSafeTarget } = require(SIM + '/transports');
const { runVisit } = require(SIM + '/coach');
const { createFakeBot } = require(SIM + '/fake-bot');

const PH = 'ph-sim';
const DRIVER = '923000000077';
let tmp;

function fixtureDir(id) {
  const d = path.join(tmp, 'fx', id);
  fs.mkdirSync(d, { recursive: true });
  for (const b of ['urdu', 'english', 'maths']) fs.writeFileSync(path.join(d, b + '.ogg'), Buffer.from('OggS-fake-' + id + '-' + b));
  fs.writeFileSync(path.join(d, 'key.json'), JSON.stringify({ fixture_id: id, grade: 3 }));
  return d;
}
function stripFile(id) {
  const p = path.join(tmp, id + '.jpg');
  fs.writeFileSync(p, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  return p;
}

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l8-sim-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('timeline', () => {
  test('appends one JSON line per event with a monotonic clock and the ms since the previous event', () => {
    let now = 1000;
    const tl = createTimeline(path.join(tmp, 'timeline.jsonl'), { clock: () => now });
    tl.log({ dir: 'out', kind: 'text', step: 'start' });
    now = 1350;
    tl.log({ dir: 'in', kind: 'interactive.list', step: 'list' });
    const lines = fs.readFileSync(path.join(tmp, 'timeline.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ t_ms: 0, dir: 'out', step: 'start' });
    expect(lines[1]).toMatchObject({ t_ms: 350, since_prev_ms: 350, dir: 'in' });
    expect(lines[1].iso).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  test('summarise turns send→reply pairs into the rtt samples the timing model reads', () => {
    const ev = [
      { t_ms: 0, dir: 'out', kind: 'text', step: 'start' },
      { t_ms: 900, dir: 'in', kind: 'interactive.list' },
      { t_ms: 1000, dir: 'out', kind: 'audio', step: 'block', child: 'c1', block: 'urdu' },
      { t_ms: 3500, dir: 'in', kind: 'text' },
      { t_ms: 4000, dir: 'out', kind: 'flow', step: 'check', child: 'c1' },
      { t_ms: 5200, dir: 'in', kind: 'text' },
      { t_ms: 6000, dir: 'mark', step: 'child_done', child: 'c1' },
    ];
    const s = summarise(ev);
    expect(s.rtt_samples.rtt_text_reply).toEqual([0.9]);
    expect(s.rtt_samples.rtt_media_ack).toEqual([2.5]);
    expect(s.rtt_samples.rtt_flow_screen).toEqual([1.2]);
    expect(s.per_child.c1.blocks.urdu.ack_s).toBe(2.5);
    expect(s.total_s).toBe(6);
  });
});

describe('safety', () => {
  test('a sandbox target must be on the allowlist; production hosts are refused outright', () => {
    expect(() => assertSafeTarget('https://portal.niete.edu.pk/webhook', ['portal.niete.edu.pk'])).toThrow(/production/i);
    expect(() => assertSafeTarget('https://bot-sandbox.up.railway.app/webhook', [])).toThrow(/allowlist/i);
    expect(() => assertSafeTarget('https://bot-sandbox.up.railway.app/webhook', ['bot-sandbox.up.railway.app'])).not.toThrow();
  });
});

describe('sandbox transport (fake Graph + fake bot on localhost)', () => {
  test('uploads the fixture as WhatsApp media with the WABA token, then posts a signed webhook carrying that media id', async () => {
    const seen = { upload: null, webhook: null };
    const srv = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        if (req.url.endsWith('/media')) {
          seen.upload = { auth: req.headers.authorization, ct: req.headers['content-type'], body: body.toString('latin1') };
          res.end(JSON.stringify({ id: 'media-777' }));
        } else if (req.url === '/webhook') {
          seen.webhook = { sig: req.headers['x-hub-signature-256'], body: body.toString() };
          res.end('ok');
        } else { res.statusCode = 404; res.end(); }
      });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + srv.address().port;
    try {
      const t = sandboxTransport({
        botUrl: base + '/webhook', graphBase: base, phoneNumberId: 'pn-1', wabaToken: 'tok-abc', appSecret: 'sec-1',
        driver: DRIVER, allowHosts: ['127.0.0.1'], replies: { poll: async () => [] },
      });
      const r = await t.sendMedia('audio', fixtureDir('fx1') + '/urdu.ogg');
      expect(r.mediaId).toBe('media-777');
      expect(seen.upload.auth).toBe('Bearer tok-abc');
      expect(seen.upload.ct).toMatch(/multipart\/form-data/);
      expect(seen.upload.body).toContain('audio/ogg');
      const hook = JSON.parse(seen.webhook.body);
      const msg = hook.entry[0].changes[0].value.messages[0];
      expect(msg).toMatchObject({ from: DRIVER, type: 'audio', audio: { id: 'media-777', voice: true } });
      expect(hook.entry[0].changes[0].value.metadata.phone_number_id).toBe('pn-1');
      const want = 'sha256=' + crypto.createHmac('sha256', 'sec-1').update(seen.webhook.body).digest('hex');
      expect(seen.webhook.sig).toBe(want);
    } finally { await new Promise((r) => srv.close(r)); }
  });
});

describe('a five-child visit end to end through mock-graph-api', () => {
  let api, bot, base;
  beforeEach(async () => {
    bot = createFakeBot({ phoneNumberId: PH, absentRolls: [2] });
    const botPort = await bot.listen(0);
    api = createMockGraphApi({ phoneNumberId: PH, botUrl: 'http://127.0.0.1:' + botPort, quiet: true });
    const port = await api.listen(0);
    base = 'http://127.0.0.1:' + port;
    bot.setGraphBase(base);
  });
  afterEach(async () => { await api.close(); await bot.close(); });

  test('sends 3 voice notes + 1 photo per child, takes the alternate for an absent child, submits 5 checks, times everything', async () => {
    const tlPath = path.join(tmp, 'run', 'timeline.jsonl');
    const tl = createTimeline(tlPath);
    const ids = ['fxA', 'fxB', 'fxC', 'fxD', 'fxE'];
    const fixtures = ids.map((id) => ({ id, dir: fixtureDir(id), strip: stripFile('strip-' + id) }));
    const transport = mockTransport({ baseUrl: base, driver: DRIVER, pollMs: 20 });
    const res = await runVisit({ transport, timeline: tl, fixtures, absentRolls: [2], checks: 'batch', timeoutMs: 5000 });

    expect(res.ok).toBe(true);
    expect(res.children).toHaveLength(5);
    expect(res.absent).toEqual([expect.objectContaining({ roll: 2 })]);
    expect(res.checksSubmitted).toBe(5);
    // what the bot actually received: 15 voice notes, all flagged voice, and 5 images
    expect(bot.received.filter((m) => m.type === 'audio' && m.audio.voice === true)).toHaveLength(15);
    expect(bot.received.filter((m) => m.type === 'image')).toHaveLength(5);
    expect(bot.receivedMediaBytes.some((b) => b.toString().startsWith('OggS-fake-fxA-urdu'))).toBe(true);
    // and the timeline holds every step, readable by the summariser
    const ev = fs.readFileSync(tlPath, 'utf8').trim().split('\n').map(JSON.parse);
    expect(ev.filter((e) => e.dir === 'out' && e.kind === 'audio')).toHaveLength(15);
    expect(ev.filter((e) => e.step === 'child_done')).toHaveLength(5);
    const s = summarise(ev);
    expect(s.rtt_samples.rtt_media_ack.length).toBe(20);
    expect(s.rtt_samples.rtt_flow_screen.length).toBe(5);
    expect(Object.keys(s.per_child)).toHaveLength(5);
  });

  test('a bot that never answers fails the step loudly with the step name, never hangs', async () => {
    bot.mute = true;
    const tl = createTimeline(path.join(tmp, 'mute', 'timeline.jsonl'));
    const transport = mockTransport({ baseUrl: base, driver: DRIVER, pollMs: 20 });
    const res = await runVisit({ transport, timeline: tl, fixtures: [{ id: 'fxZ', dir: fixtureDir('fxZ'), strip: stripFile('z') }], timeoutMs: 300 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/timeout waiting for: today's list/i);
  });
});

describe('driver fixture choice', () => {
  const { pickFixtures, attachStrips } = require(SIM + '/driver');
  test('--pick spreads the five children across reading bands and skips fixtures that failed the cut check', () => {
    const dir = path.join(tmp, 'real');
    fs.mkdirSync(dir, { recursive: true });
    const man = [
      { fixture_id: 'f1', grade: 3, band: 'fluent', usable_for_accuracy: true },
      { fixture_id: 'f2', grade: 3, band: 'fluent', usable_for_accuracy: true },
      { fixture_id: 'bad', grade: 3, band: 'non_reader', usable_for_accuracy: false },
      { fixture_id: 'n1', grade: 5, band: 'non_reader', usable_for_accuracy: true },
      { fixture_id: 'd1', grade: 3, band: 'developing', usable_for_accuracy: true },
      { fixture_id: 'skip', skipped: 'no segment labels' },
    ];
    fs.writeFileSync(path.join(dir, '_manifest.json'), JSON.stringify(man));
    const got = pickFixtures(dir, 3).map((f) => f.id);
    expect(got).toHaveLength(3);
    expect(new Set(got)).toEqual(new Set(['d1', 'f1', 'n1']));     // one per band before any band repeats
    expect(got).not.toContain('bad');
  });

  test('each child gets a strip photo of its own grade, round-robin', () => {
    const sd = path.join(tmp, 'strips'); fs.mkdirSync(sd, { recursive: true });
    for (const f of ['strip-g3-00-d1.jpg', 'strip-g3-02-d2.jpg', 'strip-g5-01-d1.jpg', 'strip-kie-1.jpg']) fs.writeFileSync(path.join(sd, f), 'x');
    const fx = attachStrips([{ id: 'a', grade: 3 }, { id: 'b', grade: 5 }, { id: 'c', grade: 3 }, { id: 'd', grade: 3 }], sd);
    expect(fx.map((f) => path.basename(f.strip))).toEqual(['strip-g3-00-d1.jpg', 'strip-g5-01-d1.jpg', 'strip-g3-02-d2.jpg', 'strip-g3-00-d1.jpg']);
  });
});

describe("L4's real ids (childtest-golive @ ca1d70f9 machine.js)", () => {
  let api, bot, base;
  beforeEach(async () => {
    // ctst_child:<drawId> / ctst_alt:<drawId> rows, ctst_pres:<drawId>:p|a|r buttons, the roll first in the row
    // title, and an absent child that STAYS on the list (marked) while the alternate is taken from its section.
    bot = createFakeBot({ phoneNumberId: PH, idStyle: 'l4' });
    const botPort = await bot.listen(0);
    api = createMockGraphApi({ phoneNumberId: PH, botUrl: 'http://127.0.0.1:' + botPort, quiet: true });
    base = 'http://127.0.0.1:' + (await api.listen(0));
    bot.setGraphBase(base);
  });
  afterEach(async () => { await api.close(); await bot.close(); });

  test('the default matchers drive the L4 conversation: picks rows, taps :p / :a, takes the alternate row', async () => {
    const tl = createTimeline(path.join(tmp, 'l4', 'timeline.jsonl'));
    const fixtures = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, dir: fixtureDir(id), strip: stripFile('s' + id) }));
    const res = await runVisit({ transport: mockTransport({ baseUrl: base, driver: DRIVER, pollMs: 20 }), timeline: tl,
      fixtures, absentRolls: [2], timeoutMs: 5000 });
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(res.children.map((c) => c.roll)).toEqual([1, 3, 4, 5, 6]);
    expect(bot.received.filter((m) => m.type === 'interactive' && m.interactive.type === 'button_reply').map((m) => m.interactive.button_reply.id))
      .toEqual(['ctst_pres:d1:p', 'ctst_pres:d2:a', 'ctst_pres:d3:p', 'ctst_pres:d4:p', 'ctst_pres:d5:p', 'ctst_pres:d6:p']);
    expect(res.checksSubmitted).toBe(5);
  });
});
