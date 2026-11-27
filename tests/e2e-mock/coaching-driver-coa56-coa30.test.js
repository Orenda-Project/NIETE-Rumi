/**
 * Two coaching-driver faults of mock run 20261126-2322-par (sandbox dc2ab6f259), coaching shards 1 and 2.
 *
 * COA56  The walker kept the photo offer as its first 240 characters. When a previous commitment exists the offer
 *        opens with the reminder («💡 مختصر یاد دہانی …» plus her English commitment), and the neutral question
 *        «کیا 3 تک تصاویر بھی شامل کریں؟» sits past character 240, so the check never saw it (transcript row 91).
 * COA30  lp_fidelity came back status lp_absent: the local seed has no niete_lp_fidelity_moves rows (seed-release.txt
 *        still names seed-20261008-071211, published before that table joined seed-tables.txt). With no move list
 *        the no-timestamps guard never runs, so the scenario cannot be judged: BLOCKED with the reason, not FAIL.
 */
const { describeWithEngine } = require('./engine');

// The message the bot sent on run 3 (Urdu), verbatim.
const OFFER = '💡 *مختصر یاد دہانی:* پچھلی بار آپ نے یہ عہد کیا تھا:\n\n_"Prepare one easier counting version and one extension (an extra challenge for fast finishers) question; tell half the class to do the easier task and faster students to do the extension."_\n\nآئیے دیکھیں اس بار کیا ہوا!\n\n📸 کیا 3 تک تصاویر بھی شامل کریں؟ سب سے مفید: (1) بورڈ جس پر آج کا مقصد یا کام لکھا ہو، (2) کسی طالبِ علم کی کاپی یا ورک شیٹ، (3) جو چیز آپ نے سمجھانے کے لیے استعمال کی — ڈرائنگ، کوئی چیز، چارٹ یا کارڈز۔ بچوں کے ڈیسک پر بیٹھے ہونے کی تصویر تجزیے میں مدد نہیں کرتی۔\n\n«ہاں» دبائیں، پھر تصاویر بھیجیں، ایک ایک کر کے — پہلے بورڈ، اگر ہو۔ میں ان میں لکھی چیزیں پڑھ کر ریکارڈنگ کے ساتھ استعمال کروں گا۔';

describeWithEngine('coaching-ext — COA56 judges the whole photo offer', () => {
  const ext = require('../../.claude/qa/shared/coaching-ext.cjs');
  test('an offer led by the commitment reminder is still read as neutral', () => {
    const kept = ext.photoPromptRecord(OFFER, ['ہاں', 'نہیں']);
    expect(ext.photoOfferNeutral(kept.txt)).toBe(true);
  });
  test('a gendered offer is still caught', () => {
    const kept = ext.photoPromptRecord('📸 کیا آپ تصاویر بھی شامل کرنا چاہیں گے؟', ['ہاں', 'نہیں']);
    expect(ext.photoOfferNeutral(kept.txt)).toBe(false);
  });
});

describeWithEngine('coaching-ext — COA30 with no move list is BLOCKED, not FAIL', () => {
  const ext = require('../../.claude/qa/shared/coaching-ext.cjs');
  test('lp_absent names the missing move list', () => {
    expect(ext.lpMovesMissing({ status: 'lp_absent' })).toMatch(/niete_lp_fidelity_moves/);
  });
  test('a computed fidelity is judged', () => {
    expect(ext.lpMovesMissing({ status: 'ok', recording_unusable: true })).toBeNull();
  });
});
