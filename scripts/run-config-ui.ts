import 'dotenv/config';
import { promises as fs } from 'node:fs';
import { loadConfig, validateConfig, CONFIG_PATH } from '../config.js';
import { createConfigUiServer } from '../src/config-ui/server.js';
import { listStatus } from '../src/status/index.js';

const cfg = loadConfig();

async function saveConfig(c: import('../src/types.js').SpeculaConfig): Promise<void> {
  validateConfig(c);
  const tmp = CONFIG_PATH + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(c, null, 2), 'utf8');
  await fs.rename(tmp, CONFIG_PATH);
}

const server = createConfigUiServer({
  configPath: CONFIG_PATH,
  loadConfig,
  saveConfig,
  // Re-read the config every tick so pipelines added/removed via the editor
  // are reflected in the status panel without a server restart.
  listStatus: () => {
    try {
      return listStatus(loadConfig().pipelines.map((p) => p.id));
    } catch {
      // Config went invalid between writes (e.g. mid-edit). Fall back to whatever
      // the status store has, rather than 500-ing the status panel.
      return listStatus();
    }
  },
  runPipeline: async (id) => {
    // Standalone Config UI: no scheduler running. For full boot use `src/index.ts`.
    console.log(`[run-config-ui] runPipeline(${id}) invoked — standalone UI mode, no scheduler attached`);
  },
  ...(cfg.configUiAuth ? { auth: cfg.configUiAuth } : {}),
});

await server.start(cfg.configUiPort);
console.log(`Config UI listening on http://0.0.0.0:${cfg.configUiPort}`);
