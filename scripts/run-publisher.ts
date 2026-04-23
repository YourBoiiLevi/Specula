import 'dotenv/config';
import { loadConfig } from '../config.js';
import { publish } from '../src/publisher/index.js';

const result = await publish(loadConfig());
console.log(
  JSON.stringify(
    {
      ok: result.ok,
      hadChanges: result.hadChanges,
      commitSha: result.commitSha,
      error: result.error,
    },
    null,
    2,
  ),
);
if (!result.ok) {
  // Use exitCode (not exit()) so the event loop drains stdout first, otherwise
  // the JSON result above can be truncated on abrupt termination.
  process.exitCode = 1;
}
