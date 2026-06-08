import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compressTextToShortLabel,
  isFocusAnnotationLabel,
  isGenericAnnotationLabel,
  resolveSymbolMeaning,
  resolveSymbolShortLabel,
} from '../src/utils/symbolAnnotation.ts';

test('resolveSymbolShortLabel prefers explicit shortLabel', () => {
  const label = resolveSymbolShortLabel(
    { type: 'variable_definition', symbol: 'N_e', confidence: 0.9 },
    { shortLabel: '有效种群大小', llmText: '有效种群大小决定中性多态性的尺度。' },
  );
  assert.equal(label, '有效种群大小');
});

test('resolveSymbolShortLabel compresses llmText when shortLabel is missing', () => {
  const label = resolveSymbolShortLabel(
    { type: 'variable_definition', symbol: '\\sigma_w^2', confidence: 0.9 },
    { llmText: '家系间适合度方差会放大抽样方差，从而降低有效种群大小。' },
  );
  assert.equal(label, '家系间适合度方差');
});

test('resolveSymbolShortLabel falls back to prerequisite meaning', () => {
  const label = resolveSymbolShortLabel({
    type: 'variable_definition',
    symbol: 'D',
    meaning: '群体间分化量',
    confidence: 0.8,
  });
  assert.equal(label, '群体间分化量');
});

test('resolveSymbolShortLabel keeps compound labels over symbol-specific fallbacks', () => {
  const label = resolveSymbolShortLabel({
    type: 'variable_definition',
    symbol: '\\sigma_{z}^{2}',
    meaning: '分母整体，表示分子所参照的变量、尺度或归一化基准。',
    confidence: 0.76,
    kind: 'compound',
  } as Parameters<typeof resolveSymbolShortLabel>[0]);

  assert.equal(label, '分母整体');
});

test('resolveSymbolShortLabel keeps MK polymorphism symbols concise', () => {
  const label = resolveSymbolShortLabel({
    type: 'variable_definition',
    symbol: 'P_{s}',
    meaning: 'P_s 表示沉默位点多态性；先用这个短标签定位它在本式中的角色。',
    confidence: 0.82,
  });

  assert.equal(label, '沉默位点多态性');
});

test('resolveSymbolShortLabel keeps fallback labels while LLM is loading or failed', () => {
  const prereq = {
    type: 'variable_definition' as const,
    symbol: 'N_e',
    meaning: '有效种群大小',
    confidence: 0.9,
  };
  assert.equal(resolveSymbolShortLabel({ ...prereq, llmStatus: 'loading' }), '有效种群大小');
  assert.equal(resolveSymbolShortLabel({ ...prereq, llmStatus: 'error' }), '有效种群大小');
});

test('resolveSymbolShortLabel rejects wealth mistranslation for W-bar fitness', () => {
  const label = resolveSymbolShortLabel(
    {
      type: 'variable_definition',
      symbol: '\\overline{W}',
      meaning: 'W 的横线表示群体平均适合度；它把各基因型或类别的适合度按频率加权成总体平均。',
      confidence: 0.9,
    },
    { shortLabel: '平均财富', llmText: '平均财富表示总体财富水平。' },
  );

  assert.equal(label, '平均适合度');
});

test('resolveSymbolShortLabel keeps local domain labels over risky LLM labels', () => {
  assert.equal(
    resolveSymbolShortLabel(
      {
        type: 'variable_definition',
        symbol: '\\overline{z}',
        meaning: 'average trait value over all descendants',
        confidence: 0.9,
      },
      { shortLabel: '平均身高', llmText: 'average height in the population' },
    ),
    '平均性状值',
  );

  assert.equal(
    resolveSymbolShortLabel(
      {
        type: 'variable_definition',
        symbol: '\\mu_i',
        meaning: 'mutation rate at locus i',
        confidence: 0.9,
      },
      { shortLabel: '微米 i', llmText: 'micrometer indexed by i' },
    ),
    '第 i 位点突变率',
  );

  assert.equal(
    resolveSymbolShortLabel(
      {
        type: 'variable_definition',
        symbol: 'R_z',
        meaning: 'response of trait z to selection',
        confidence: 0.9,
      },
      { shortLabel: 'z 响应' },
    ),
    'z 的选择响应',
  );

  assert.equal(
    resolveSymbolShortLabel(
      {
        type: 'variable_definition',
        symbol: '\\sigma_{z}',
        meaning: 'sigma_z 表示表型标准差，是本式中衡量变异尺度的量。',
        confidence: 0.9,
      },
      { shortLabel: 'sigma_z 表示表型标准差' },
    ),
    '表型标准差',
  );

  assert.equal(
    resolveSymbolShortLabel(
      {
        type: 'variable_definition',
        symbol: 'q_{i}^{\\prime}',
        meaning: 'descendant category frequency used to average trait values',
        confidence: 0.9,
      },
      { shortLabel: "q_i prime" },
    ),
    '第 i 类后代频率',
  );
});

test('resolveSymbolMeaning keeps local domain explanations over generic LLM text', () => {
  const meaning = resolveSymbolMeaning(
    {
      type: 'variable_definition',
      symbol: '\\mu_i',
      meaning: 'mu_i 表示第 i 位点突变率，决定该位点引入新变异的速率。',
      confidence: 0.9,
    },
    { llmText: 'μ_i 表示第 i 个变量的平均值。' },
  );

  assert.match(meaning, /突变率/);
  assert.doesNotMatch(meaning, /平均值/);
});

test('resolveSymbolMeaning keeps compound whole-part explanations over LLM text', () => {
  const meaning = resolveSymbolMeaning(
    {
      type: 'variable_definition',
      symbol: 'd_s',
      target: '\\frac{d_s}{}',
      meaning: '分子整体，表示被分母尺度归一化或比较的变化量、权重或组合项。',
      confidence: 0.76,
      kind: 'compound',
    } as Parameters<typeof resolveSymbolMeaning>[0],
    { llmText: 'd_s 表示沉默位点分化。' },
  );

  assert.match(meaning, /分子整体/);
  assert.doesNotMatch(meaning, /沉默位点分化/);
});

test('isFocusAnnotationLabel rejects generic placeholder copy', () => {
  assert.equal(isFocusAnnotationLabel('有效种群大小'), true);
  assert.equal(isFocusAnnotationLabel('是这个公式直接使用的符号'), false);
  assert.equal(isFocusAnnotationLabel('当前公式中的关键符号'), false);
});

test('compressTextToShortLabel keeps short phrases intact', () => {
  assert.equal(compressTextToShortLabel('实际繁殖个体数'), '实际繁殖个体数');
});

test('isGenericAnnotationLabel detects template-like labels', () => {
  assert.equal(isGenericAnnotationLabel('关键符号'), true);
  assert.equal(isGenericAnnotationLabel('选择梯度'), false);
});

test('isGenericAnnotationLabel rejects ASCII math symbols as labels', () => {
  assert.equal(isGenericAnnotationLabel('sigma_AA^2'), true);
  assert.equal(isGenericAnnotationLabel('q_i'), true);
  assert.equal(isGenericAnnotationLabel('加性遗传方差'), false);
});

test('resolveSymbolShortLabel falls back from ASCII label to epistatic variance meaning', () => {
  const label = resolveSymbolShortLabel(
    {
      type: 'variable_definition',
      symbol: '\\sigma_{AA}^{2}',
      meaning: 'additive-by-additive epistatic variance',
      confidence: 0.9,
    },
    { shortLabel: 'sigma_AA^2' },
  );
  assert.equal(label, '加性×加性方差');
});
