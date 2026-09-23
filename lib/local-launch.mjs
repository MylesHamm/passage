import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const validPort = port => Number.isInteger(port) && port >= 1 && port <= 65535;

// Probe only a local listener, without redirects or an unbounded response body.
async function matchesServer(port, identity) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      redirect: 'error', signal: AbortSignal.timeout(1000),
    });
    if (!response.ok || !response.body) { await response.body?.cancel(); return false; }
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return false; }
      chunks.push(value);
    }
    const health = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return health.application === 'passage-maritime-watch' && health.status === 'ready'
      && health.instanceId === identity.instanceId && health.version === identity.version;
  } catch { return false; }
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { server.off('error', failed); server.off('listening', ready); };
    const failed = error => { cleanup(); reject(error); };
    const ready = () => { cleanup(); resolve(); };
    server.once('error', failed); server.once('listening', ready);
    try { server.listen(port, '127.0.0.1'); } catch (error) { failed(error); }
  });
}

async function remember(portFile, preferredPort, port) {
  const temporary = `${portFile}.${randomUUID()}.tmp`;
  try {
    await mkdir(path.dirname(portFile), {recursive: true});
    await writeFile(temporary, JSON.stringify({preferredPort, port}) + '\n', {mode: 0o600});
    await rename(temporary, portFile);
    return null;
  } catch {
    return 'Passage opened, but its address could not be remembered. Check folder write access.';
  } finally { await rm(temporary, {force: true}).catch(() => {}); }
}

// Binding reserves the port atomically. A second double-click either reuses the
// winning instance or moves past an unrelated listener; it never stops one.
export async function startLocalServer({server, preferredPort, portFile, identity, maxAttempts = 20, onPort = () => {}}) {
  if (!validPort(preferredPort)) throw new Error('Passage PORT must be a whole number from 1 to 65535.');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) throw new Error('Invalid launch attempt limit.');
  let remembered;
  try {
    const saved = JSON.parse(await readFile(portFile, 'utf8'));
    if (saved.preferredPort === preferredPort && validPort(saved.port)
      && saved.port >= preferredPort && saved.port < preferredPort + maxAttempts) remembered = saved.port;
  } catch { /* Missing or invalid local hints do not prevent startup. */ }
  const candidates = [...new Set([remembered, ...Array.from({length: maxAttempts}, (_, i) => preferredPort + i)].filter(validPort))];
  for (const port of candidates) {
    onPort(port);
    let reused = false;
    try { await listen(server, port); }
    catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      if (!await matchesServer(port, identity)) continue;
      reused = true;
    }
    return {port, url: `http://127.0.0.1:${port}`, reused, settingsWarning: await remember(portFile, preferredPort, port)};
  }
  throw new Error('Passage could not find an available local address. Close an unused local server and try again.');
}
