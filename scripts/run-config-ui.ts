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
  listStatus: () => listStatus(cfg.pipelines.map((p) => p.id)),
  runPipeline: async (id) => {
    console.log(`[run-config-ui] runPipeline(${id}) invoked — scheduler not wired yet (Phase 5)`);
  },
  ...(cfg.configUiAuth ? { auth: cfg.configUiAuth } : {}),
});

await server.start(cfg.configUiPort);
console.log(`Config UI listening on http://0.0.0.0:${cfg.configUiPort}`);
