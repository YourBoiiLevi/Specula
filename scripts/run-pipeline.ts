import 'dotenv/config';
import { loadConfig } from '../config.js';
import { runPipelines } from '../src/runner/index.js';

function readPipelineIds(argv: string[]): string[] {
  const ids: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === '--all') {
      return [];
    }
    if (arg === '--pipeline') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value after --pipeline');
      }
      ids.push(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--pipeline=')) {
      ids.push(arg.slice('--pipeline='.length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return ids;
}

const config = loadConfig();
const pipelineIds = readPipelineIds(process.argv.slice(2));
const result = await runPipelines(config, undefined, pipelineIds);

console.log(JSON.stringify(result, null, 2));

if (result.errorCount > 0) {
  process.exitCode = 1;
}
