import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

const calls: string[] = [];

function record(name: string): never {
  calls.push(name);
  throw new Error(`S-09 blocked ${name}`);
}

const connect = function (this: net.Socket): net.Socket {
  calls.push('net.Socket.connect');
  const error = new Error('S-09 blocked net.Socket.connect');
  process.nextTick(() => {
    this.emit('error', error);
  });
  return this;
};

net.Socket.prototype.connect = connect as typeof net.Socket.prototype.connect;
net.connect = (() => record('net.connect')) as typeof net.connect;
net.createConnection = (() => record('net.createConnection')) as typeof net.createConnection;
dns.lookup = (() => record('dns.lookup')) as unknown as typeof dns.lookup;
dns.promises.lookup = (() => record('dns.promises.lookup')) as typeof dns.promises.lookup;
http.request = (() => record('http.request')) as typeof http.request;
http.get = (() => record('http.get')) as typeof http.get;
https.request = (() => record('https.request')) as typeof https.request;
https.get = (() => record('https.get')) as typeof https.get;
tls.connect = (() => record('tls.connect')) as typeof tls.connect;
globalThis.fetch = (() => record('fetch')) as typeof fetch;

export function networkCalls(): readonly string[] {
  return calls;
}
