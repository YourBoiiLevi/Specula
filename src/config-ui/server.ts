import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs, existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import type { SpeculaConfig, ConfigUiAuth, PipelineRunStatus } from '../types.js';
import { validateConfig } from '../../config.js';

export interface CreateConfigUiServerOpts {
  /** Absolute path to config.json. Used for status pipeline-id ordering + future hot-reload. */
  configPath: string;
  /** Load the current config on demand (every GET /api/config call). */
  loadConfig: () => SpeculaConfig;
  /** Persist a validated config to disk. Must be atomic. */
  saveConfig: (cfg: SpeculaConfig) => Promise<void>;
  /** Return PipelineRunStatus[] already ordered by caller's preference. */
  listStatus: () => PipelineRunStatus[];
  /** Trigger a pipeline run. Phase 5 wires the real scheduler; Phase 4 accepts a stub. */
  runPipeline: (pipelineId: string) => Promise<void>;
  /** If set, protects all routes with HTTP Basic auth. */
  auth?: ConfigUiAuth;
}

export interface ConfigUiServer {
  app: Express;
  events: EventEmitter; // emits 'configUpdated' after a successful POST /api/config
  start(port: number, host?: string): Promise<http.Server>;
}

export function createConfigUiServer(opts: CreateConfigUiServerOpts): ConfigUiServer {
  const app = express();
  const events = new EventEmitter();

  if (opts.auth) {
    const { user: expectedUser, pass: expectedPass } = opts.auth;
    app.use((req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Basic ')) {
        res.set('WWW-Authenticate', 'Basic realm="Specula Config", charset="UTF-8"');
        res.status(401).send('Unauthorized');
        return;
      }

      const b64auth = authHeader.split(' ')[1];
      if (!b64auth) {
        res.set('WWW-Authenticate', 'Basic realm="Specula Config", charset="UTF-8"');
        res.status(401).send('Unauthorized');
        return;
      }

      const [user, pass] = Buffer.from(b64auth, 'base64').toString().split(':');
      if (user === undefined || pass === undefined) {
        res.set('WWW-Authenticate', 'Basic realm="Specula Config", charset="UTF-8"');
        res.status(401).send('Unauthorized');
        return;
      }

      const maxUserLen = Math.max(user.length, expectedUser.length);
      const maxPassLen = Math.max(pass.length, expectedPass.length);

      const userBuf = Buffer.from(user.padEnd(maxUserLen, '\0'));
      const expectedUserBuf = Buffer.from(expectedUser.padEnd(maxUserLen, '\0'));
      const passBuf = Buffer.from(pass.padEnd(maxPassLen, '\0'));
      const expectedPassBuf = Buffer.from(expectedPass.padEnd(maxPassLen, '\0'));

      const userMatch = timingSafeEqual(userBuf, expectedUserBuf) && user.length === expectedUser.length;
      const passMatch = timingSafeEqual(passBuf, expectedPassBuf) && pass.length === expectedPass.length;

      if (userMatch && passMatch) {
        next();
      } else {
        res.set('WWW-Authenticate', 'Basic realm="Specula Config", charset="UTF-8"');
        res.status(401).send('Unauthorized');
      }
    });
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const primaryPublicDir = path.join(__dirname, 'public');
  const fallbackPublicDir = path.resolve(process.cwd(), 'src/config-ui/public');

  let publicDir = primaryPublicDir;
  if (!existsSync(path.join(primaryPublicDir, 'index.html'))) {
    console.warn(`[config-ui] Primary public dir ${primaryPublicDir} missing index.html, falling back to ${fallbackPublicDir}`);
    publicDir = fallbackPublicDir;
  }

  app.use(express.json({ limit: '1mb' }));
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ ok: false, errors: [{ path: '', message: 'Malformed JSON body' }] });
      return;
    }
    next(err);
  });

  app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use('/assets', express.static(publicDir));

  app.get('/api/config', (req, res) => {
    try {
      const config = opts.loadConfig();
      res.json({ config });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/config', async (req, res) => {
    try {
      const body = req.body;
      let validatedConfig: SpeculaConfig;
      try {
        validatedConfig = validateConfig(body);
      } catch (err: any) {
        const errors: { path: string; message: string }[] = [];
        if (err instanceof Error) {
          const lines = err.message.split('\n');
          for (const line of lines) {
            const match = line.match(/^\s*-\s*([^:]+):\s*(.+)$/);
            if (match) {
              errors.push({ path: match[1] as string, message: match[2] as string });
            }
          }
          if (errors.length === 0) {
            errors.push({ path: '', message: err.message });
          }
        } else {
          errors.push({ path: '', message: String(err) });
        }
        res.status(400).json({ ok: false, errors });
        return;
      }

      await opts.saveConfig(validatedConfig);
      events.emit('configUpdated', validatedConfig);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, errors: [{ path: '', message: err.message }] });
    }
  });

  app.get('/api/status', (req, res) => {
    res.json({ pipelines: opts.listStatus() });
  });

  app.post('/api/run/:pipelineId', (req, res) => {
    const pipelineId = req.params.pipelineId;
    if (!pipelineId) {
      res.status(400).json({ ok: false, error: 'Missing pipelineId' });
      return;
    }
    try {
      const config = opts.loadConfig();
      const exists = config.pipelines.some(p => p.id === pipelineId);
      if (!exists) {
        res.status(404).json({ ok: false, error: 'Unknown pipeline' });
        return;
      }
      
      opts.runPipeline(pipelineId).catch(err => {
        console.error(`[config-ui] Error running pipeline ${pipelineId}:`, err);
      });
      
      res.status(202).json({ ok: true, accepted: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return {
    app,
    events,
    start(port: number, host: string = '0.0.0.0'): Promise<http.Server> {
      return new Promise((resolve, reject) => {
        const server = app.listen(port, host, () => resolve(server));
        server.on('error', reject);
      });
    }
  };
}
