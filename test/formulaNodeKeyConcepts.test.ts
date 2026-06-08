import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectKeyConcepts, type KeyConceptAnnotation } from '../src/utils/keyConceptAnnotations.ts';

test('selectKeyConcepts keeps only formula-level concept symbols', () => {
  const annotations: KeyConceptAnnotation[] = [
    {
      symbol: '\\widehat{\\overline{\\alpha}}_{TG}',
      note: '适应性替换比例估计量',
      kind: 'symbol',
    },
    {
      symbol: '\\alpha',
      note: '适应性替换比例估计量',
      kind: 'symbol',
    },
    {
      symbol: 'NI_{TG}',
      note: 'NI_TG 表示中性指数',
      kind: 'symbol',
    },
    {
      symbol: 'P_{ai}',
      note: '替换位点多态性（第 i 个基因）',
      kind: 'symbol',
    },
    {
      symbol: 'D_{si}',
      note: '沉默位点分化（第 i 个基因）',
      kind: 'symbol',
    },
    {
      symbol: '\\frac{\\sum_{i}D_{si}P_{ai}/(P_{si}+D_{si})}{\\sum_{i}P_{si}D_{ai}/(P_{si}+D_{si})}',
      note: 'TG 加权 MK 比值',
      kind: 'compound',
    },
  ];

  const keySymbols = selectKeyConcepts(annotations).map((item) => item.symbol);

  assert.deepEqual(keySymbols, ['\\widehat{\\overline{\\alpha}}_{TG}', 'NI_{TG}']);
});
