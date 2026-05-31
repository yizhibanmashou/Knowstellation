import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bareMathTokenToLatex, splitRichMathText } from '../src/utils/richMathText.ts';

test('bareMathTokenToLatex normalizes Greek scripts from learner-facing copy', () => {
  assert.equal(bareMathTokenToLatex('σ_A²'), '\\sigma_{A}^{2}');
  assert.equal(bareMathTokenToLatex('σ_G²'), '\\sigma_{G}^{2}');
  assert.equal(bareMathTokenToLatex('σ_e²'), '\\sigma_{e}^{2}');
  assert.equal(bareMathTokenToLatex('sigma_A^2'), '\\sigma_{A}^{2}');
  assert.equal(bareMathTokenToLatex('o_A^2'), 'o_{A}^{2}');
});

test('splitRichMathText turns bare scripted math into inline math parts', () => {
  const parts = splitRichMathText('遗传方差 σ_A²(t) 与选择梯度 beta 共同决定响应。');

  assert.deepEqual(parts, [
    { type: 'text', value: '遗传方差 ' },
    { type: 'math', value: '\\sigma_{A}^{2}(t)', raw: 'σ_A²(t)', implicit: true },
    { type: 'text', value: ' 与选择梯度 beta 共同决定响应。' },
  ]);
});

test('splitRichMathText renders braced multi-letter subscripts as inline math', () => {
  const parts = splitRichMathText('D_{si} 表示第 i 类位点的衍生替代多态性数量。');

  assert.deepEqual(parts, [
    { type: 'math', value: 'D_{si}', raw: 'D_{si}', implicit: true },
    { type: 'text', value: ' 表示第 i 类位点的衍生替代多态性数量。' },
  ]);
});

test('splitRichMathText keeps scripted parenthesized factors together', () => {
  const parts = splitRichMathText('衰退因子 (1-f_t)^2 会整体缩放方差。');

  assert.deepEqual(parts, [
    { type: 'text', value: '衰退因子 ' },
    { type: 'math', value: '(1-f_{t})^{2}', raw: '(1-f_t)^2', implicit: true },
    { type: 'text', value: ' 会整体缩放方差。' },
  ]);
});

test('splitRichMathText handles unicode subscript and keeps explicit math delimiters', () => {
  const parts = splitRichMathText('从 R₀ 读起，再看 $h^2S$。');

  assert.deepEqual(parts, [
    { type: 'text', value: '从 ' },
    { type: 'math', value: 'R_{0}', raw: 'R₀', implicit: true },
    { type: 'text', value: ' 读起，再看 ' },
    { type: 'math', value: 'h^2S' },
    { type: 'text', value: '。' },
  ]);
});

test('splitRichMathText does not treat ordinary underscored identifiers as math', () => {
  assert.deepEqual(splitRichMathText('缓存键 chapter_id 不应该被公式化。'), [
    { type: 'text', value: '缓存键 chapter_id 不应该被公式化。' },
  ]);
});
