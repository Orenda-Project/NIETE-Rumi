// bd-k3ry8. The mistakes box printed "What pupils write" on every lesson plan, including oral
// lessons where no child writes (GK G1 day 1). Amena (5 Oct 2026): one label true for both.
const { LABELS } = require('../../vendor/lp-v9/lib/overlay.js');

describe('lp-v9 mistakes-box label', () => {
  it('covers spoken and written answers, EN and UR', () => {
    expect(LABELS.en.pupilSays).toBe('What pupils say or write');
    expect(LABELS.ur.pupilSays).toBe('طلبہ کیا کہتے یا لکھتے ہیں');
  });
});
