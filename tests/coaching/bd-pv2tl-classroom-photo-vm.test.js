/**
 * bd-pv2tl — the report photo strip builder: cap at 2, base64 data URIs, and
 * never let a broken photo sink the report.
 */
const { buildClassroomPhotoVm } = require('../../bot/shared/services/coaching/report-v2/classroom-photo-vm');

const dl = (bytes = 'img') => () => Promise.resolve(Buffer.from(bytes));

describe('bd-pv2tl — buildClassroomPhotoVm', () => {
  test('caps at 2 photos and returns base64 data URIs', async () => {
    const out = await buildClassroomPhotoVm(
      [{ url: 'r2://a.jpg' }, { url: 'r2://b.jpg' }, { url: 'r2://c.jpg' }],
      { downloadFn: dl() },
    );
    expect(out).toHaveLength(2);
    expect(out[0].src.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  test('skips a photo whose download fails, keeps the good one', async () => {
    const downloadFn = jest.fn((key) => key.includes('bad') ? Promise.reject(new Error('404')) : Promise.resolve(Buffer.from('ok')));
    const out = await buildClassroomPhotoVm([{ url: 'r2://bad.jpg' }, { url: 'r2://good.jpg' }], { downloadFn });
    expect(out).toHaveLength(1);
    expect(out[0].src).toContain('base64,');
  });

  test('applies downscale when provided; falls back to original if it throws', async () => {
    const downscale = jest.fn(() => Promise.resolve(Buffer.from('small')));
    const out = await buildClassroomPhotoVm([{ url: 'r2://a.jpg' }], { downloadFn: dl('BIGIMAGE'), downscale });
    expect(downscale).toHaveBeenCalled();
    expect(Buffer.from(out[0].src.split('base64,')[1], 'base64').toString()).toBe('small');

    const boom = jest.fn(() => Promise.reject(new Error('sharp boom')));
    const out2 = await buildClassroomPhotoVm([{ url: 'r2://a.jpg' }], { downloadFn: dl('ORIGINAL'), downscale: boom });
    expect(Buffer.from(out2[0].src.split('base64,')[1], 'base64').toString()).toBe('ORIGINAL');
  });

  test('empty / missing inputs → [] (no throw)', async () => {
    expect(await buildClassroomPhotoVm([], { downloadFn: dl() })).toEqual([]);
    expect(await buildClassroomPhotoVm(null, { downloadFn: dl() })).toEqual([]);
    expect(await buildClassroomPhotoVm([{ url: 'x' }], {})).toEqual([]); // no downloadFn
  });

  test('carries an optional caption through', async () => {
    const out = await buildClassroomPhotoVm([{ url: 'r2://a.jpg', caption: 'board work' }], { downloadFn: dl() });
    expect(out[0].caption).toBe('board work');
  });
});
