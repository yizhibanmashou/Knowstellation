import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compactMathText, latexToReadableCandidates, symbolRequiresOverline } from '../src/utils/mathSymbolMatching.ts';

test('latexToReadableCandidates covers simple subscript forms', () => {
  const candidates = latexToReadableCandidates('N_e');
  assert.ok(candidates.includes('N_e'));
  assert.ok(candidates.includes('Ne'));
});

test('latexToReadableCandidates covers Greek subscript and superscript variants', () => {
  const candidates = latexToReadableCandidates('\\sigma_w^2');
  assert.ok(candidates.includes('σ_w^2'));
  assert.ok(candidates.includes('σw2'));
});

test('latexToReadableCandidates unwraps braced scripts', () => {
  const candidates = latexToReadableCandidates('\\sigma_{w}^{2}');
  assert.ok(candidates.includes('σ_w^2'));
  assert.ok(candidates.includes('σw2'));
});

test('latexToReadableCandidates handles overline notation', () => {
  const candidates = latexToReadableCandidates('\\overline{W}');
  assert.ok(candidates.includes('W'));
  assert.ok(candidates.includes('Wbar'));
});

test('symbolRequiresOverline identifies overline symbols', () => {
  assert.equal(symbolRequiresOverline('\\overline{W}'), true);
  assert.equal(symbolRequiresOverline('\\bar{\\imath}'), true);
  assert.equal(symbolRequiresOverline('W_{j}'), false);
});

test('latexToReadableCandidates handles Greek symbol with subscript', () => {
  const candidates = latexToReadableCandidates('\\mu_i');
  assert.ok(candidates.includes('μ_i'));
  assert.ok(candidates.includes('μi'));
});

test('latexToReadableCandidates handles barred dotless i selection intensity', () => {
  const candidates = latexToReadableCandidates('\\bar{\\imath}');
  assert.ok(candidates.includes('ı'));
  assert.ok(candidates.includes('i'));
  assert.ok(candidates.includes('\ue131'));
  assert.ok(candidates.includes('ıbar'));
});

test('latexToReadableCandidates keeps scripted overline symbols specific', () => {
  const primeCandidates = latexToReadableCandidates('\\overline{z}^{\\prime}');
  assert.ok(primeCandidates.includes("z'"));
  assert.ok(!primeCandidates.includes('z'));

  const subscriptCandidates = latexToReadableCandidates('\\overline{z}_{i}');
  assert.ok(subscriptCandidates.includes('z_i'));
  assert.ok(!subscriptCandidates.includes('z'));

  const nestedScriptCandidates = latexToReadableCandidates('\\widehat{\\overline{\\alpha}}_{TG}');
  assert.ok(nestedScriptCandidates.includes('α_TG'));
  assert.ok(nestedScriptCandidates.includes('αTG'));
});

test('compactMathText normalizes KaTeX accent and prime text', () => {
  assert.equal(compactMathText('z′'), "z'");
  assert.equal(compactMathText('\ue131ˉ'), '\ue131');
});

test('latexToReadableCandidates covers compound factors', () => {
  const oneMinusFt = latexToReadableCandidates('(1-f_t)');
  assert.ok(oneMinusFt.includes('(1-f_t)'));
  assert.ok(oneMinusFt.includes('(1-ft)'));

  const squared = latexToReadableCandidates('(1-f_t)^2');
  assert.ok(squared.includes('(1-f_t)^2'));
  assert.ok(squared.includes('(1-f_t)2'));
});

test('latexToReadableCandidates covers fractions and legacy over syntax', () => {
  const fraction = latexToReadableCandidates('\\frac{1}{2N}');
  assert.ok(fraction.includes('1/2N'));

  const legacy = latexToReadableCandidates('{1\\over2N}');
  assert.ok(legacy.includes('1/2N'));
});

test('latexToReadableCandidates keeps two-letter indexed concepts whole', () => {
  const candidates = latexToReadableCandidates('NI_{TG}');
  assert.ok(candidates.includes('NI_TG'));
  assert.ok(candidates.includes('NITG'));
});
