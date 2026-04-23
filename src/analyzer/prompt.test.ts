import { describe, it, expect } from 'vitest';
import type { Pipeline } from '../types.js';
import { buildSystemPrompt, buildUserPrompt } from './prompt.js';

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'ai-research',
    label: 'AI Research',
    description: 'recent work across model labs and academic papers',
    feedGroups: [{ id: 'lab', label: 'Lab', url: 'https://example.com/feed' }],
    ...overrides,
  };
}

describe('buildSystemPrompt', () => {
  it('substitutes the {N} item count placeholder', () => {
    const prompt = buildSystemPrompt(makePipeline(), 7);
    expect(prompt).toContain('containing 7 feed items');
    expect(prompt).not.toContain('{N}');
  });

  it('substitutes {pipeline.label} and {pipeline.description}', () => {
    const prompt = buildSystemPrompt(makePipeline(), 3);
    expect(prompt).toContain('from AI Research sources');
    expect(prompt).toContain(
      'covering: recent work across model labs and academic papers',
    );
    expect(prompt).not.toContain('{pipeline.label}');
    expect(prompt).not.toContain('{pipeline.description}');
  });

  it('omits the "Additional focus" block when focusInstructions is missing', () => {
    const prompt = buildSystemPrompt(makePipeline(), 1);
    expect(prompt).not.toContain('Additional focus for this pipeline');
    expect(prompt).not.toContain('{pipeline.focusInstructions}');
  });

  it('omits the "Additional focus" block when focusInstructions is empty', () => {
    const prompt = buildSystemPrompt(makePipeline({ focusInstructions: '' }), 1);
    expect(prompt).not.toContain('Additional focus for this pipeline');
  });

  it('omits the "Additional focus" block when focusInstructions is whitespace only', () => {
    const prompt = buildSystemPrompt(makePipeline({ focusInstructions: '   \n\t  ' }), 1);
    expect(prompt).not.toContain('Additional focus for this pipeline');
  });

  it('includes the "Additional focus" block with the provided text when present', () => {
    const prompt = buildSystemPrompt(
      makePipeline({ focusInstructions: 'Prioritize safety-research outlets.' }),
      5,
    );
    expect(prompt).toContain('Additional focus for this pipeline:');
    expect(prompt).toContain('Prioritize safety-research outlets.');
  });

  it('preserves the literal fenced-html and fenced-iframe rich-media instructions', () => {
    const prompt = buildSystemPrompt(makePipeline(), 3);
    expect(prompt).toContain('```html');
    expect(prompt).toContain('```iframe');
    expect(prompt).toContain('cdnjs.cloudflare.com');
  });
});

describe('buildUserPrompt', () => {
  it('substitutes nowIso, itemCount, and pipeline.label', () => {
    const prompt = buildUserPrompt(
      makePipeline(),
      12,
      '2026-04-23T12:34:56.000Z',
    );
    expect(prompt).toContain('It is 2026-04-23T12:34:56.000Z UTC');
    expect(prompt).toContain('Analyze the 12 feed items');
    expect(prompt).toContain('for the AI Research pipeline');
    expect(prompt).not.toContain('{nowIso}');
    expect(prompt).not.toContain('{N}');
    expect(prompt).not.toContain('{pipeline.label}');
  });
});
