import { boot } from '../src/index.js';

const result = await boot();

let shuttingDown = false;
const handle = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[specula] received ${signal} — shutting down`);
  result
    .shutdown()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[specula] shutdown error:', err);
      process.exit(1);
    });
};
process.on('SIGINT', () => handle('SIGINT'));
process.on('SIGTERM', () => handle('SIGTERM'));
