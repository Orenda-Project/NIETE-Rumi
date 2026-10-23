'use strict';
/**
 * fflp.engineReady(): the typed-topic seam's "is the engine on this deployment" check. A jest virtual
 * module stands in for the engine a later change ports; with no module on disk the answer is false.
 */
jest.mock('../../bot/shared/services/fflp/engine', () => ({ generateAndDeliver: jest.fn() }), { virtual: true });

test('a module at fflp/engine (here a jest virtual module) => ready', () => {
  const fflp = require('../../bot/shared/services/fflp');
  expect(fflp.engineReady()).toBe(true);
});

test('no module at fflp/engine => not ready, and nothing throws', () => {
  jest.resetModules();
  jest.unmock('../../bot/shared/services/fflp/engine');
  const fflp = require('../../bot/shared/services/fflp');
  expect(() => fflp.engineReady()).not.toThrow();
  expect(fflp.engineReady()).toBe(false);
});
