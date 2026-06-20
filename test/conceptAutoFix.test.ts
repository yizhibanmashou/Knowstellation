import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);

test('auto-fix-concept-review applies deterministic fixes and queues uncertain work', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-auto-fix-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  await mkdir(inputDir, { recursive: true });
  await writeFile(
    path.join(inputDir, 'chapter2_symbol_concept_map.json'),
    JSON.stringify({
      chapter_id: 'chapter2',
      symbol_concepts: [
        concept('formula_1', 'used', 'H_{0}', 'H Sub 0', [
          'weak_evidence',
          'template_definition',
          'formula_or_symbol_artifact',
        ], 'chapter2'),
        concept('formula_2', 'defined', 't', 'Time', [
          'weak_evidence',
          'formula_or_symbol_artifact',
          'index_like_defined_symbol',
        ], 'chapter2'),
        concept('formula_3', 'defined', 'P', 'Probability', [
          'generic_defined_concept_name',
        ], 'chapter2'),
        concept('formula_5', 'used', 'e', 'E', [
          'low_confidence',
          'weak_evidence',
          'template_definition',
          'formula_or_symbol_artifact',
        ], 'chapter2'),
        concept('formula_6', 'used', '\\sigma_{A}^{2}', 'Additive Genetic Variance', [
          'weak_evidence',
          'template_definition',
        ], 'chapter2'),
        concept('formula_7', 'used', '\\sigma_{z}^{2}', 'Trait Variance', [
          'weak_evidence',
          'template_definition',
        ], 'chapter2'),
        concept('formula_8', 'used', 'y', 'Response Variable', [
          'weak_evidence',
          'template_definition',
        ], 'chapter2'),
        concept('formula_9', 'used', '\\rho', 'Correlation', [
          'weak_evidence',
          'template_definition',
        ], 'chapter2'),
        concept('formula_10', 'used', '\\sigma^{2}(A_{d})', 'Sigma Power 2(a Sub D)', [
          'weak_evidence',
          'template_definition',
          'formula_or_symbol_artifact',
        ], 'chapter2'),
        concept('formula_11', 'used', '\\sigma^{2}(A_{s})', 'Sigma Power 2(a Sub S)', [
          'weak_evidence',
          'template_definition',
          'formula_or_symbol_artifact',
        ], 'chapter2'),
        concept('formula_12', 'used', '\\sigma^{2}(A_{T})', 'Sigma Power 2(a Sub T)', [
          'weak_evidence',
          'template_definition',
          'formula_or_symbol_artifact',
        ], 'chapter2'),
        concept('formula_13', 'used', '\\sigma^{2}(e)', 'Sigma Power 2(e)', [
          'weak_evidence',
          'template_definition',
          'formula_or_symbol_artifact',
        ], 'chapter2'),
        concept('formula_14', 'used', '\\sigma_{A}^{2}(t)', 'Sigma Sub a Power 2(t)', [
          'weak_evidence',
          'template_definition',
        ], 'chapter2'),
        concept('formula_15', 'used', 't+1', 'T+1', [
          'weak_evidence',
          'template_definition',
        ], 'chapter2'),
        concept('formula_16', 'used', 'x-\\delta_{x}', 'X-delta Sub X', [
          'weak_evidence',
          'template_definition',
          'formula_or_symbol_artifact',
        ], 'chapter2'),
        concept('formula_17', 'used', 'j\\rightarrow i', 'Jrightarrow I', [
          'weak_evidence',
          'template_definition',
        ], 'chapter2'),
        concept('formula_18', 'used', 'F_{ST}', 'F Sub St', [
          'low_confidence',
          'weak_evidence',
          'template_definition',
          'formula_or_symbol_artifact',
        ], 'chapter2'),
        concept('formula_19', 'defined', '\\Pr', 'Probability', [
          'weak_evidence',
          'generic_defined_concept_name',
        ], 'chapter2'),
        concept('formula_20', 'used', '\\infty', 'Infty', [
          'low_confidence',
          'weak_evidence',
          'template_definition',
        ], 'chapter2'),
        concept('formula_21', 'used', '\\operatorname', 'Operatorname', [
          'low_confidence',
          'weak_evidence',
          'template_definition',
        ], 'chapter2'),
        concept('formula_22', 'used', '\\bar{\\imath}', 'Imath-bar', [
          'low_confidence',
          'weak_evidence',
          'template_definition',
        ], 'chapter2'),
        concept('formula_23', 'defined', '\\sigma^{2}', 'Variance', [
          'weak_evidence',
          'generic_defined_concept_name',
        ], 'chapter2'),
        concept('formula_24', 'defined', '\\phi', 'Probability Density', [
          'weak_evidence',
          'generic_defined_concept_name',
        ], 'chapter2'),
        concept('formula_25', 'defined', '\\sigma_{n}^{2}', 'Variance', [
          'weak_evidence',
          'generic_defined_concept_name',
        ], 'chapter2'),
        concept('formula_26', 'defined', '\\sigma\\Bigg', 'Sigmabigg', [
          'weak_evidence',
          'template_definition',
        ], 'chapter2'),
        concept('formula_27', 'used', 'd_{(i', 'D_(i', [
          'weak_evidence',
          'template_definition',
        ], 'chapter2'),
        concept('formula_28', 'used', '\\Delta', 'Change', [
          'weak_evidence',
          'template_definition',
        ], 'chapter2'),
        concept('formula_29', 'defined', 'B', 'Benefit', [
          'weak_evidence',
          'template_definition',
        ], 'chapter2'),
        concept('formula_30', 'used', '\\theta', 'Theta', [
          'weak_evidence',
          'template_definition',
        ], 'chapter2'),
        concept('formula_31', 'used', '\\bar{\\imath}_{t}', 'Imath-bar Sub T', [
          'low_confidence',
          'weak_evidence',
          'template_definition',
        ], 'chapter2'),
        concept('formula_32', 'defined', 'm', 'Mean', [
          'weak_evidence',
        ], 'chapter2'),
        {
          ...concept('formula_4', 'used', 'f_{t}', 'Inbreeding Coefficient', [
            'weak_evidence',
            'template_definition',
          ], 'chapter2'),
          definition: 'Inbreeding Coefficient controls the strength, direction, or scaling of the relationship.',
          definition_zh: 'Inbreeding Coefficient 是调节关系强弱或方向的参数，用来判断右侧条件如何影响目标量。',
        },
        {
          ...concept('formula_2.42', 'used', '\\sigma^{2}(p)', 'Sigma Power 2(p)', [
            'weak_evidence',
            'template_definition',
            'formula_or_symbol_artifact',
          ], 'chapter2'),
          formula_label: 'Formula 2.42',
          definition: 'Total metapopulation is just.',
          definition_zh: 'Sigma Power 2(p) 描述变量之间的离散程度或共同变化，用来判断变化有多宽、是否一起移动。',
        },
      ],
    }),
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/auto-fix-concept-review.mjs'),
      '--chapter',
      'chapter2',
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
    ]);

    const patch = JSON.parse(await readFile(path.join(outputDir, 'chapter2_auto_fix_patch.json'), 'utf8'));
    const h0 = patch.entries.find((entry: { symbol: string }) => entry.symbol === 'H_{0}');
    assert.equal(h0.concept_name, 'Baseline Heterozygosity');
    assert.equal(h0.review_status, 'edited');
    assert.deepEqual(h0.review_flags, ['weak_evidence']);

    const index = patch.entries.find((entry: { symbol: string }) => entry.symbol === 't');
    assert.equal(index.review_status, 'rejected');
    assert.match(index.review_notes, /index-like variable/);

    const inbreeding = patch.entries.find((entry: { symbol: string }) => entry.symbol === 'f_{t}');
    assert.equal(inbreeding.concept_name, 'Inbreeding Coefficient');
    assert.equal(inbreeding.definition, 'The probability that two alleles at a locus are identical by descent.');
    assert.equal(inbreeding.definition_zh, '近交系数表示一个位点上的两个等位基因同源同祖的概率。');
    assert.deepEqual(inbreeding.review_flags, []);

    const fstVariance = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_2.42' && entry.symbol === '\\sigma^{2}(p)'
    );
    assert.equal(fstVariance.concept_name, 'Among-Deme Allele-Frequency Variance');
    assert.equal(fstVariance.review_status, 'edited');
    assert.deepEqual(fstVariance.review_flags, []);

    const eArtifact = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_5' && entry.symbol === 'e'
    );
    assert.equal(eArtifact.review_status, 'rejected');
    assert.match(eArtifact.review_notes, /bare mathematical constant or text fragment/);

    const additiveVariance = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_6' && entry.symbol === '\\sigma_{A}^{2}'
    );
    assert.equal(additiveVariance.concept_name, 'Additive Genetic Variance');
    assert.match(additiveVariance.definition, /additive genetic effects/);
    assert.deepEqual(additiveVariance.review_flags, []);

    const traitVariance = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_7' && entry.symbol === '\\sigma_{z}^{2}'
    );
    assert.equal(traitVariance.concept_name, 'Trait Variance');
    assert.match(traitVariance.definition, /total variance of the trait value/);
    assert.deepEqual(traitVariance.review_flags, []);

    const responseVariable = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_8' && entry.symbol === 'y'
    );
    assert.equal(responseVariable.concept_name, 'Response Variable');
    assert.match(responseVariable.definition, /modeled output or observed quantity/);
    assert.deepEqual(responseVariable.review_flags, []);

    const correlation = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_9' && entry.symbol === '\\rho'
    );
    assert.equal(correlation.concept_name, 'Correlation');
    assert.match(correlation.definition, /strength and direction of association/);
    assert.deepEqual(correlation.review_flags, []);

    const directAdditiveVariance = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_10' && entry.symbol === '\\sigma^{2}(A_{d})'
    );
    assert.equal(directAdditiveVariance.concept_name, 'Direct Additive Genetic Variance');
    assert.match(directAdditiveVariance.definition, /direct genetic effects/);
    assert.deepEqual(directAdditiveVariance.review_flags, ['weak_evidence']);

    const associativeAdditiveVariance = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_11' && entry.symbol === '\\sigma^{2}(A_{s})'
    );
    assert.equal(associativeAdditiveVariance.concept_name, 'Associative Additive Genetic Variance');
    assert.match(associativeAdditiveVariance.definition, /associative genetic effects/);
    assert.deepEqual(associativeAdditiveVariance.review_flags, ['weak_evidence']);

    const totalBreedingValueVariance = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_12' && entry.symbol === '\\sigma^{2}(A_{T})'
    );
    assert.equal(totalBreedingValueVariance.concept_name, 'Total Breeding Value Variance');
    assert.match(totalBreedingValueVariance.definition, /total breeding values/);
    assert.deepEqual(totalBreedingValueVariance.review_flags, ['weak_evidence']);

    const environmentalVariance = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_13' && entry.symbol === '\\sigma^{2}(e)'
    );
    assert.equal(environmentalVariance.concept_name, 'Environmental Variance');
    assert.match(environmentalVariance.definition, /environmental or residual effects/);
    assert.deepEqual(environmentalVariance.review_flags, ['weak_evidence']);

    const timeIndexedAdditiveVariance = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_14' && entry.symbol === '\\sigma_{A}^{2}(t)'
    );
    assert.equal(timeIndexedAdditiveVariance.concept_name, 'Additive Genetic Variance');
    assert.match(timeIndexedAdditiveVariance.definition, /additive genetic effects/);
    assert.deepEqual(timeIndexedAdditiveVariance.review_flags, ['weak_evidence']);

    const nextTimeFragment = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_15' && entry.symbol === 't+1'
    );
    assert.equal(nextTimeFragment.review_status, 'rejected');
    assert.match(nextTimeFragment.review_notes, /expression fragment/);

    const deltaFragment = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_16' && entry.symbol === 'x-\\delta_{x}'
    );
    assert.equal(deltaFragment.review_status, 'rejected');
    assert.match(deltaFragment.review_notes, /expression fragment/);

    const transitionFragment = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_17' && entry.symbol === 'j\\rightarrow i'
    );
    assert.equal(transitionFragment.review_status, 'rejected');
    assert.match(transitionFragment.review_notes, /expression fragment/);

    const fixationIndex = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_18' && entry.symbol === 'F_{ST}'
    );
    assert.equal(fixationIndex.concept_name, 'Fixation Index');
    assert.match(fixationIndex.definition, /population differentiation/);
    assert.deepEqual(fixationIndex.review_flags, ['weak_evidence']);

    const probabilityOperator = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_19' && entry.symbol === '\\Pr'
    );
    assert.equal(probabilityOperator.review_status, 'rejected');
    assert.match(probabilityOperator.review_notes, /mathematical operator or constant token/);

    const infinityToken = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_20' && entry.symbol === '\\infty'
    );
    assert.equal(infinityToken.review_status, 'rejected');
    assert.match(infinityToken.review_notes, /mathematical operator or constant token/);

    const operatornameToken = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_21' && entry.symbol === '\\operatorname'
    );
    assert.equal(operatornameToken.review_status, 'rejected');
    assert.match(operatornameToken.review_notes, /mathematical operator or constant token/);

    const selectionIntensity = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_22' && entry.symbol === '\\bar{\\imath}'
    );
    assert.equal(selectionIntensity.concept_name, 'Selection Intensity');
    assert.match(selectionIntensity.definition, /standardized selection differential/);
    assert.deepEqual(selectionIntensity.review_flags, ['weak_evidence']);

    const genericVariance = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_23' && entry.symbol === '\\sigma^{2}'
    );
    assert.equal(genericVariance.concept_name, 'Variance');
    assert.match(genericVariance.definition, /spread around the mean/);
    assert.deepEqual(genericVariance.review_flags, ['weak_evidence']);

    const probabilityDensity = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_24' && entry.symbol === '\\phi'
    );
    assert.equal(probabilityDensity.concept_name, 'Probability Density');
    assert.match(probabilityDensity.definition, /integral gives probability/);
    assert.deepEqual(probabilityDensity.review_flags, []);

    const subscriptedVariance = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_25' && entry.symbol === '\\sigma_{n}^{2}'
    );
    assert.equal(subscriptedVariance.concept_name, 'Variance');
    assert.match(subscriptedVariance.definition, /spread around the mean/);
    assert.deepEqual(subscriptedVariance.review_flags, []);

    const sigmaSizingFragment = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_26' && entry.symbol === '\\sigma\\Bigg'
    );
    assert.equal(sigmaSizingFragment.review_status, 'rejected');
    assert.match(sigmaSizingFragment.review_notes, /malformed LaTeX fragment/);

    const unbalancedFragment = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_27' && entry.symbol === 'd_{(i'
    );
    assert.equal(unbalancedFragment.review_status, 'rejected');
    assert.match(unbalancedFragment.review_notes, /malformed LaTeX fragment/);

    const changeOperator = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_28' && entry.symbol === '\\Delta'
    );
    assert.equal(changeOperator.review_status, 'rejected');
    assert.match(changeOperator.review_notes, /mathematical operator or constant token/);

    const benefit = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_29' && entry.symbol === 'B'
    );
    assert.equal(benefit.concept_name, 'Benefit');
    assert.match(benefit.definition, /positive effect or payoff/);
    assert.deepEqual(benefit.review_flags, []);

    const theta = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_30' && entry.symbol === '\\theta'
    );
    assert.equal(theta.concept_name, 'Theta');
    assert.match(theta.definition, /conventionally denoted theta/);
    assert.deepEqual(theta.review_flags, []);

    const indexedSelectionIntensity = patch.entries.find((entry: { formula_id: string; symbol: string }) =>
      entry.formula_id === 'formula_31' && entry.symbol === '\\bar{\\imath}_{t}'
    );
    assert.equal(indexedSelectionIntensity.concept_name, 'Selection Intensity');
    assert.match(indexedSelectionIntensity.definition, /standardized selection differential/);
    assert.deepEqual(indexedSelectionIntensity.review_flags, ['weak_evidence']);

    assert.equal(
      patch.entries.some((entry: { formula_id: string; symbol: string }) =>
        entry.formula_id === 'formula_32' && entry.symbol === 'm'
      ),
      false,
    );

    const humanQueue = JSON.parse(await readFile(path.join(outputDir, 'chapter2_human_review_queue.json'), 'utf8'));
    assert.equal(humanQueue.entries.some((entry: { symbol: string }) => entry.symbol === 'P'), false);

    const llmQueue = await readFile(path.join(outputDir, 'chapter2_llm_queue.jsonl'), 'utf8');
    const llmTasks = llmQueue
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const queuedProbability = llmTasks.find((entry) => entry.task_id === 'chapter2::formula_3::defined::P');
    assert.equal(queuedProbability.input.formula_latex, 'P = x');
    assert.equal(queuedProbability.input.formula_section, 'Test Section');
    assert.equal(queuedProbability.input.formula_subsection, 'Test Subsection');
    assert.match(llmQueue, /chapter2::formula_3::defined::P/);
    assert.doesNotMatch(llmQueue, /Inbreeding Coefficient/);
    assert.doesNotMatch(llmQueue, /Total metapopulation/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_5::used::e/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_6::used::\\sigma_\{A\}\^\{2\}/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_7::used::\\sigma_\{z\}\^\{2\}/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_8::used::y/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_9::used::\\rho/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_10::used::\\sigma\^\{2\}\(A_\{d\}\)/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_11::used::\\sigma\^\{2\}\(A_\{s\}\)/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_12::used::\\sigma\^\{2\}\(A_\{T\}\)/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_13::used::\\sigma\^\{2\}\(e\)/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_14::used::\\sigma_\{A\}\^\{2\}\(t\)/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_15::used::t\+1/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_16::used::x-\\delta_\{x\}/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_17::used::j\\rightarrow i/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_18::used::F_\{ST\}/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_19::defined::\\Pr/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_20::used::\\infty/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_21::used::\\operatorname/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_22::used::\\bar\{\\imath\}/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_23::defined::\\sigma\^\{2\}/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_24::defined::\\phi/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_25::defined::\\sigma_\{n\}\^\{2\}/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_26::defined::\\sigma\\Bigg/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_27::used::d_\{\(i/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_28::used::\\Delta/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_29::defined::B/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_30::used::\\theta/);
    assert.doesNotMatch(llmQueue, /chapter2::formula_31::used::\\bar\{\\imath\}_\{t\}/);
    assert.match(llmQueue, /chapter2::formula_32::defined::m/);
    assert.match(llmQueue, /unsafe_public_concept_name/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('auto-fix-concept-review validates LLM results before applying them', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-llm-import-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  const resultPath = path.join(tempDir, 'llm-results.jsonl');
  await mkdir(inputDir, { recursive: true });
  await writeFile(
    path.join(inputDir, 'chapter_test_symbol_concept_map.json'),
    JSON.stringify({
      chapter_id: 'chapter_test',
      symbol_concepts: [
        concept('formula_1', 'defined', 'P', 'Probability', ['generic_defined_concept_name']),
        concept('formula_2', 'defined', 'X', 'X', ['formula_or_symbol_artifact']),
        concept('formula_3', 'defined', 'Y', 'Y', ['formula_or_symbol_artifact']),
        concept('formula_4', 'used', 'f_0', 'F_0', ['formula_or_symbol_artifact']),
        concept('formula_5', 'defined', 'x^{a}', 'Variable', ['generic_defined_concept_name']),
        concept('formula_6', 'defined', 'h', 'Measure', ['generic_defined_concept_name']),
        concept('formula_7', 'defined', 'f_s', 'Function', ['generic_defined_concept_name']),
        concept('formula_8', 'defined', '\\mu', 'Mean', ['generic_defined_concept_name']),
        concept('formula_9', 'defined', 'i', 'Index', ['generic_defined_concept_name']),
      ],
    }),
    'utf8',
  );
  await writeFile(
    resultPath,
    [
      JSON.stringify({
        stable_key: 'chapter_test::formula_1::defined::P',
        formula_id: 'formula_1',
        symbol: 'P',
        role: 'defined',
        concept_name: 'Allele-Frequency Transition Probability',
        concept_type: 'quantity_concept',
        definition: 'The probability assigned to a transition between allele-frequency states.',
        definition_zh: '等位基因频率状态之间发生转移的概率。',
        confidence: 0.86,
        review_status: 'edited',
        review_flags: [],
        review_notes: 'LLM repaired the generic probability label.',
      }),
      JSON.stringify({
        stable_key: 'chapter_test::formula_2::defined::X',
        formula_id: 'formula_2',
        symbol: 'X',
        role: 'defined',
        concept_name: 'X',
        concept_type: 'quantity_concept',
        definition: '',
        confidence: 0.91,
        review_status: 'edited',
      }),
      JSON.stringify({
        stable_key: 'chapter_test::formula_3::defined::Y',
        formula_id: 'formula_3',
        symbol: 'Y',
        role: 'defined',
        concept_name: 'Y',
        concept_type: 'quantity_concept',
        definition: '',
        confidence: 0.91,
        review_status: 'edited',
        retry_attempt: 2,
      }),
      JSON.stringify({
        stable_key: 'chapter_test::formula_4::used::f_0',
        formula_id: 'formula_4',
        symbol: 'f_0',
        role: 'used',
        concept_name: 'f_0',
        concept_type: 'quantity_concept',
        definition: 'The inbreeding coefficient assigned to the base population.',
        confidence: 0.91,
        review_status: 'edited',
      }),
      JSON.stringify({
        stable_key: 'chapter_test::formula_5::defined::x^{a}',
        formula_id: 'formula_5',
        symbol: 'x^{a}',
        role: 'defined',
        concept_name: 'Variable x^a',
        concept_type: 'quantity_concept',
        definition: 'A variable raised to a power, representing a quantity that can vary.',
        confidence: 0.91,
        review_status: 'edited',
      }),
      JSON.stringify({
        stable_key: 'chapter_test::formula_6::defined::h',
        formula_id: 'formula_6',
        symbol: 'h',
        role: 'defined',
        concept_name: 'Dispersion measure (information)',
        concept_type: 'quantity_concept',
        definition: 'A general measure of dispersion or information in the data.',
        confidence: 0.91,
        review_status: 'edited',
      }),
      JSON.stringify({
        stable_key: 'chapter_test::formula_7::defined::f_s',
        formula_id: 'formula_7',
        symbol: 'f_s',
        role: 'defined',
        concept_name: 'Fraction of initial association persisting',
        concept_type: 'quantity_concept',
        definition: 'The fraction of the initial association, ¦Ä_q(0), that persists after selection and recombination.',
        confidence: 0.91,
        review_status: 'edited',
      }),
      JSON.stringify({
        stable_key: 'chapter_test::formula_8::defined::\\mu',
        formula_id: 'formula_8',
        symbol: '\\mu',
        role: 'defined',
        concept_name: 'Mean of z',
        concept_type: 'quantity_concept',
        definition: 'The expected value or average of the random variable z.',
        confidence: 0.91,
        review_status: 'edited',
      }),
      JSON.stringify({
        stable_key: 'chapter_test::formula_9::defined::i',
        formula_id: 'formula_9',
        symbol: 'i',
        role: 'defined',
        concept_name: 'Index',
        concept_type: 'domain_concept',
        definition: 'A position marker used to identify a class, state, or summation term.',
        confidence: 0.82,
        review_status: 'rejected',
        review_notes: 'The symbol is only an index in the local formula evidence.',
      }),
      JSON.stringify({
        stable_key: 'chapter_test::formula_missing::defined::Z',
        formula_id: 'formula_missing',
        symbol: 'Z',
        role: 'defined',
        concept_name: 'Missing Stable Key',
        concept_type: 'quantity_concept',
        definition: 'A valid-looking repair for an unknown stable key.',
        confidence: 0.91,
        review_status: 'edited',
      }),
    ].join('\n') + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/auto-fix-concept-review.mjs'),
      'import-llm-results',
      '--chapter',
      'chapter_test',
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--input',
      resultPath,
      '--apply',
    ]);

    const patch = JSON.parse(await readFile(path.join(outputDir, 'chapter_test_llm_import_patch.json'), 'utf8'));
    assert.equal(patch.entries.length, 2);
    assert.equal(patch.entries[0].reviewed_by, 'auto_llm_fix');
    assert.equal(patch.entries[0].review_status, 'edited');
    assert.deepEqual(patch.entries[0].review_flags, ['llm_validated']);
    const rejectedPatch = patch.entries.find((entry: { stable_key: string }) => entry.stable_key === 'chapter_test::formula_9::defined::i');
    assert.equal(rejectedPatch.reviewed_by, 'auto_llm_fix');
    assert.equal(rejectedPatch.review_status, 'rejected');

    const rejected = JSON.parse(await readFile(path.join(outputDir, 'chapter_test_llm_rejected_queue.json'), 'utf8'));
    assert.equal(rejected.entries.length, 8);
    const retryRejected = rejected.entries.find((entry: { stable_key: string }) => entry.stable_key === 'chapter_test::formula_2::defined::X');
    const exhaustedRejected = rejected.entries.find((entry: { stable_key: string }) => entry.stable_key === 'chapter_test::formula_3::defined::Y');
    const rawSymbolRejected = rejected.entries.find((entry: { stable_key: string }) => entry.stable_key === 'chapter_test::formula_4::used::f_0');
    const genericWrapperRejected = rejected.entries.find((entry: { stable_key: string }) => entry.stable_key === 'chapter_test::formula_5::defined::x^{a}');
    const weakMeasureRejected = rejected.entries.find((entry: { stable_key: string }) => entry.stable_key === 'chapter_test::formula_6::defined::h');
    const encodingRejected = rejected.entries.find((entry: { stable_key: string }) => entry.stable_key === 'chapter_test::formula_7::defined::f_s');
    const bareMeanRejected = rejected.entries.find((entry: { stable_key: string }) => entry.stable_key === 'chapter_test::formula_8::defined::\\mu');
    const humanRejected = rejected.entries.find((entry: { stable_key: string }) => entry.stable_key === 'chapter_test::formula_missing::defined::Z');
    assert.ok(retryRejected.reasons.includes('missing_definition'));
    assert.equal(retryRejected.resolution, 'retry');
    assert.ok(retryRejected.retry_record);
    assert.equal(retryRejected.retry_record.input.retry_attempt, 1);
    assert.ok(exhaustedRejected.reasons.includes('missing_definition'));
    assert.equal(exhaustedRejected.retry_attempt, 2);
    assert.equal(exhaustedRejected.resolution, 'human_review');
    assert.equal(exhaustedRejected.retry_record, null);
    assert.ok(rawSymbolRejected.reasons.includes('raw_symbol_concept_name'));
    assert.equal(rawSymbolRejected.resolution, 'retry');
    assert.ok(genericWrapperRejected.reasons.includes('raw_symbol_concept_name'));
    assert.equal(genericWrapperRejected.resolution, 'retry');
    assert.ok(weakMeasureRejected.reasons.includes('template_or_weak_definition'));
    assert.equal(weakMeasureRejected.resolution, 'retry');
    assert.ok(encodingRejected.reasons.includes('encoding_artifact'));
    assert.equal(encodingRejected.resolution, 'retry');
    assert.ok(bareMeanRejected.reasons.includes('raw_symbol_concept_name'));
    assert.equal(bareMeanRejected.resolution, 'retry');
    assert.equal(humanRejected.resolution, 'human_review');
    assert.ok(humanRejected.reasons.includes('unknown_stable_key'));

    const retryQueue = (await readFile(path.join(outputDir, 'chapter_test_llm_retry_queue.jsonl'), 'utf8'))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(retryQueue.length, 6);
    const retryByTask = new Map(retryQueue.map((entry) => [entry.task_id, entry]));
    assert.ok(retryByTask.get('chapter_test::formula_2::defined::X').input.auto_fix_reasons.includes('llm_rejected'));
    assert.equal(retryByTask.get('chapter_test::formula_2::defined::X').input.proposed_rule_patch.rejection_reasons.includes('missing_definition'), true);
    assert.equal(retryByTask.get('chapter_test::formula_4::used::f_0').input.proposed_rule_patch.rejection_reasons.includes('raw_symbol_concept_name'), true);
    assert.equal(retryByTask.get('chapter_test::formula_5::defined::x^{a}').input.proposed_rule_patch.rejection_reasons.includes('raw_symbol_concept_name'), true);
    assert.equal(retryByTask.get('chapter_test::formula_6::defined::h').input.proposed_rule_patch.rejection_reasons.includes('template_or_weak_definition'), true);
    assert.equal(retryByTask.get('chapter_test::formula_7::defined::f_s').input.proposed_rule_patch.rejection_reasons.includes('encoding_artifact'), true);
    assert.equal(retryByTask.get('chapter_test::formula_8::defined::\\mu').input.proposed_rule_patch.rejection_reasons.includes('raw_symbol_concept_name'), true);

    const humanQueue = JSON.parse(await readFile(path.join(outputDir, 'chapter_test_llm_human_review_queue.json'), 'utf8'));
    assert.equal(humanQueue.entries.length, 2);
    const unknownHuman = humanQueue.entries.find((entry: { stable_key: string }) => entry.stable_key === 'chapter_test::formula_missing::defined::Z');
    const exhaustedHuman = humanQueue.entries.find((entry: { stable_key: string }) => entry.stable_key === 'chapter_test::formula_3::defined::Y');
    assert.equal(unknownHuman.review_status, 'needs_revision');
    assert.ok(unknownHuman.review_flags.includes('unknown_stable_key'));
    assert.equal(exhaustedHuman.review_status, 'needs_revision');
    assert.ok(exhaustedHuman.review_flags.includes('missing_definition'));

    const report = JSON.parse(await readFile(path.join(outputDir, 'chapter_test_llm_import_report.json'), 'utf8'));
    assert.equal(report.retry_queue_entries, 6);
    assert.equal(report.human_review_queue_entries, 2);

    const updatedMap = JSON.parse(await readFile(path.join(inputDir, 'chapter_test_symbol_concept_map.json'), 'utf8'));
    const accepted = updatedMap.symbol_concepts.find((item: { symbol: string }) => item.symbol === 'P');
    const rejectedOriginal = updatedMap.symbol_concepts.find((item: { symbol: string }) => item.symbol === 'X');
    assert.equal(accepted.concept_name, 'Allele-Frequency Transition Probability');
    assert.equal(accepted.reviewed_by, 'auto_llm_fix');
    assert.equal(rejectedOriginal.reviewed_by, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function concept(
  formulaId: string,
  role: 'defined' | 'used',
  symbol: string,
  conceptName: string,
  reviewFlags: string[],
  chapterId = 'chapter_test',
) {
  return {
    chapter_id: chapterId,
    formula_id: formulaId,
    formula_label: formulaId.replace('_', ' '),
    formula_latex: `${symbol} = x`,
    formula_section: 'Test Section',
    formula_subsection: 'Test Subsection',
    symbol,
    role,
    concept_id: `concept_${chapterId}_${formulaId}_${role}_${symbol.replace(/\W+/g, '_')}`,
    concept_name: conceptName,
    concept_type: role === 'defined' ? 'quantity_concept' : 'domain_concept',
    definition: `${conceptName} is this formula's local quantity.`,
    definition_zh: `${conceptName} 是这条公式中的局部量。`,
    aliases: [symbol, conceptName],
    evidence: [],
    confidence: 0.68,
    review_status: 'unreviewed',
    review_flags: reviewFlags,
    extraction_model: 'test',
  };
}
