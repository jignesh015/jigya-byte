import { spawn } from 'node:child_process';
import { readConfig } from '../backend/src/config.ts';

try {
  const config = readConfig();
  const host = config.host === '0.0.0.0' ? '127.0.0.1' : config.host === '::' ? '::1' : config.host;
  const urlHost = host.includes(':') ? `[${host}]` : host;
  const address = `http://${urlHost}:${config.port}`;
  let alreadyRunning = false;
  try {
    const response = await fetch(`${address}/health`, { signal: AbortSignal.timeout(1500) });
    const health = await response.json();
    alreadyRunning = response.ok && health.service === 'JigyaByte' && health.protocolVersion === 1 && health.ready === true;
  } catch { /* No healthy backend; the server will report bind/configuration errors. */ }

  if (alreadyRunning) {
    console.log(`JigyaByte backend is already running at ${address}.`);
    console.log('This window can be closed. The existing server will keep running.');
  } else {
    console.log('Starting JigyaByte backend...');
    console.log('Keep this window open while using the backend. Press Ctrl+C to stop cleanly.');
    console.log(`For a USB phone, reapply adb reverse tcp:${config.port} tcp:${config.port} after reconnecting.`);
    const child = spawn(process.execPath, ['src/server.ts'], { stdio: 'inherit' });
    // Both processes share the Windows console; Node receives Ctrl+C directly.
    const onInterrupt = () => {};
    process.on('SIGINT', onInterrupt);
    child.on('error', () => {
      console.error('Could not start the backend process.');
      process.exitCode = 1;
    });
    child.on('exit', (code, signal) => {
      process.removeListener('SIGINT', onInterrupt);
      process.exitCode = code ?? (signal === 'SIGINT' ? 0 : 1);
      console.log('Backend stopped.');
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Backend configuration failed.');
  process.exitCode = 1;
}
