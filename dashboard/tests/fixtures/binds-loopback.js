'use strict';
/**
 * Required first by a test file whose client calls its servers on 127.0.0.1 (bd-w2x3l4): reads the address of every
 * server the file starts, at 'listening', and fails the file when one bound anything else. A server on every
 * interface ('::') shares its port with whatever binds 127.0.0.1 beside it, and the request can land there instead.
 */
const net = require('net');

const seen = [];
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function bindsLoopback(...args) {
  this.once('listening', () => { const a = this.address(); seen.push(a && typeof a === 'object' ? a.address : String(a)); });
  return listen.apply(this, args);
};

afterAll(() => {
  net.Server.prototype.listen = listen;
  expect(seen.filter((host) => host !== '127.0.0.1')).toEqual([]);
});
