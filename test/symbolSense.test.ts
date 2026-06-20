import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildDevelopmentDependencyPayload,
  buildSymbolSensePromptRecords,
  convertSymbolSenseToDependencies,
  normalizeSymbolSensePayload,
} from '../src/shared/utils/symbolSense.ts';
import type { ChapterDependencies, SymbolSenseFormulaResult, SymbolSensePayload } from '../src/shared/types/formula.ts';

const chapter: ChapterDependencies = {
  chapter_id: 'chapter7',
  version: 1,
  generated_at: '2026-05-22T00:00:00Z',
  formulas: [
    {
      id: 'formula_7.3',
      latex: '\\mu = E[X]',
      label: 'Formula 7.3',
      chapter_id: 'chapter7',
      section: '7.1 Expectation',
      subsection: '',
      position: 3,
      context_text: 'The mean is written as mu.',
      symbols_used: ['\\mu', 'E', 'X'],
      symbols_defined: ['\\mu'],
    },
    {
      id: 'formula_7.8',
      latex: 'E[g(X)] = \\sum_x g(x)p(x)',
      label: 'Formula 7.8',
      chapter_id: 'chapter7',
      section: '7.1 Expectation',
      subsection: '',
      position: 8,
      context_text: 'The expectation operator averages a function of X.',
      symbols_used: ['E', 'X', 'g', 'p'],
      symbols_defined: ['E'],
    },
    {
      id: 'formula_7.12',
      latex: '\\sigma^2 = E[(X - \\mu)^2]',
      label: 'Formula 7.12',
      chapter_id: 'chapter7',
      section: '7.2 Variance',
      subsection: '',
      position: 12,
      context_text: '设 X 是随机变量，其分布为 p(x)。方差定义为随机变量与其均值之差的平方的期望。',
      symbols_used: ['\\sigma^2', 'E', 'X', '\\mu'],
      symbols_defined: ['\\sigma^2'],
    },
  ],
  dependencies: [],
  symbol_index: {},
  ambiguous: [],
};

test('buildSymbolSensePromptRecords includes only upstream formulas', () => {
  const records = buildSymbolSensePromptRecords(chapter);
  const varianceRecord = records.find((record) => record.formula_id === 'formula_7.12')!;

  assert.deepEqual(
    varianceRecord.chapter_context.formulas_before.map((formula) => formula.id),
    ['formula_7.3', 'formula_7.8'],
  );
  assert.doesNotMatch(varianceRecord.prompt, /formula_7\.99/);
});

test('normalizeSymbolSensePayload validates match types and missing formulas', () => {
  const raw = {
    results: [
      {
        formula_id: 'formula_7.12',
        symbols_used: ['E'],
        symbols_defined: ['\\sigma^2'],
        resolution: [
          {
            symbol: 'E',
            sense_id: 'chapter7_expectation_001',
            match_type: 'bad_type',
            source: { type: 'formula', formula_id: 'formula_7.8' },
            confidence: 0.9,
          },
        ],
        ambiguous_symbols: [],
        merge_decisions: [],
      },
    ],
  };

  const normalized = normalizeSymbolSensePayload(raw, { chapter, generatedAt: '2026-05-22T00:00:00Z' });

  assert.ok(normalized.payload);
  assert.match(
    normalized.issues.map((issue) => issue.message).join('\n'),
    /Invalid match_type/,
  );
  assert.match(
    normalized.issues.map((issue) => issue.message).join('\n'),
    /Missing Symbol Sense result/,
  );
});

