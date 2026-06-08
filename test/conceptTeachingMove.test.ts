import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conceptTeachingMoveFromContext } from '../src/utils/conceptTeachingMove.ts';

test('conceptTeachingMoveFromContext recognizes where-clause symbol definitions', () => {
  const move = conceptTeachingMoveFromContext(
    'where $N_e$ is the effective population size, and t is the divergence time in generations.',
  );

  assert.equal(move?.teaching_move_zh, '用 where 解释符号');
  assert.match(move?.source_sentence || '', /where/);
});

test('conceptTeachingMoveFromContext recognizes corrected measures', () => {
  const move = conceptTeachingMoveFromContext(
    'Anderson et al. suggested that a corrected version of AIC should be used. $$AIC_c=-2\\ln(L)+2k$$ which differs from the standard AIC measure in the addition of the last term.',
  );

  assert.equal(move?.teaching_move_zh, '在已有度量上加入校正项');
});

test('conceptTeachingMoveFromContext recognizes design-specific formulas', () => {
  const move = conceptTeachingMoveFromContext(
    'For this design, the among-family variance is given in Table 21.4, and the response becomes $$R_{pt}=h\\bar{i}\\sigma_A^2/4$$.',
  );

  assert.equal(move?.teaching_move_zh, '针对特定设计给出公式');
});

test('conceptTeachingMoveFromContext recognizes cancellation-based simplification', () => {
  const move = conceptTeachingMoveFromContext(
    'Because the gene-specific mutation rates cancel, under the equilibrium neutral model, the pi/D ratio at all loci should be roughly the same.',
  );

  assert.equal(move?.teaching_move_zh, '通过消去共同项得到简化比值');
});
