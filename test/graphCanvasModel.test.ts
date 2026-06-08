import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFocusSymbolPrerequisites } from '../src/components/GraphView/graphCanvasModel.ts';
import type { ChapterFormula, FormulaDependency } from '../src/types/formula.ts';

test('buildFocusSymbolPrerequisites merges dependency notes with scanned symbols and fraction groups', () => {
  const formula: ChapterFormula = {
    id: 'formula_hover_ratio',
    latex: '\\frac{d_s}{p_s}=q',
    label: 'Formula hover ratio',
    chapter_id: 'chapter-test',
    section: 'Runtime hover',
    subsection: '',
    position: 0,
    context_text: 'The local ratio compares d_s with p_s.',
    symbols_defined: [],
    symbols_used: [],
  };
  const dependency: FormulaDependency = {
    dependent_id: formula.id,
    prerequisites: [
      {
        type: 'variable_definition',
        symbol: 'q',
        meaning: 'local comparison output',
        confidence: 0.86,
        edge_status: 'accepted',
      },
    ],
  };

  const notes = buildFocusSymbolPrerequisites(formula, dependency);
  const keys = notes.map((item) => `${item.kind || 'symbol'}:${item.target || item.symbol}`);

  assert.ok(keys.includes('symbol:q'));
  assert.ok(keys.includes('symbol:d_s'));
  assert.ok(keys.includes('symbol:p_s'));
  assert.ok(keys.includes('compound:\\frac{d_s}{p_s}'));
  assert.ok(keys.includes('compound:\\frac{d_s}{}'));
  assert.ok(keys.includes('compound:\\frac{}{p_s}'));
});
