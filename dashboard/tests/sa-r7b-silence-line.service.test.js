'use strict';
/**
 * Round 7b (sa_silence_repeat): while ON, the served battery carries Jugnu's reminder as lines.silence_repeat in its own
 * language, with a clip that exists in both voice sets (the route moves sa/v1/ to sa/v2/ with sa_voice_v2). OFF: no line.
 */
const fs = require('fs');
const path = require('path');
const { applySwitches } = require('../routes/sa-battery-switches');

const SA = path.join(__dirname, '..', 'sa');
for (const lang of ['en', 'ur']) {
  test(`${lang}: ON adds lines.silence_repeat with a clip in v1 and v2; OFF does not`, () => {
    const b = { battery_id: 'b', lang, lines: { welcome: { text: 'x' } }, tasks: [{ id: 'ur.a', items: [] }] };
    const on = applySwitches(b, { silenceRepeat: true });
    const l = on.lines.silence_repeat;
    expect(l.text).toMatch(lang === 'ur' ? /اونچی آواز میں بولیں/ : /out loud/);
    expect(l.audio).toMatch(new RegExp(`^sa/v1/${lang}/[0-9a-f]{12}\\.mp3$`));
    for (const set of ['v1', 'v2']) expect(fs.statSync(path.join(SA, l.audio.replace(/^sa\/v1\//, `${set}/`))).size).toBeGreaterThan(5000);
    expect(on.lines.welcome).toEqual({ text: 'x' });
    expect(b.lines.silence_repeat).toBeUndefined();
    expect(applySwitches(b, {}).lines.silence_repeat).toBeUndefined();
  });
}
