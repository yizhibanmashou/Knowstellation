import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatLockedFormulaReason, resolveLockedFormulaGuidance } from '../src/utils/lockedGuidance.ts';
import type { ChapterDependencies } from '../src/types/formula.ts';

const chapter: ChapterDependencies = {
  chapter_id: 'chapter7',
  version: 1,
  generated_at: '2026-01-01',
  formulas: [
    {
      id: 'formula_7.1',
      latex: 'p',
      label: 'Formula 7.1',
      chapter_id: 'chapter7',
      section: 'Selection',
      subsection: '',
      position: 1,
      depth: 0,
      context_text: '',
      symbols_used: [],
      symbols_defined: [],
    },
    {
      id: 'formula_7.2',
      latex: 'q',
      label: 'Formula 7.2',
      chapter_id: 'chapter7',
      section: 'Selection',
      subsection: '',
      position: 2,
      depth: 1,
      context_text: '',
      symbols_used: [],
      symbols_defined: [],
    },
  ],
  dependencies: [
    {
      dependent_id: 'formula_7.2',
      prerequisites: [
        {
          type: 'formula',
          target_id: 'formula_7.1',
          via_symbol: 'p',
          confidence: 0.92,
          edge_status: 'accepted',
        },
      ],
    },
  ],
  symbol_index: {},
  ambiguous: [],
};

test('resolveLockedFormulaGuidance selects a concrete same-chapter blocker', () => {
  const guidance = resolveLockedFormulaGuidance(chapter, 'formula_7.2');
  assert.deepEqual(guidance, {
    formulaId: 'formula_7.1',
    label: 'Formula 7.1',
    viaSymbol: 'p',
  });
});

test('resolveLockedFormulaGuidance returns null when blockers are already learned', () => {
  assert.equal(resolveLockedFormulaGuidance(chapter, 'formula_7.2', new Set(['formula_7.1'])), null);
});

test('resolveLockedFormulaGuidance ignores missing dependencies', () => {
  assert.equal(resolveLockedFormulaGuidance(chapter, 'formula_7.9'), null);
});

test('formatLockedFormulaReason falls back without guidance', () => {
  assert.equal(formatLockedFormulaReason('先学习与它相连的前置公式后解锁。', null), '先学习与它相连的前置公式后解锁。');
});

test('formatLockedFormulaReason includes formula label and via symbol', () => {
  assert.equal(
    formatLockedFormulaReason('fallback', { formulaId: 'formula_7.1', label: 'Formula 7.1', viaSymbol: 'p' }),
    '先读 Formula 7.1，因为这里要用到 p，读完就能解锁这一步。',
  );
});
