/**
 * An attendance tap must be consumed in BOTH interactive branches.
 *
 * The class picker sends buttons at ≤3 classes and a LIST at 4+. A button tap
 * arrives as `interactive.button_reply`, a list tap as `interactive.list_reply` —
 * two different branches in whatsapp-bot.js. Registering the id in only one of
 * them is exactly the bug the earlier port shipped: the ids were emitted, the
 * Flow opened, and tapping a class did nothing at all.
 *
 * Static assertion against the router source, because booting the webhook here
 * would start workers and Redis.
 */

const fs = require('fs');
const path = require('path');

const BOT = fs.readFileSync(
  path.join(__dirname, '../../bot/whatsapp-bot.js'),
  'utf8',
);

describe('attendance taps are routed in both interactive branches', () => {
  const buttonBranch = BOT.split("interactive?.type === 'button_reply'")[1].split("interactive?.type === 'list_reply'")[0];
  const listBranch = BOT.split("interactive?.type === 'list_reply'")[1];

  it('the button_reply branch handles att_class_ and att_subject_', () => {
    expect(buttonBranch).toContain("att_class_");
    expect(buttonBranch).toContain("att_subject_");
    expect(buttonBranch).toContain('handleAttendanceTap');
  });

  it('the list_reply branch handles them too — a 4+ class picker is a list', () => {
    expect(listBranch).toContain("att_class_");
    expect(listBranch).toContain('handleAttendanceTap');
  });

  it('both branches call the SAME handler, so they cannot drift apart', () => {
    const calls = [...BOT.matchAll(/handleAttendanceTap\(/g)];
    // one definition + one call per branch
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('the handler refuses to open a Flow when the id is unset', () => {
    const fn = BOT.split('async function handleAttendanceTap(')[1].slice(0, 2600);
    expect(fn).toContain('ATTENDANCE_MARKING_FLOW_ID');
    expect(fn).toMatch(/not available/i);
  });
});
