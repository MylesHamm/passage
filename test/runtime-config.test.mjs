import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, normalizeApiBase, LIVE_REFRESH_MS } from '../dist/runtime-config.mjs';

const hosted = extra => createRuntime({ pageUrl: 'https://example.github.io/passage/investigate.html', moduleUrl: 'https://example.github.io/passage/runtime-config.mjs', ...extra });
test('local default API stays same-origin and site links stay under their module directory', async () => {
  const calls = [], runtime = createRuntime({ pageUrl: 'http://127.0.0.1:4195/research.html', moduleUrl: 'http://127.0.0.1:4195/runtime-config.mjs', fetchImpl: (...args) => { calls.push(args); return 'response'; } });
  assert.equal(runtime.apiUrl('/api/news'), 'http://127.0.0.1:4195/api/news');
  assert.equal(runtime.siteUrl('/investigate.html?actor=iran'), 'http://127.0.0.1:4195/investigate.html?actor=iran');
  assert.equal(runtime.privateConnectionsAllowed, true);
  assert.equal(runtime.configurationNotice, '');
  assert.equal(await runtime.apiFetch('/api/news'), 'response');
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.equal(LIVE_REFRESH_MS, 60000);
});
test('hosted API supports an HTTPS origin or prefix while page links retain the project path', () => {
  const runtime = hosted({ apiBase: 'https://live.example.com/public/' });
  assert.equal(runtime.apiUrl('/api/weather'), 'https://live.example.com/public/api/weather');
  assert.equal(runtime.apiUrl('/api/acled/events?days=365'), 'https://live.example.com/public/api/acled/events?days=365');
  assert.equal(runtime.siteUrl('/'), 'https://example.github.io/passage/');
  assert.equal(runtime.siteUrl('/investigate.html?source=https%3A%2F%2Fexample.org'), 'https://example.github.io/passage/investigate.html?source=https%3A%2F%2Fexample.org');
  assert.equal(runtime.privateConnectionsAllowed, false);
});
test('missing or malformed public API fails before a network call, including local hosted previews', async () => {
  let requests = 0;
  for (const options of [{}, { apiBase: 'http://live.example.com' }, { pageUrl: 'http://localhost/passage/', hosted: true }]) {
    const runtime = hosted({ ...options, fetchImpl: () => requests++ });
    assert.ok(runtime.configurationError);
    await assert.rejects(runtime.apiFetch('/api/news'), /configured|HTTPS/);
    assert.match(runtime.configurationNotice, /No request.*was sent/);
    assert.match(runtime.configurationNotice, /availability has not been checked/);
    assert.doesNotMatch(runtime.configurationNotice, /update failed|provider failed/i);
  }
  assert.equal(requests, 0);
});
test('public configuration cannot embed credentials or URL parameters', () => {
  for (const value of ['http://live.example.com', 'https://me:secret@live.example.com', 'https://live.example.com?key=secret', 'https://live.example.com/#secret', 'https://localhost/', 'https://127.0.0.1/', '//live.example.com', 'javascript:alert(1)', {}]) assert.throws(() => normalizeApiBase(value));
  assert.equal(normalizeApiBase(' https://live.example.com/passage/// '), 'https://live.example.com/passage/');
});
test('public API hosts reject private DNS names, trailing-dot loopback and all IP literals', () => {
  for (const host of ['localhost.', '127.0.0.1', '[::1]', '[::ffff:127.0.0.1]', '192.168.1.1', '10.0.0.1', '172.16.1.1', '169.254.169.254', '8.8.8.8', '2130706433', '0x7f000001', 'backend', 'backend.local', 'api.localhost.', 'api.internal', 'api.lan', 'api.home.arpa', 'api.test']) assert.throws(() => normalizeApiBase(`https://${host}/`), host);
  assert.equal(normalizeApiBase('https://passage.example.workers.dev/'), 'https://passage.example.workers.dev/');
  assert.equal(normalizeApiBase('https://api.example.com./'), 'https://api.example.com/');
});
test('site and API paths cannot escape their configured boundaries', () => {
  const runtime = hosted({ apiBase: 'https://live.example.com/' });
  for (const path of ['https://other.example/api/news', '//other.example/api/news', '/api/../account', '/api/news#x', '/api//news', '/api/acled/connect', '/api/secret']) assert.throws(() => runtime.apiUrl(path));
  for (const path of ['../secret', '/%2e%2e/secret', 'https://other.example/', '//other.example/']) assert.throws(() => runtime.siteUrl(path));
});
test('public requests omit credentials and reject private headers, bodies and mutation methods', async () => {
  const calls = [], runtime = hosted({ apiBase: 'https://live.example.com/', fetchImpl: (...args) => { calls.push(args); return 'ok'; } });
  await runtime.apiFetch('/api/news', { credentials: 'include', redirect: 'follow', headers: { Accept: 'application/json' } });
  assert.equal(calls[0][1].credentials, 'omit');
  assert.equal(calls[0][1].redirect, 'error');
  for (const options of [{ method: 'POST' }, { body: 'private' }, { headers: { Authorization: 'secret' } }, { headers: { 'X-API-Key': 'secret' } }]) await assert.rejects(runtime.apiFetch('/api/news', options));
  assert.equal(calls.length, 1);
});
test('public market expectations reach the hosted service without credentials', async () => {
  const calls = [], runtime = hosted({ apiBase: 'https://live.example.com/', fetchImpl: (...args) => { calls.push(args); return 'markets'; } });
  assert.equal(await runtime.apiFetch('/api/expectations'), 'markets');
  assert.equal(calls[0][0], 'https://live.example.com/api/expectations');
  assert.equal(calls[0][1].credentials, 'omit');
  await assert.rejects(runtime.apiFetch('/api/expectations', { method: 'POST' }), /read-only/);
  assert.equal(calls.length, 1);
});
