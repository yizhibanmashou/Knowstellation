import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildNarrativeBridge,
  buildStoryStepAnswer,
  buildStoryStepQuestion,
  buildStoryStepReadCue,
  buildStorylineNextStepText,
  buildStorylineRoleText,
  buildStorylineTransitionText,
} from '../src/utils/storylineLearningCopy.ts';
import type { StorylineStep } from '../src/types/formula.ts';

const alleleSteps: StorylineStep[] = [
  { formula_id: 'formula_2.8', title: 'Formula 2.8', transition_en: '', transition_zh: '', support_formula_ids: [] },
  { formula_id: 'formula_2.12', title: 'Formula 2.12', transition_en: '', transition_zh: '', support_formula_ids: [] },
  { formula_id: 'formula_2.14a', title: 'Formula 2.14a', transition_en: '', transition_zh: '', support_formula_ids: [] },
  { formula_id: 'formula_2.15', title: 'Formula 2.15', transition_en: '', transition_zh: '', support_formula_ids: [] },
  { formula_id: 'formula_5.6e', title: 'Formula 5.6e', transition_en: '', transition_zh: '', support_formula_ids: [] },
  { formula_id: 'formula_6.15b', title: 'Formula 6.15b', transition_en: '', transition_zh: '', support_formula_ids: [] },
];

test('curated storyline cards read as learner-facing prompts instead of data dumps', () => {
  const step = alleleSteps[0];

  assert.match(buildStoryStepQuestion('allele-frequency', step), /落到哪里/);
  assert.match(buildStoryStepAnswer('allele-frequency', step), /路线图/);
  assert.match(buildStoryStepReadCue('allele-frequency', step), /第一眼/);
  assert.doesNotMatch(buildStoryStepAnswer('allele-frequency', step), /probability density|diffusion theory|context/i);
});

test('curated storyline narrative is continuous and formula-grounded', () => {
  const selected = alleleSteps[1];
  const role = buildStorylineRoleText({
    storylineId: 'allele-frequency',
    steps: alleleSteps,
    selected,
    symbol: 'p',
  });
  const transition = buildStorylineTransitionText({
    storylineId: 'allele-frequency',
    steps: alleleSteps,
    selected,
    symbol: 'p',
  });
  const next = buildStorylineNextStepText({
    storylineId: 'allele-frequency',
    steps: alleleSteps,
    selected,
    symbol: 'p',
  });
  const bridge = buildNarrativeBridge(transition, next);

  assert.match(role, /前一站给了 p 的概率地图/);
  assert.match(bridge, /上一站让我们看见 p 会走向哪里/);
  assert.match(bridge, /Formula 2\.14a/);
  assert.doesNotMatch(bridge, /符号外形|new job|visual identity|模板/);
});
