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
