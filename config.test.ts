import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateConfig, calculateOffsets } from './config.js';

function loadExample(): unknown {
  const raw = readFileSync(path.resolve('config.json.example'), 'utf8');
  return JSON.parse(raw);
}

describe('validateConfig', () => {
  it('accepts the example config', () => {
    const cfg = validateConfig(loadExample());
    expect(cfg.pipelines).toHaveLength(2);
    expect(cfg.pipelines[0]?.id).toBe('placeholder-one');
    expect(cfg.thinkingLevel).toBe('low');
    expect(cfg.configUiPort).toBe(3001);
  });

  it('rejects a pipeline count of 7 (not a factor of 60)', () => {
    const base = loadExample() as { pipelines: unknown[] };
    const cfg = {
      ...(base as object),
      pipelines: Array.from({ length: 7 }, (_, i) => ({
        id: `p-${i}`,
        label: `Pipeline ${i}`,
        description: 'desc',
        feedGroups: [{ id: `g-${i}`, label: `G${i}`, url: 'https://example.com/f.xml' }],
      })),
    };
    expect(() => validateConfig(cfg)).toThrow(/factor of 60.*Received 7/s);
    expect(() => validateConfig(cfg)).toThrow(/1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60/);
  });

  it('rejects duplicate pipeline ids', () => {
    const cfg = {
      ...(loadExample() as object),
      pipelines: [
        {
          id: 'dup',
          label: 'A',
          description: 'a',
          feedGroups: [{ id: 'f1', label: 'F1', url: 'https://example.com/1.xml' }],
        },
        {
          id: 'dup',
          label: 'B',
          description: 'b',
          feedGroups: [{ id: 'f2', label: 'F2', url: 'https://example.com/2.xml' }],
        },
      ],
    };
    expect(() => validateConfig(cfg)).toThrow(/Duplicate pipeline id "dup"/);
  });

  it('rejects duplicate feed-group ids within a pipeline', () => {
    const cfg = {
      ...(loadExample() as object),
      pipelines: [
        {
          id: 'p-one',
          label: 'P One',
          description: 'x',
          feedGroups: [
            { id: 'same', label: 'A', url: 'https://example.com/a.xml' },
            { id: 'same', label: 'B', url: 'https://example.com/b.xml' },
          ],
        },
        {
          id: 'p-two',
          label: 'P Two',
          description: 'y',
          feedGroups: [{ id: 'only', label: 'O', url: 'https://example.com/o.xml' }],
        },
      ],
    };
    expect(() => validateConfig(cfg)).toThrow(/Duplicate feedGroup id "same"/);
  });

  it('rejects invalid slug-like ids (uppercase, spaces)', () => {
    const cfg = {
      ...(loadExample() as object),
      pipelines: [
        {
          id: 'BadID',
          label: 'Bad',
          description: 'x',
          feedGroups: [{ id: 'ok-id', label: 'OK', url: 'https://example.com/a.xml' }],
        },
        {
          id: 'also-bad',
          label: 'AB',
          description: 'y',
          feedGroups: [{ id: 'has space', label: 'Space', url: 'https://example.com/b.xml' }],
        },
      ],
    };
    expect(() => validateConfig(cfg)).toThrow(/slug-like/i);
  });
});

describe('calculateOffsets', () => {
  it('calculateOffsets(4) === [0, 15, 30, 45]', () => {
    expect(calculateOffsets(4)).toEqual([0, 15, 30, 45]);
  });

  it('calculateOffsets(3) === [0, 20, 40]', () => {
    expect(calculateOffsets(3)).toEqual([0, 20, 40]);
  });

  it('calculateOffsets(6) === [0, 10, 20, 30, 40, 50]', () => {
    expect(calculateOffsets(6)).toEqual([0, 10, 20, 30, 40, 50]);
  });
});
