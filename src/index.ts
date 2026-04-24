import 'dotenv/config';
import { promises as fs } from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { CONFIG_PATH, loadConfig, validateConfig } from '../config.js';
import type { SpeculaConfig } from './types.js';
import { runPipeline } from './pipeline.js';
import { createScheduler, type Scheduler } from './scheduler.js';
import { createConfigUiServer } from './config-ui/server.js';
import { listStatus } from './status/index.js';

export interface BootOptions {
  /** Absolute path to config.json. Defaults to repo-local CONFIG_PATH. */
  configPath?: string;
  /** Override config loader (tests). */
  loadConfig?: (configPath?: string) => SpeculaConfig;
  /** Override config writer. Must be atomic. */
  saveConfig?: (cfg: SpeculaConfig, configPath: string) => Promise<void>;
  /** Override pipeline runner (tests). */
  runPipeline?: typeof runPipeline;
}

export interface BootResult {
  scheduler: Scheduler;
  server: HttpServer;
  port: number;
  /** Gracefully stop scheduler + HTTP server. */
  shutdown(): Promise<void>;
}

async function defaultSaveConfig(cfg: SpeculaConfig, configPath: string): Promise<void> {
  validateConfig(cfg);
  const tmp = `${configPath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  await fs.rename(tmp, configPath);
}

/**
 * Boot the Specula service: load config, start the scheduler, start the
 * Config UI HTTP server, and wire them together so manual runs and
 * config-change events flow correctly.
 *
 * Startup validation: `loadConfig` throws on invalid config, and the
 * scheduler throws if `pipelines.length` is not a factor of 60 — both
 * before any HTTP listener opens.
 */
export async function boot(options?: BootOptions): Promise<BootResult> {
  const configPath = options?.configPath ?? CONFIG_PATH;
  const loadCfg = options?.loadConfig ?? loadConfig;
  const saveCfg = options?.saveConfig ?? defaultSaveConfig;
  const runPipelineImpl = options?.runPipeline ?? runPipeline;

  // Startup validation — throws before we register anything.
  const initialConfig = loadCfg(configPath);
  const port = initialConfig.configUiPort;
  const auth = initialConfig.configUiAuth;

  const scheduler = createScheduler({
    configPath,
    getConfig: () => loadCfg(configPath),
    runPipeline: async (cfg, pipeline) => {
      await runPipelineImpl(cfg, pipeline);
    },
  });
  scheduler.start();

  const server = createConfigUiServer({
    configPath,
    loadConfig: () => loadCfg(configPath),
    saveConfig: (cfg) => saveCfg(cfg, configPath),
    listStatus: () => {
      try {
        return listStatus(loadCfg(configPath).pipelines.map((p) => p.id));
      } catch {
        // If config is momentarily invalid (mid-edit), fall back to any
        // statuses that modules have populated so the UI doesn't 500.
        return listStatus();
      }
    },
    runPipeline: async (id) => {
      await scheduler.trigger(id);
    },
    ...(auth ? { auth } : {}),
  });
  server.events.on('configUpdated', () => {
    try {
      scheduler.reload();
      console.log('[specula] configUpdated → scheduler reloaded');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[specula] configUpdated reload failed: ${msg}`);
    }
  });

  const httpServer = await server.start(port);
  console.log(`[specula] config-ui listening on http://0.0.0.0:${port}`);
  const entries = scheduler.getSchedule();
  console.log(
    `[specula] scheduled ${entries.length} pipeline(s): ${entries
      .map((e) => `${e.pipelineId}@:${String(e.offsetMinutes).padStart(2, '0')}`)
      .join(', ')}`,
  );

  return {
    scheduler,
    server: httpServer,
    port,
    shutdown(): Promise<void> {
      return new Promise((resolve, reject) => {
        scheduler.stop();
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

function installSignalHandlers(result: BootResult): void {
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
}

/**
 * Determine whether this module was invoked as the main process entrypoint.
 * Works for both direct ESM execution and the tsx ESM loader.
 */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === entry;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  boot()
    .then((result) => {
      installSignalHandlers(result);
    })
    .catch((err) => {
      console.error('[specula] fatal boot error:', err);
      process.exit(1);
    });
}
