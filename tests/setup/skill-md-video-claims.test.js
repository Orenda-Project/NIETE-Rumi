/**
 * §D-4 guard — the setup SKILL.md must not claim R2_* keys are required for
 * the video feature. The real video service (bot/shared/services/video/) reads
 * KIE_API_KEY and is gated by VIDEO_GENERATION_ENABLED=true. R2_* is not
 * consulted anywhere in the video chain.
 *
 * This test is the structural lock — if a future doc-pass re-adds R2_* to the
 * Video row, CI catches it.
 */

const fs = require('fs');
const path = require('path');

const SKILL_MD = path.resolve(__dirname, '../../.claude/skills/setup/SKILL.md');
const README = path.resolve(__dirname, '../../README.md');

describe('SKILL.md video-key claims match reality', () => {
  it('does NOT mention R2_* in the Educational video row', () => {
    const content = fs.readFileSync(SKILL_MD, 'utf8');
    // Find the Educational-video row in the feature table.
    const m = content.match(/\| Educational video \| ([^|]+) \|/);
    expect(m).toBeTruthy();
    const cell = m[1];
    expect(cell).not.toMatch(/R2_/);
    expect(cell).toMatch(/KIE_API_KEY/);
    expect(cell).toMatch(/VIDEO_GENERATION_ENABLED/);
  });

  it('README and SKILL.md both name VIDEO_GENERATION_ENABLED for video', () => {
    const skill = fs.readFileSync(SKILL_MD, 'utf8');
    const readme = fs.readFileSync(README, 'utf8');
    expect(skill).toMatch(/VIDEO_GENERATION_ENABLED/);
    expect(readme).toMatch(/VIDEO_GENERATION_ENABLED/);
  });
});
