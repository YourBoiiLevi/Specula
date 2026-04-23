import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createConfigUiServer } from './server.js';
import type { SpeculaConfig } from '../types.js';

function fakeConfig(): SpeculaConfig {
  return {
    intervalHours: 1,
    primaryModel: 'gpt-4o',
    fallbackModel: 'gpt-4o-mini',
    thinkingLevel: 'low',
    maxItemsPerRun: 10,
    dedupWindowHours: 24,
    siteRepoPath: '/tmp/site',
    githubPagesUrl: 'https://example.com',
    feedTitle: 'Test',
    feedDescription: 'Test',
    configUiPort: 3001,
    pipelines: [
      {
        id: 'p1',
        label: 'P1',
        description: 'P1 desc',
        feedGroups: [{ id: 'fg1', label: 'FG1', url: 'http://example.com/rss' }],
      },
    ],
  };
}

describe('Config UI Server', () => {
  it('GET / returns 200 HTML', async () => {
    const server = createConfigUiServer({
      configPath: '/tmp/config.json',
      loadConfig: fakeConfig,
      saveConfig: async () => {},
      listStatus: () => [],
      runPipeline: async () => {},
    });
    const res = await request(server.app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    // We don't have the actual index.html yet in the test environment, but express.static or sendFile will fail if not found.
    // Wait, we need to create the public files first for this test to pass.
  });

  it('GET /api/config returns config', async () => {
    const cfg = fakeConfig();
    const server = createConfigUiServer({
      configPath: '/tmp/config.json',
      loadConfig: () => cfg,
      saveConfig: async () => {},
      listStatus: () => [],
      runPipeline: async () => {},
    });
    const res = await request(server.app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ config: cfg });
  });

  it('POST /api/config with valid body saves and emits', async () => {
    const cfg = fakeConfig();
    const saveConfig = vi.fn().mockResolvedValue(undefined);
    const server = createConfigUiServer({
      configPath: '/tmp/config.json',
      loadConfig: () => cfg,
      saveConfig,
      listStatus: () => [],
      runPipeline: async () => {},
    });
    
    const emitSpy = vi.spyOn(server.events, 'emit');
    
    const res = await request(server.app).post('/api/config').send(cfg);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(saveConfig).toHaveBeenCalledWith(cfg);
    expect(emitSpy).toHaveBeenCalledWith('configUpdated', cfg);
  });

  it('POST /api/config with invalid body (pipelines.length = 7) returns 400', async () => {
    const cfg = fakeConfig();
    cfg.pipelines = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i}`,
      label: `P${i}`,
      description: 'desc',
      feedGroups: [{ id: 'fg1', label: 'FG1', url: 'http://example.com/rss' }],
    }));
    
    const server = createConfigUiServer({
      configPath: '/tmp/config.json',
      loadConfig: fakeConfig,
      saveConfig: async () => {},
      listStatus: () => [],
      runPipeline: async () => {},
    });
    
    const res = await request(server.app).post('/api/config').send(cfg);
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('factor of 60') })
      ])
    );
  });

  it('POST /api/config with bad slug returns 400', async () => {
    const cfg = fakeConfig();
    if (cfg.pipelines[0]) {
      cfg.pipelines[0].id = 'BAD_SLUG!';
    }
    
    const server = createConfigUiServer({
      configPath: '/tmp/config.json',
      loadConfig: fakeConfig,
      saveConfig: async () => {},
      listStatus: () => [],
      runPipeline: async () => {},
    });
    
    const res = await request(server.app).post('/api/config').send(cfg);
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'pipelines.0.id' })
      ])
    );
  });

  it('POST /api/config with malformed JSON returns 400', async () => {
    const server = createConfigUiServer({
      configPath: '/tmp/config.json',
      loadConfig: fakeConfig,
      saveConfig: async () => {},
      listStatus: () => [],
      runPipeline: async () => {},
    });
    
    const res = await request(server.app)
      .post('/api/config')
      .set('Content-Type', 'application/json')
      .send('{ bad json');
      
    expect(res.status).toBe(400);
    expect(res.body.errors[0].message).toBe('Malformed JSON body');
  });

  it('POST /api/config where saveConfig rejects returns 500', async () => {
    const cfg = fakeConfig();
    const server = createConfigUiServer({
      configPath: '/tmp/config.json',
      loadConfig: fakeConfig,
      saveConfig: async () => { throw new Error('Disk full'); },
      listStatus: () => [],
      runPipeline: async () => {},
    });
    
    const res = await request(server.app).post('/api/config').send(cfg);
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.errors[0].message).toBe('Disk full');
  });

  it('GET /api/status returns pipelines', async () => {
    const server = createConfigUiServer({
      configPath: '/tmp/config.json',
      loadConfig: fakeConfig,
      saveConfig: async () => {},
      listStatus: () => [{ pipelineId: 'p1', lastRunStatus: 'idle' }],
      runPipeline: async () => {},
    });
    
    const res = await request(server.app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pipelines: [{ pipelineId: 'p1', lastRunStatus: 'idle' }] });
  });

  it('POST /api/run/:id returns 202 and calls runPipeline', async () => {
    let resolveRun: () => void;
    const runPromise = new Promise<void>(r => { resolveRun = r; });
    const runPipeline = vi.fn().mockReturnValue(runPromise);
    
    const server = createConfigUiServer({
      configPath: '/tmp/config.json',
      loadConfig: fakeConfig,
      saveConfig: async () => {},
      listStatus: () => [],
      runPipeline,
    });
    
    const res = await request(server.app).post('/api/run/p1');
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true, accepted: true });
    expect(runPipeline).toHaveBeenCalledWith('p1');
    
    resolveRun!();
  });

  it('POST /api/run/unknown returns 404', async () => {
    const server = createConfigUiServer({
      configPath: '/tmp/config.json',
      loadConfig: fakeConfig,
      saveConfig: async () => {},
      listStatus: () => [],
      runPipeline: async () => {},
    });
    
    const res = await request(server.app).post('/api/run/unknown');
    expect(res.status).toBe(404);
  });

  describe('Auth', () => {
    const auth = { user: 'admin', pass: 'secret' };
    
    it('No header -> 401', async () => {
      const server = createConfigUiServer({
        configPath: '/tmp/config.json',
        loadConfig: fakeConfig,
        saveConfig: async () => {},
        listStatus: () => [],
        runPipeline: async () => {},
        auth,
      });
      const res = await request(server.app).get('/api/config');
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Basic realm="Specula Config", charset="UTF-8"');
    });

    it('Wrong user -> 401', async () => {
      const server = createConfigUiServer({
        configPath: '/tmp/config.json',
        loadConfig: fakeConfig,
        saveConfig: async () => {},
        listStatus: () => [],
        runPipeline: async () => {},
        auth,
      });
      const res = await request(server.app)
        .get('/api/config')
        .set('Authorization', 'Basic ' + Buffer.from('wrong:secret').toString('base64'));
      expect(res.status).toBe(401);
    });

    it('Wrong pass -> 401', async () => {
      const server = createConfigUiServer({
        configPath: '/tmp/config.json',
        loadConfig: fakeConfig,
        saveConfig: async () => {},
        listStatus: () => [],
        runPipeline: async () => {},
        auth,
      });
      const res = await request(server.app)
        .get('/api/config')
        .set('Authorization', 'Basic ' + Buffer.from('admin:wrong').toString('base64'));
      expect(res.status).toBe(401);
    });

    it('Correct creds -> 200', async () => {
      const server = createConfigUiServer({
        configPath: '/tmp/config.json',
        loadConfig: fakeConfig,
        saveConfig: async () => {},
        listStatus: () => [],
        runPipeline: async () => {},
        auth,
      });
      const res = await request(server.app)
        .get('/api/config')
        .set('Authorization', 'Basic ' + Buffer.from('admin:secret').toString('base64'));
      expect(res.status).toBe(200);
    });

    it('Malformed header -> 401', async () => {
      const server = createConfigUiServer({
        configPath: '/tmp/config.json',
        loadConfig: fakeConfig,
        saveConfig: async () => {},
        listStatus: () => [],
        runPipeline: async () => {},
        auth,
      });
      const res = await request(server.app)
        .get('/api/config')
        .set('Authorization', 'Bearer token');
      expect(res.status).toBe(401);
    });

    it('Auth absent -> 200 without header', async () => {
      const server = createConfigUiServer({
        configPath: '/tmp/config.json',
        loadConfig: fakeConfig,
        saveConfig: async () => {},
        listStatus: () => [],
        runPipeline: async () => {},
      });
      const res = await request(server.app).get('/api/config');
      expect(res.status).toBe(200);
    });
  });
});
