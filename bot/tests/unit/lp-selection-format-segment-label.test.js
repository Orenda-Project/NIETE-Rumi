/** bd-nfjhgl — 995 = assessment/worksheet, 990 = revision (curriculum convention; see build-lp-catalog.js). */
const { formatLpRow } = require('../../shared/services/coaching/lp-coaching/lp-selection-format');

const row = (lesson_id) => formatLpRow({ id: 1, lesson_id, grade: 4, subject: 'Maths' });

describe('lp-selection-format segment labels', () => {
  it('seg995 is Assessment', () => {
    expect(JSON.stringify(row('g4_m_ch3_seg995'))).toContain('Assessment');
    expect(JSON.stringify(row('g4_m_ch3_seg995'))).not.toContain('Revision');
  });
  it('seg990 is Revision', () => {
    expect(JSON.stringify(row('g4_m_ch3_seg990'))).toContain('Revision');
    expect(JSON.stringify(row('g4_m_ch3_seg990'))).not.toContain('Assessment');
  });
});
