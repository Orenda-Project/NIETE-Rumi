/**
 * What a Grade 1-2 picture prints as on the paper (bd-5jmnfj.4.3): the image the
 * pipeline embedded, a count repeated n times, a scene drawn larger. An item whose
 * picture has no image fails the render: the paper never prints an empty box.
 */

const { pictureBlock, PICTURE_CSS } = require('../../bot/shared/services/assessment/fde-picture-block');

const SRC = 'data:image/jpeg;base64,AAAA';

test('an item with no picture prints nothing', () => {
  expect(pictureBlock({ question: 'q' })).toBe('');
});

test('an object prints its embedded image once', () => {
  const html = pictureBlock({ picture: { kind: 'object', name: 'apple', src: SRC } });
  expect(html.match(/<img /g)).toHaveLength(1);
  expect(html).toContain(`src="${SRC}"`);
  expect(html).toContain('class="pic pic-object"');
  expect(html).toContain('alt="apple"');
});

test('a count repeats its object n times', () => {
  const html = pictureBlock({ picture: { kind: 'count', name: 'cat', n: 4, src: SRC } });
  expect(html.match(/<img /g)).toHaveLength(4);
  expect(html).toContain('pic-count');
});

test('a scene prints larger than an object', () => {
  expect(pictureBlock({ picture: { kind: 'scene', describe: 'a boy and a kite', src: SRC } })).toContain('pic-scene');
});

test('drawn kinds print their svg image', () => {
  const svg = 'data:image/svg+xml;base64,PHN2Zz4=';
  expect(pictureBlock({ picture: { kind: 'clock', hour: 3, minute: 0, src: svg } })).toContain(`src="${svg}"`);
});

test('a picture with no image, or a count with no n, refuses to print', () => {
  expect(() => pictureBlock({ slot: 's1', picture: { kind: 'object', name: 'apple' } })).toThrow(/no image/);
  expect(() => pictureBlock({ picture: { kind: 'count', name: 'cat', src: SRC } })).toThrow(/count/);
});

test('the alt text cannot break out of the attribute', () => {
  expect(pictureBlock({ picture: { kind: 'object', name: 'a "big" <cat>', src: SRC } })).not.toContain('<cat>');
});

test('the css styles every class the block prints', () => {
  ['.pic', '.pic-count', '.pic-scene'].forEach((c) => expect(PICTURE_CSS).toContain(c));
});
