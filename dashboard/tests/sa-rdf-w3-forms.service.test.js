'use strict';
/**
 * Switch sa_rdf_w3_forms (app_settings, OFF by default) on the battery route: OFF, a coach battery is served without the
 * RDF auto / RDF manual lists, their tasks and their two lines (the battery built without the W3 items); ON, with them.
 */
const express = require('express');
const { createSaEngineRouter } = require('../routes/sa-engine.routes');

async function serve(rdfW3Forms, name = 'sa.coach.G3.A.ur.json') {
  const app = express();
  app.use(createSaEngineRouter({ on: () => true, practiceAllMaths: () => false, passageRotation: () => false, voiceV2: () => false, rdfW3Forms: () => rdfW3Forms }));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try { return await (await fetch(`http://127.0.0.1:${srv.address().port}/sa/batteries/${name}`)).json(); } finally { srv.close(); }
}

describe('RDF auto / RDF manual on the battery route', () => {
  test('OFF: no W3 list, task or line', async () => {
    const b = await serve(false);
    expect(b.rdf_auto).toBeUndefined();
    expect(b.rdf_variants).toBeUndefined();
    expect(b.tasks.filter((t) => t.w3)).toEqual([]);
    expect(b.lines.coach_will_instruct).toBeUndefined();
    expect(b.tasks.some((t) => t.id === 'ur.story')).toBe(true);
  });

  test('ON: both lists, the 17 W3 tasks, the coach line', async () => {
    const b = await serve(true);
    expect(b.rdf_manual).toEqual(b.rdf_auto);
    expect(b.rdf_auto).toHaveLength(17);
    expect(b.tasks.filter((t) => t.w3).map((t) => t.id)).toEqual(b.rdf_auto);
    expect(b.rdf_variants.rdf_manual).toEqual({ name: { en: 'RDF manual', ur: 'آر ڈی ایف دستی' }, manual: true });
    expect(b.lines.coach_will_instruct).toEqual({ text: 'اب آپ کے کوچ ہدایات دیں گے۔', audio: 'sa/v1/ur/017ff4964563.mp3' });
  });
});
