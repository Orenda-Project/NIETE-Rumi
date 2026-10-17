'use strict';
/**
 * The two mount lists — the dashboard's edge routers (dashboard/routes/edge-mounts.js) and the bot's optional
 * first-touch mounts (bot/shared/services/first-touch/mounts.js): one line per feature, in name order, unique names,
 * every module there, every path its own (so the order in the list never decides who answers), and each list mounted
 * once by its entry file. A new feature adds one line to a list, never an app.use at a shared anchor.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DASH_ROUTES = path.join(ROOT, 'dashboard', 'routes');
const FT = path.join(ROOT, 'bot', 'shared', 'services', 'first-touch');

const sorted = (names) => names.every((n, i) => i === 0 || names[i - 1] < n);
/** Two path prefixes overlap when one, segment by segment, starts the other. */
const overlaps = (a, b) => {
  const [x, y] = [a.split('/'), b.split('/')].sort((p, q) => p.length - q.length);
  return x.every((s, i) => s === y[i]);
};
/** The list, or [] with the load error kept for the first test to report. */
const loadList = (file) => { try { return { list: require(file) }; } catch (err) { return { list: [], err }; } };
const disjoint = (prefixes) => prefixes.every((p, i) => prefixes.every((q, j) => i === j || !overlaps(p.prefix, q.prefix) || p.name === q.name));

describe('dashboard edge mounts', () => {
  const { list, err } = loadList(path.join(DASH_ROUTES, 'edge-mounts'));
  const names = list.map(([n]) => n);

  test('a frozen list of frozen [name, module, factory] lines', () => {
    expect(err && err.message).toBeUndefined();
    expect(Object.isFrozen(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    list.forEach((e) => { expect(Object.isFrozen(e)).toBe(true); expect(e).toHaveLength(3); });
  });
  test('in name order, every name once', () => {
    expect(sorted(names)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });
  test('every module resolves and exports its factory', () => {
    for (const [, file, make] of list) {
      expect(() => require.resolve(path.join(DASH_ROUTES, file))).not.toThrow();
      expect(typeof require(path.join(DASH_ROUTES, file))[make]).toBe('function');
    }
  });
  test('each router holds routes only (no middleware for every path), and no two share a path prefix', () => {
    const prefixes = [];
    for (const [name, file, make] of list) {
      const router = require(path.join(DASH_ROUTES, file))[make]({ botUrl: '', apiKey: '' });
      for (const l of router.stack) {
        expect(l.route).toBeTruthy();
        prefixes.push({ name, prefix: l.route.path.split('/').slice(0, 3).join('/') });
      }
    }
    expect(disjoint(prefixes)).toBe(true);
  });
  test('dashboard/index.js mounts the list once', () => {
    const src = fs.readFileSync(path.join(ROOT, 'dashboard', 'index.js'), 'utf8');
    expect(src.split("require('./routes/edge-mounts')").length).toBe(2);
    for (const [, file] of list) expect(src).not.toContain(`./routes/${file}'`);
  });
});

describe('bot first-touch mounts', () => {
  const { list, err } = loadList(path.join(FT, 'mounts'));
  const names = list.map(([n]) => n);

  test('a frozen list of frozen [name, module, mount function] lines', () => {
    expect(err && err.message).toBeUndefined();
    expect(Object.isFrozen(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    list.forEach((e) => { expect(Object.isFrozen(e)).toBe(true); expect(e).toHaveLength(3); });
  });
  test('in name order, every name once', () => {
    expect(sorted(names)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });
  test('every module resolves, exports its mount function and a mount path no other line shares', () => {
    const prefixes = [];
    for (const [name, file, mount] of list) {
      expect(() => require.resolve(path.join(FT, file))).not.toThrow();
      const mod = require(path.join(FT, file));
      expect(typeof mod[mount]).toBe('function');
      expect(mod.MOUNT_PATH).toMatch(/^\/api\/internal\/[a-z]+$/);
      prefixes.push({ name, prefix: mod.MOUNT_PATH });
    }
    expect(disjoint(prefixes)).toBe(true);
  });
  test('bot/whatsapp-bot.js mounts the list once, each line in its own try', () => {
    const src = fs.readFileSync(path.join(ROOT, 'bot', 'whatsapp-bot.js'), 'utf8');
    expect(src.split("require('./shared/services/first-touch/mounts')").length).toBe(2);
    expect(src).toMatch(/for \(const \[, file, mount\] of require\('\.\/shared\/services\/first-touch\/mounts'\)\) \{\n\s*try \{/);
    for (const [, file] of list) expect(src).not.toContain(`first-touch/${file}'`);
  });
});
