import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitRichMathText } from '../src/utils/richMathText.ts';

test('splitRichMathText renders ASCII coefficient ratios with scripted variables', () => {
  const parts = splitRichMathText('Formula simplifies to 2N_e/t, while chapter_id stays plain.');

  assert.deepEqual(parts, [
    { type: 'text', value: 'Formula simplifies to ' },
    { type: 'math', value: '2N_{e}/t', raw: '2N_e/t', implicit: true },
    { type: 'text', value: ', while chapter_id stays plain.' },
  ]);
});

test('splitRichMathText renders whole-book learner copy symbols without raw underscores', () => {
  const parts = splitRichMathText('AIC_c, DCMS_i, rEHH_i, iHS_A / iHS_D, cdf_U and NI_TG stay readable.');

  assert.deepEqual(parts, [
    { type: 'math', value: '\\mathrm{AIC}_{c}', raw: 'AIC_c', implicit: true },
    { type: 'text', value: ', ' },
    { type: 'math', value: '\\mathrm{DCMS}_{i}', raw: 'DCMS_i', implicit: true },
    { type: 'text', value: ', ' },
    { type: 'math', value: '\\mathrm{rEHH}_{i}', raw: 'rEHH_i', implicit: true },
    { type: 'text', value: ', ' },
    { type: 'math', value: '\\mathrm{iHS}_{A} / \\mathrm{iHS}_{D}', raw: 'iHS_A / iHS_D', implicit: true },
    { type: 'text', value: ', ' },
    { type: 'math', value: '\\mathrm{cdf}_{U}', raw: 'cdf_U', implicit: true },
    { type: 'text', value: ' and ' },
    { type: 'math', value: '\\mathrm{NI}_{TG}', raw: 'NI_TG', implicit: true },
    { type: 'text', value: ' stay readable.' },
  ]);
});

test('splitRichMathText renders generated concept symbol names', () => {
  const parts = splitRichMathText('Alpha_i, Rho^2, Z-bar_j, H-hat_r, Changemu_a and Widetildesigma^2 are visible.');

  assert.deepEqual(parts, [
    { type: 'math', value: '\\alpha_{i}', raw: 'Alpha_i', implicit: true },
    { type: 'text', value: ', ' },
    { type: 'math', value: '\\rho^{2}', raw: 'Rho^2', implicit: true },
    { type: 'text', value: ', ' },
    { type: 'math', value: '\\overline{Z}_{j}', raw: 'Z-bar_j', implicit: true },
    { type: 'text', value: ', ' },
    { type: 'math', value: '\\widehat{H}_{r}', raw: 'H-hat_r', implicit: true },
    { type: 'text', value: ', ' },
    { type: 'math', value: '\\Delta\\mu_{a}', raw: 'Changemu_a', implicit: true },
    { type: 'text', value: ' and ' },
    { type: 'math', value: '\\widetilde{\\sigma}^{2}', raw: 'Widetildesigma^2', implicit: true },
    { type: 'text', value: ' are visible.' },
  ]);
});

test('splitRichMathText renders implicit products and powered groups from prose', () => {
  const parts = splitRichMathText("Use N_{e}s, D_{min}D_{max}, 4N_e\u03bc, (1/2)^t and (p')^2.");

  assert.deepEqual(parts, [
    { type: 'text', value: 'Use ' },
    { type: 'math', value: 'N_{e}s', raw: 'N_{e}s', implicit: true },
    { type: 'text', value: ', ' },
    { type: 'math', value: 'D_{min}D_{max}', raw: 'D_{min}D_{max}', implicit: true },
    { type: 'text', value: ', ' },
    { type: 'math', value: '4N_{e}\\mu', raw: '4N_e\u03bc', implicit: true },
    { type: 'text', value: ', ' },
    { type: 'math', value: '(1/2)^{t}', raw: '(1/2)^t', implicit: true },
    { type: 'text', value: ' and ' },
    { type: 'math', value: "(p')^{2}", raw: "(p')^2", implicit: true },
    { type: 'text', value: '.' },
  ]);
});

test('splitRichMathText merges powered groups after scripted symbols', () => {
  const parts = splitRichMathText('Like \u03c3_Gw(FS)^2 and H_0(0.81)^t in cached hover copy.');

  assert.deepEqual(parts, [
    { type: 'text', value: 'Like ' },
    { type: 'math', value: '\\sigma_{Gw}(FS)^{2}', raw: '\u03c3_Gw(FS)^2', implicit: true },
    { type: 'text', value: ' and ' },
    { type: 'math', value: 'H_{0}(0.81)^{t}', raw: 'H_0(0.81)^t', implicit: true },
    { type: 'text', value: ' in cached hover copy.' },
  ]);
});
