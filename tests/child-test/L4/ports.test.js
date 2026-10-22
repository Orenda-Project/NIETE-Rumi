/**
 * ports.cueFor reads the spoken start cue from L1's real item bank (CONTRACT §2 `cue`), so the
 * coach script says exactly what the window finder (L5) listens for.
 */
const ports = require('../../../bot/shared/services/child-test/conversation/ports');
const bank = require('../../../bot/shared/services/child-test/item-bank');

test.each(['urdu', 'english', 'maths'])('%s cue comes from the item bank', (block) => {
  ports.__setForTest(null);
  expect(bank.cue[block].start).toBeTruthy();
  expect(ports.cueFor(block)).toBe(bank.cue[block].start);
});
