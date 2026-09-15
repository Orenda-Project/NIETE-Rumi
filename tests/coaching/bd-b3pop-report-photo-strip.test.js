'use strict';
/**
 * bd-b3pop.17 — a photo the vision pass excluded (a screenshot, writing addressed to a grader) is not framed in the
 * teacher's report; with nothing excluded the strip is exactly today's.
 */
const { buildClassroomPhotoVm, excludedPhotoNumbers } = require('../../bot/shared/services/coaching/report-v2/classroom-photo-vm');

const dl = () => Promise.resolve(Buffer.from('img'));

test('an excluded photo is not framed; the next photo takes its place and keeps its own index', async () => {
  const out = await buildClassroomPhotoVm([{ url: 'r2://board.jpg' }, { url: 'r2://shot.png' }, { url: 'r2://class.jpg' }], { downloadFn: dl, skipPhotoNumbers: [2] });
  expect(out.map((p) => p.index)).toEqual([0, 2]);
});

test("with nothing to skip the strip is today's: the first two photos", async () => {
  const out = await buildClassroomPhotoVm([{ url: 'a' }, { url: 'b' }, { url: 'c' }], { downloadFn: dl });
  expect(out.map((p) => p.index)).toEqual([0, 1]);
});

test('the excluded photo numbers come from the photo readings stored on the analysis', () => {
  expect(excludedPhotoNumbers({ photo_reads: [{ n: 1, status: 'read' }, { n: 2, status: 'excluded', kind: 'not_a_classroom_photo' }, { n: 3, status: 'failed' }] })).toEqual([2]);
  expect(excludedPhotoNumbers({})).toEqual([]);
  expect(excludedPhotoNumbers(null)).toEqual([]);
});
