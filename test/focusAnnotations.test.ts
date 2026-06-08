import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCompoundFocusAnnotations, buildFormulaWideFocusAnnotation } from '../src/utils/focusAnnotations.ts';

test('buildCompoundFocusAnnotations extracts one-minus factors', () => {
  const notes = buildCompoundFocusAnnotations({
    latex: '\\sigma_{A A}^{2}(t)\\simeq(1-f_{t})^{2}\\sigma_{A A}^{2}(0)',
    context_text: 'inbreeding erodes additive-by-additive variance',
  });

  assert.ok(notes.some((item) => item.symbol === '(1-f_{t})^2' && item.kind === 'compound'));
  assert.ok(notes.some((item) => item.symbol.replace(/\s+/g, '') === '\\sigma_{AA}^{2}(0)' && item.kind === 'compound'));
});

test('buildCompoundFocusAnnotations extracts paired ft factors', () => {
  const notes = buildCompoundFocusAnnotations({
    latex: '\\sigma_{A}^{2}(t)\\simeq(1-f_{t})\\sigma_{A}^{2}(0)+4f_{t}(1-f_{t})\\sigma_{A A}^{2}(0)',
    context_text: 'additive variance under inbreeding',
  });

  assert.ok(notes.some((item) => item.symbol === '(1-f_{t})'));
  assert.ok(notes.some((item) => item.symbol.includes('f_{t}') && item.symbol.includes('1') && item.kind === 'compound'));
});

test('buildCompoundFocusAnnotations extracts general powered groups across the book', () => {
  const notes = buildCompoundFocusAnnotations({
    latex: '\\ell(\\mu,\\sigma^{2}\\mid x_{i})=\\frac{1}{\\sqrt{2\\pi\\sigma^{2}}}\\exp\\left(-\\frac{(x_{i}-\\mu)^{2}}{2\\sigma^{2}}\\right)',
    context_text: 'normal likelihood',
  });

  assert.ok(notes.some((item) => item.symbol === '(x_{i}-\\mu)^2' && item.kind === 'compound'));
  assert.ok(notes.some((item) => item.symbol === '\\frac{(x_{i}-\\mu)^{2}}{2\\sigma^{2}}' && item.kind === 'compound'));
});

test('buildCompoundFocusAnnotations keeps non-integer powers intact', () => {
  const notes = buildCompoundFocusAnnotations({
    latex: '\\alpha=1-(1-\\pi)^{1/n}',
    context_text: 'multiple testing correction',
  });

  assert.ok(notes.some((item) => item.symbol === '(1-\\pi)^{1/n}' && item.kind === 'compound'));
});

test('buildCompoundFocusAnnotations extracts derivative fractions', () => {
  const notes = buildCompoundFocusAnnotations({
    latex: '\\frac{\\partial\\varphi(x,t)}{\\partial t}=-\\frac{\\partial[m(x)\\varphi(x,t)]}{\\partial x}',
    context_text: 'diffusion equation',
  });

  assert.ok(notes.some((item) => item.symbol === '\\frac{\\partial\\varphi(x,t)}{\\partial t}'));
  assert.ok(notes.some((item) => item.symbol === '\\frac{\\partial[m(x)\\varphi(x,t)]}{\\partial x}'));
  assert.ok(notes.some((item) => item.symbol === '\\partial\\varphi(x,t)' && item.target === '\\frac{\\partial\\varphi(x,t)}{}'));
  assert.ok(notes.some((item) => item.symbol === '\\partial t' && item.target === '\\frac{}{\\partial t}'));
});

test('buildCompoundFocusAnnotations extracts numerator and denominator parts', () => {
  const notes = buildCompoundFocusAnnotations({
    latex: '\\overline W=\\sum_{j=1}^{n}p_jW_j=\\frac{1}{2}\\sum_{j=1}^{n}p_j\\frac{\\partial\\overline W}{\\partial p_j}',
    context_text: 'mean fitness gradient identity',
  });

  assert.ok(notes.some((item) => item.symbol === '\\partial\\overline W' && item.target === '\\frac{\\partial\\overline W}{}'));
  assert.ok(notes.some((item) => item.symbol === '\\partial p_j' && item.target === '\\frac{}{\\partial p_j}'));
});

