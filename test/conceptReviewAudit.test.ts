import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);

test('audit-concept-review queues only risk work and can fail the automatic gate', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-review-audit-'));
  const inputDir = path.join(tempDir, 'input');
  const outputPath = path.join(tempDir, 'concept_review_audit.json');
  await mkdir(inputDir, { recursive: true });
  await writeFile(
    path.join(inputDir, 'chapter_test_symbol_concept_map.json'),
    JSON.stringify({
      chapter_id: 'chapter_test',
      symbol_concepts: [
        concept('formula_1', 'defined', 'S', 'Selection Differential', 0.92, 'unreviewed', []),
        concept('formula_2', 'used', 'w', 'Fitness', 0.61, 'unreviewed', ['needs_review']),
        concept('formula_3', 'used', 'z', 'Trait Value', 0.88, 'ambiguous', ['ambiguous']),
        concept('formula_4', 'defined', 'P', 'Probability', 0.9, 'unreviewed', ['generic_defined_concept_name']),
        concept('formula_6', 'defined', 'Q', 'Probability', 0.9, 'unreviewed', ['llm_rejected']),
        {
          ...concept('formula_5', 'used', 'N', 'Population Size', 0.88, 'edited', []),
          reviewed_by: 'auto_rule_fix',
        },
        {
          ...concept('formula_7', 'used', 'a', 'Additive Genetic Value', 0.88, 'unreviewed', ['auto_canonical_merge']),
          canonical_concept_id: 'concept_formula_7_used',
          canonical_concept_name: 'Additive Genetic Value',
        },
      ],
    }),
    'utf8',
  );
  await writeFile(
    path.join(inputDir, 'concept_merge_candidates.json'),
    JSON.stringify({
      summary: { candidate_groups: 1, candidate_members: 2 },
      chapters: {
        chapter_test: {
          groups: [
            {
              group_id: 'chapter_test_merge_0001',
              member_keys: ['chapter_test::formula_2::used::w'],
              canonical_candidate: { concept_name: 'Fitness' },
            },
            {
              group_id: 'chapter_test_merge_0002',
              member_keys: ['chapter_test::formula_7::used::a'],
              canonical_candidate: {
                concept_id: 'concept_formula_7_used',
                concept_name: 'Additive Genetic Value',
              },
            },
          ],
        },
      },
    }),
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/audit-concept-review.mjs'),
      '--input-dir',
      inputDir,
      '--output',
      outputPath,
    ]);
    const report = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(report.summary.total_entries, 7);
    assert.equal(report.summary.reviewed_entries, 2);
    assert.equal(report.summary.open_review_entries, 6);
    assert.equal(report.summary.high_risk_flagged_entries, 0);
    assert.equal(report.summary.reviewed_by_counts.auto_rule_fix, 1);
    assert.equal(report.completion_gate.passed, false);
    assert.match(report.completion_gate.blockers.join('\n'), /ambiguous or needs_revision/);
    assert.equal(report.human_review_queue.some((item: { formula_id: string }) => item.formula_id === 'formula_1'), false);
    assert.equal(report.human_review_queue.some((item: { formula_id: string }) => item.formula_id === 'formula_4'), false);
    assert.equal(report.human_review_queue.some((item: { formula_id: string }) => item.formula_id === 'formula_6'), false);
    assert.ok(report.human_review_queue.some((item: { review_status: string }) => item.review_status === 'ambiguous'));
    assert.ok(report.auto_fix_queue.some((item: { reasons: string[] }) => item.reasons.includes('low_confidence')));
    assert.ok(report.auto_fix_queue.some((item: { formula_id: string }) => item.formula_id === 'formula_4'));
    assert.ok(report.auto_fix_queue.some((item: { formula_id: string }) => item.formula_id === 'formula_6'));
    assert.ok(report.merge_queue.some((item: { reasons: string[] }) => item.reasons.includes('merge_candidate')));
    assert.equal(report.merge_queue.some((item: { formula_id: string }) => item.formula_id === 'formula_7'), false);

    await assert.rejects(
      execFileAsync(process.execPath, [
        path.resolve('scripts/audit-concept-review.mjs'),
        '--input-dir',
        inputDir,
        '--output',
        outputPath,
        '--fail-on-open',
      ]),
      (error: { code?: number }) => error.code === 1,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function concept(
  formulaId: string,
  role: 'defined' | 'used',
  symbol: string,
  conceptName: string,
  confidence: number,
  reviewStatus: string,
  reviewFlags: string[],
) {
  return {
    chapter_id: 'chapter_test',
    formula_id: formulaId,
    formula_label: formulaId.replace('_', ' '),
    symbol,
    role,
    concept_id: `concept_${formulaId}_${role}`,
    concept_name: conceptName,
    concept_type: 'quantity_concept',
    definition: `${conceptName} definition.`,
    aliases: [],
    evidence: [],
    confidence,
    review_status: reviewStatus,
    review_flags: reviewFlags,
    extraction_model: 'test',
  };
}
