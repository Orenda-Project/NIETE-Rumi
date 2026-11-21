/**
 * A reading item is shown, never spoken (wq.js WQI.readParts, `read.self`): the evening round's items where the child
 * reads the word or passage themselves carry `read: { self: true }`, and the voice says nothing for them (not the stem,
 * not its clip, not the options, not the picture pointer). Any other item is read as today.
 */
const WQI = require('../../public/wq/wq.js');

const item = (read) => ({ text: 'Read this word aloud: cat', figure: { say: 'Look at the picture' }, audio: { q: 'https://r2.example/q.ogg', opts: ['https://r2.example/a.ogg'] }, options: [{ slot: 'A', text: 'cat' }, { slot: 'B', text: 'cot' }], ...(read ? { read } : {}) });

test('read.self: nothing is spoken for the item', () => {
  expect(WQI.readParts(item({ self: true }), 'en')).toEqual([]);
  expect(WQI.readParts(item({ self: true }), 'ur')).toEqual([]);
});

test('no read.self (or anything but true): the item is read as today', () => {
  expect(WQI.readParts(item(), 'en').map((p) => p.p)).toEqual(['fig', 'q', 'opt', 'opt']);
  expect(WQI.readParts(item({ self: 'yes' }), 'en').map((p) => p.p)).toEqual(['fig', 'q', 'opt', 'opt']);
  expect(WQI.readParts(item({ stem: 'Find the cat' }), 'en')[1].text).toBe('Find the cat');
});