test('buildCompoundFocusAnnotations extracts simple ratio whole and part targets', () => {
  const notes = buildCompoundFocusAnnotations({
    latex: '\\frac{d_s}{p_s}=q',
    context_text: 'local ratio of d_s to p_s',
  });

  assert.ok(notes.some((item) => item.symbol === '\\frac{d_s}{p_s}' && item.target === '\\frac{d_s}{p_s}'));
  assert.ok(notes.some((item) => item.symbol === 'd_s' && item.target === '\\frac{d_s}{}'));
  assert.ok(notes.some((item) => item.symbol === 'p_s' && item.target === '\\frac{}{p_s}'));
});

test('buildCompoundFocusAnnotations extracts single-letter numerator and denominator parts', () => {
  const notes = buildCompoundFocusAnnotations({
    latex: '\\widehat{h}_{r}^{2}=\\frac{R}{S}',
    context_text: 'heritability as response over selection differential',
  });

  assert.ok(notes.some((item) => item.symbol === 'R' && item.target === '\\frac{R}{}'));
  assert.ok(notes.some((item) => item.symbol === 'S' && item.target === '\\frac{}{S}'));
});

test('buildCompoundFocusAnnotations does not add generic parts for complex summation fractions', () => {
  const notes = buildCompoundFocusAnnotations({
    latex: '\\frac{\\sum_{i}D_{si}P_{ai}/(P_{si}+D_{si})}{\\sum_{i}P_{si}D_{ai}/(P_{si}+D_{si})}',
    context_text: 'multi-gene MK estimator',
  });

  const whole = notes.find((item) => item.symbol.startsWith('\\frac{'));
  assert.ok(whole);
  assert.match(whole.meaning || '', /TG 加权 MK 比值|Tarone-Greenland/);
  assert.equal(notes.some((item) => item.target === '\\frac{\\sum_{i}D_{si}P_{ai}/(P_{si}+D_{si})}{}'), false);
  assert.equal(notes.some((item) => item.target === '\\frac{}{\\sum_{i}P_{si}D_{ai}/(P_{si}+D_{si})}'), false);
});

test('buildCompoundFocusAnnotations normalizes legacy over factors', () => {
  const notes = buildCompoundFocusAnnotations({
    latex: '\\begin{align*}(1-f_t)=\\left(1-{1\\over2N}\\right)^t\\end{align*}',
    context_text: 'inbreeding recurrence',
  });

  assert.ok(notes.some((item) => item.symbol === '(1-\\frac{1}{2N})^t'));
});

test('buildCompoundFocusAnnotations keeps simple numeric fractions when they scale a formula', () => {
  const notes = buildCompoundFocusAnnotations({
    latex: '\\frac{1}{2}v(p)\\frac{\\partial^{2}u(p)}{\\partial p^{2}}',
    context_text: 'diffusion coefficient',
  });

  assert.ok(notes.some((item) => item.symbol === '\\frac{1}{2}'));
  assert.ok(notes.some((item) => item.symbol === '\\frac{\\partial^{2}u(p)}{\\partial p^{2}}'));
});

test('buildCompoundFocusAnnotations extracts matrix transpose groups', () => {
  const notes = buildCompoundFocusAnnotations({
    latex: 'd_i^2=({\\bf z}_i-{\\bf\\bar z})^T{\\bf S^{-1}_Z}({\\bf z}_i-{\\bf\\bar z})',
    context_text: 'Mahalanobis distance',
  });

  assert.ok(notes.some((item) => item.symbol === '(\\mathbf{z}_i-\\mathbf{\\bar{z}})^T'));
});

test('buildFormulaWideFocusAnnotation creates a whole-formula fallback', () => {
  const note = buildFormulaWideFocusAnnotation({
    latex: 'R=h^2S',
    context_text: 'The breeder equation predicts response to selection.',
  });

  assert.equal(note?.kind, 'formula');
  assert.match(note?.meaning || '', /整条公式/);
});
