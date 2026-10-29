/**
 * bd-5jmnfj.4.58.2: G5 Science Q1 (b) (v26). The paper printed an empty frame with five numbered
 * lines and nothing tied the numbers to symbols; the key lists "1. Wire, 2. Cell, 3. Switch
 * (closed), 4. Switch (open), 5. Lamp / bulb". The paper now prints the five symbols in numbered
 * boxes, plain black outline, no arrows, so the lines and the key line up.
 */
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const Pictures = require('../../bot/shared/services/assessment/fde-pictures');
const Circuit = require('../../bot/shared/services/assessment/fde-circuit-frame');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const NOW = '2026-10-29T07:00:00.000Z';
const P = Patterns.get('fde_g5_2027').subjects.science;
const ITEM = {
  slot: 'science.A.Q1b', lines: 0, marks: 5, answer: '1. Wire, 2. Cell, 3. Switch (closed), 4. Switch (open), 5. Lamp / bulb', blooms: 'Remember',
  scheme: { accept: ['Battery for cell'], points: [1, 2, 3, 4, 5].map((n) => ({ kind: 'A', text: `Symbol ${n} labelled correctly`, marks: 1 })), checked: null, common_error: 'Swapping the open and closed switch.' },
  question: 'Symbols used in a circuit diagram', book_page: 142,
  main_question: 'Label the diagram. Write the names of the five parts on the label lines in the frame.',
};
const laid = (item = ITEM) => applyLayout({ unseen: { subjective: { 'Label the Diagram': [{ ...item }] } } }, P, { kind: 'fde' }, { now: NOW }).examJson;
const render = (exam) => R.renderPaper({ examJson: normaliseScheme(exam).examJson, grade: 5, subject: 'science', answerLines: true, allowShort: true });
const frameHtml = (html) => {
  const at = html.indexOf('id="fde-frame-science.A.Q1b"');
  return html.slice(at, html.indexOf('</div></div>', html.indexOf('label-lines', at)) + 12);
};
const svgOf = (frame) => {
  const m = /<img src="data:image\/svg\+xml;base64,([^"]+)"/.exec(frame);
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : '';
};

describe('G5 Science Q1 (b) prints the five circuit symbols (bd-5jmnfj.4.58.2)', () => {
  it('the frame holds an SVG picture, not an empty box', async () => {
    const exam = await Pictures.resolveFramePictures(laid());
    expect(svgOf(frameHtml(render(exam)))).toContain('<svg');
  });

  it('the picture has five numbered boxes, 1 to 5', async () => {
    const svg = svgOf(frameHtml(render(await Pictures.resolveFramePictures(laid()))));
    expect((svg.match(/<rect /g) || [])).toHaveLength(5);
    for (const n of [1, 2, 3, 4, 5]) expect(svg).toContain(`>${n}</text>`);
  });

  it('is plain black outline with no arrows or markers', async () => {
    const svg = svgOf(frameHtml(render(await Pictures.resolveFramePictures(laid()))));
    expect(svg).toContain('<svg');
    expect(svg).not.toMatch(/marker|<polygon|<path|arrow/i);
    expect(svg).not.toMatch(/fill="(?!none|#fff|white|#000)/);
  });

  it('drops the "paste the book figure" teacher note and the supplies line', async () => {
    const exam = await Pictures.resolveFramePictures(laid());
    const html = render(exam);
    expect(html).not.toMatch(/paste the book/i);
    expect(html).not.toMatch(/book p\. ?142/i);
  });

  it('leaves other label frames alone (a food chain keeps its empty frame)', async () => {
    const exam = await Pictures.resolveFramePictures(laid({ ...ITEM, answer: '1) Sun, 2) Grass, 3) Grasshopper, 4) Mouse, 5) Snake', question: 'A simple food chain' }));
    expect(svgOf(frameHtml(render(exam)))).toBe('');
  });

  it('draws the symbols in the key\'s order, whatever it is', () => {
    expect(Circuit.circuitKinds('1) Lamp, 2) Open switch, 3) Battery, 4) Wire, 5) Closed switch'))
      .toEqual(['lamp', 'switch-open', 'cell', 'wire', 'switch-closed']);
  });

  it('refuses a key that is not exactly the five symbols', () => {
    expect(Circuit.circuitKinds('1. Wire, 2. Cell, 3. Lamp')).toBeNull();
    expect(Circuit.circuitKinds('1. Wire, 2. Wire, 3. Cell, 4. Lamp, 5. Switch (open)')).toBeNull();
    expect(Circuit.circuitPicture({ answer: undefined })).toBeNull();
  });
});
