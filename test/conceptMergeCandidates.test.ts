import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);

test('build-concept-merge-candidates groups alias and synonym matches', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-merge-'));
  const inputDir = path.join(tempDir, 'input');
  const outputPath = path.join(tempDir, 'concept_merge_candidates.json');
  await mkdir(inputDir, { recursive: true });
  await writeFile(
    path.join(inputDir, 'chapter_test_symbol_concept_map.json'),
    JSON.stringify({
      chapter_id: 'chapter_test',
      symbol_concepts: [
        concept('formula_1', 'defined', '\\bar{w}', 'Mean Fitness', ['average fitness']),
        concept('formula_2', 'used', 'w', 'Average Fitness', ['mean fitness']),
        concept('formula_3', 'used', 'z', 'Trait Value', []),
      ],
    }),
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/build-concept-merge-candidates.mjs'),
      '--input-dir',
      inputDir,
      '--output',
      outputPath,
    ]);
    const output = JSON.parse(await readFile(outputPath, 'utf8'));
    const groups = output.chapters.chapter_test.groups;
    assert.equal(groups.length, 1);
    assert.deepEqual(
      groups[0].members.map((member: { concept_name: string }) => member.concept_name).sort(),
      ['Average Fitness', 'Mean Fitness'],
    );
    assert.ok(groups[0].reasons.some((reason: string) => ['alias_overlap', 'synonym_normalized_name', 'lexical_similarity'].includes(reason)));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function concept(formulaId: string, role: 'defined' | 'used', symbol: string, conceptName: string, aliases: string[]) {
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
    aliases,
    evidence: [],
    confidence: 0.9,
    review_status: 'unreviewed',
    review_flags: [],
    extraction_model: 'test',
  };
}
