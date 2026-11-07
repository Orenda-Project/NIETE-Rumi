const r = require('../../../shared/services/lp-v10-card/render');
const c = require('../../../shared/services/lp-v10-card/check');
const { card, clone, css, V9 } = require('../../fixtures/lp-v10-card/load');

const html = (k = card()) => r.render(k);

describe('render: card.json to the v10 phone card html', () => {
  test('the embedded CSS is card.css, byte for byte', () => {
    expect(r.CSS).toBe(css());
  });
  test('the rendered card passes the v20 gates', () => {
    const h = html();
    expect(c.moves(h).map(([n]) => n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(c.starHidden(h)).toBe(true);
    expect(c.badLinks(h, card().v9_html)).toEqual([]);
    expect(c.fixedWidth(h)).toBe(false);
    expect(c.cardPictures(h)).toBeGreaterThanOrEqual(c.v9Diagrams(V9));
  });
  test('the time bar reads from the sections', () => {
    expect(c.minutes(html())).toEqual([['open', 5], ['explain', 7], ['we', 12], ['you', 12], ['check', 4]]);
    expect(html()).toContain('PRACTICE · 24 of 40 min');
  });
  test('answers, mistake and correct are printed', () => {
    const h = html();
    expect(h).toContain('Check 5 books · answers');
    expect(h).toContain('😮 jump / far');
    expect(h).toContain('Likely mistake');
    expect(h).toContain('<b>Correct:</b>');
  });
  test('text is escaped but b and i survive', () => {
    const k = card();
    k.header.title = 'A <script>x</script> & <b>B</b> <i>i</i>';
    const h = html(k);
    expect(h).not.toContain('<script>');
    expect(h).toContain('&lt;script&gt;');
    expect(h).toContain('<b>B</b>');
    expect(h).toContain('<i>i</i>');
    expect(h).toContain('&amp;');
  });
  test('attributes escape quotes (Python html.escape quote=True: &quot; and &#x27;)', () => {
    const k = card();
    k.v9_html = 'a"b\'c.v9.html';
    expect(html(k)).toContain('href="a&quot;b&#x27;c.v9.html#v9-open"');
  });
  test('an Urdu card is rtl', () => {
    const k = card();
    k.lang = 'ur';
    expect(html(k)).toContain('<html lang="ur" dir="rtl">');
    expect(html()).toContain('<html lang="en" dir="ltr">');
  });
  test('svg pictures are carried raw; faces and steps render as lists', () => {
    const k = card();
    k.pictures.push({ id: 'dg2', after: 'explain', kind: 'svg', title: '3 + 2', svg: '<svg viewBox="0 0 10 10"><circle r="4"/></svg>' });
    expect(c.cardPictures(html(k))).toBe(2);
    expect(html(k)).toContain('<div class="svg"><svg viewBox="0 0 10 10"><circle r="4"/></svg></div>');
    const s = card();
    s.pictures = [{ id: 'dg1', after: 'you', kind: 'steps', title: 'How to add', items: ['Count', 'Join', 'Say'] }];
    expect(html(s)).toContain('<ol class="steps"><li>Count</li><li>Join</li><li>Say</li></ol>');
  });
  test('steps pairs render big and small, not as an array', () => {
    const k = card();
    k.pictures = [{ id: 'dg1', after: 'you', kind: 'steps', title: 'Words', items: [['share', 'letting others use it'], ['pull', 'move it towards you']] }];
    const h = html(k);
    expect(h).not.toContain("['");
    expect(h).toContain('<b>share</b>');
    expect(h).toContain('<small>letting others use it</small>');
  });
  test('the footer carries only the full-plan link', () => {
    const foot = html().split('<div class="foot">')[1];
    expect(foot).not.toContain('moves ·');
    expect(foot).toContain('Full lesson plan ›');
  });
  test('success with thumbs and If stuck are printed', () => {
    const h = html();
    expect(h).toContain('<b>Success:</b> “I can');
    expect(h).toContain('👍');
    expect(h).toContain('<b>If stuck:</b>');
  });
  test('the neighbour turn prints who first, reply and stop; the repair line when present', () => {
    const k = card();
    const tm = k.sections.flatMap((s) => s.moves).find((m) => m.chip === 'ONE NEIGHBOUR TURN');
    const h = html();
    expect(h).toContain(`<b>${tm.turn.first} first:</b>`);
    expect(h).toContain('<b>Reply:</b>');
    expect(h).toContain('<b>Stop:</b>');
    tm.turn.help = 'Point to the frame; say it with them.';
    expect(html(k)).toContain('<b>Stuck?</b> Point to the frame; say it with them.');
  });
  test('a number-sense move prints its chip', () => {
    const k = card();
    k.header.subject = 'Maths';
    k.sections[0].moves[0].sense = true;
    expect(html(k)).toContain('<span class="chip">NUMBER SENSE</span>');
  });
  test('a yesterday line that starts "Yesterday" does not print "Yesterday: Yesterday"', () => {
    const k = card();
    k.sections[0].moves[0].yesterday = 'Yesterday we sang.';
    expect(html(k)).toContain('<span class="ex"><b>Yesterday</b> we sang.</span>');
    k.sections[0].moves[0].yesterday = 'Last time we sang.';
    expect(html(k)).toContain('<span class="ex"><b>Yesterday:</b> Last time we sang.</span>');
  });
  test('the video row appears only when the card has one', () => {
    const k = card();
    expect(html(k)).not.toContain('<b>Video</b>');
    k.video = { href: 'https://x/v?a=1&amp;b=2', title: 'Vid' };
    expect(html(k)).toContain('<b>Video</b><span>📺 <a href="https://x/v?a=1&amp;amp;b=2">Vid</a></span>');
  });
  test('render does not mutate its input', () => {
    const k = card();
    const before = JSON.stringify(k);
    html(k);
    expect(JSON.stringify(k)).toBe(before);
    expect(clone(k)).toEqual(k);
  });
});
