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
if (!result.ok) process.exit(1);
