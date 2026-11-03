/**
 * bd-5jmnfj.4.58.2 item 1: G1 Urdu Q4 item ii. v26 g1-urdu-exam.json g1.urdu.B.Q4 carries
 * picture {kind:"object", name:"clock"} (answer گھڑی): an object picture goes to the image model, whose clock
 * came back with arrowheads on its hands (v22's "plain lines" prompt line did not hold). A clock the paper
 * names is drawn as SVG: hands are plain round-capped lines, no arrowheads.
 */
const Pictures = require('../../bot/shared/services/assessment/fde-pictures');
const Svg = require('../../bot/shared/services/assessment/fde-picture-svg');

const item = (name, kind = 'object') => ({ slot: 'g1.urdu.B.Q4', answer: 'گھڑی', picture: { kind, name } });
const paper = (q) => ({ unseen: { subjective: { 'Name the Picture': [q] } } });
const decode = (uri) => Buffer.from(uri.split(',')[1], 'base64').toString('utf8');

describe('an object picture of a clock is drawn as SVG', () => {
  test.each(['clock', 'wall clock', 'alarm clock', 'a clock'])('svgFor object "%s" is a clock face', (name) => {
    const svg = Svg.svgFor({ kind: 'object', name });
    expect(svg).toContain('data-hand="hour"');
    expect(svg).toContain('data-hand="minute"');
  });

  test('its hands are plain lines: no marker, arrowhead, polygon or path', () => {
    const svg = Svg.svgFor({ kind: 'object', name: 'clock' });
    expect(svg).not.toMatch(/<marker|marker-end|marker-start|<polygon|<polyline|<path/i);
    expect(svg.match(/<line [^>]*data-hand/g)).toHaveLength(2);
    expect(svg).toMatch(/stroke-linecap="round"/);
  });

  test('other objects are still the image model\'s', () => {
    ['mango', 'parrot', 'cloth'].forEach((name) => expect(Svg.svgFor({ kind: 'object', name })).toBeNull());
  });

  test('resolvePictures embeds the SVG and never calls the image model', async () => {
    const generateImage = jest.fn(async () => { throw new Error('image model must not be called'); });
    const d = { headObject: jest.fn(), downloadFromR2: jest.fn(), uploadBuffer: jest.fn(), generateImage, shrink: async (b) => b, gray: async () => ({ data: [], width: 0, height: 0 }) };
    const q = item('clock');
    await Pictures.resolvePictures(paper(q), d);
    expect(generateImage).not.toHaveBeenCalled();
    expect(q.picture.src).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(decode(q.picture.src)).toContain('data-hand="minute"');
  });
});