test('convertSymbolSenseToDependencies maps resolutions and rejects downstream references', () => {
  const payload: SymbolSensePayload = {
    chapter_id: 'chapter7',
    version: 1,
    generated_at: '2026-05-22T00:00:00Z',
    results: [
      emptyResult('formula_7.3'),
      emptyResult('formula_7.8'),
      {
        formula_id: 'formula_7.12',
        symbols_used: ['\\sigma^2', 'E', 'X', '\\mu'],
        symbols_defined: ['\\sigma^2'],
        resolution: [
          {
            symbol: '\\sigma^2',
            sense_id: 'chapter7_sigma2_001',
            match_type: 'self_defined',
            source: { type: 'none' },
            meaning: '随机变量的方差',
            scope: { section: '7.2', position_range: { start: 12, end: 12 } },
            relationship: '由本公式定义',
            confidence: 1,
            reason: '出现在等号左边',
            candidates: [],
          },
          {
            symbol: 'E',
            sense_id: 'chapter7_expectation_001',
            match_type: 'formula_dependency',
            source: { type: 'formula', formula_id: 'formula_7.8' },
            meaning: '期望算子',
            scope: { section: '7.1', position_range: { start: 8, end: 8 } },
            relationship: '需要对平方差取期望',
            confidence: 0.92,
            reason: '最近的前置期望定义',
            candidates: [],
          },
          {
            symbol: 'X',
            sense_id: 'chapter7_X_001',
            match_type: 'variable_definition',
            source: { type: 'text', text_excerpt: '设 X 是随机变量' },
            meaning: '一个随机变量',
            scope: { section: '7.2', position_range: { start: null, end: null } },
            relationship: '方差正在刻画 X',
            confidence: 0.75,
            reason: '附近文本定义了 X',
            candidates: [],
          },
          {
            symbol: 'bad',
            sense_id: 'chapter7_bad_001',
            match_type: 'formula_dependency',
            source: { type: 'formula', formula_id: 'formula_7.99' },
            meaning: 'bad downstream item',
            scope: { section: '7.2', position_range: { start: 99, end: 99 } },
            relationship: 'invalid',
            confidence: 0.9,
            reason: 'unknown formula',
            candidates: [],
          },
          {
            symbol: 'Y',
            sense_id: 'chapter7_Y_001',
            match_type: 'unresolved',
            source: { type: 'none' },
            meaning: '',
            scope: { section: '7.2', position_range: { start: null, end: null } },
            relationship: '',
            confidence: 0,
            reason: 'not found',
            candidates: [],
          },
        ],
        ambiguous_symbols: [],
        merge_decisions: [
          {
            symbol: '\\sigma^2',
            existing_sense_id: null,
            new_sense_id: 'chapter7_sigma2_001',
            action: 'create_new',
            reason: 'first definition',
          },
        ],
      },
    ],
  };

  const converted = convertSymbolSenseToDependencies(chapter, payload);
  const varianceDeps = converted.dependencies.find((dependency) => dependency.dependent_id === 'formula_7.12')!;

  assert.deepEqual(
    varianceDeps.prerequisites.map((item) => item.type),
    ['formula', 'variable_definition'],
  );
  assert.equal(varianceDeps.prerequisites[0].target_id, 'formula_7.8');
  assert.equal(varianceDeps.prerequisites[0].sense_id, 'chapter7_expectation_001');
  assert.equal(varianceDeps.prerequisites[1].meaning, '一个随机变量');
  assert.equal(converted.ambiguous[0].symbol, 'Y');
  assert.match(converted.issues[0].message, /Unknown prerequisite formula id/);
  assert.ok(converted.registry.chapter7_sigma2_001);
});

test('buildDevelopmentDependencyPayload preserves formulas and increments dependency version', () => {
  const payload: SymbolSensePayload = {
    chapter_id: 'chapter7',
    version: 1,
    generated_at: '2026-05-22T00:00:00Z',
    results: chapter.formulas.map((formula) => emptyResult(formula.id)),
  };

  const converted = buildDevelopmentDependencyPayload(chapter, payload, '2026-05-22T01:00:00Z');

  assert.equal(converted.chapter.version, 2);
  assert.equal(converted.chapter.generated_at, '2026-05-22T01:00:00Z');
  assert.equal(converted.chapter.formulas.length, chapter.formulas.length);
  assert.equal(converted.chapter.dependencies.length, chapter.formulas.length);
});

function emptyResult(formulaId: string): SymbolSenseFormulaResult {
  return {
    formula_id: formulaId,
    symbols_used: [],
    symbols_defined: [],
    resolution: [],
    ambiguous_symbols: [],
    merge_decisions: [],
  };
}
