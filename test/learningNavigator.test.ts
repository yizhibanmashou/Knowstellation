import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getChapterByNumber,
  getStudyFormulaIds,
  getText,
  getThemeRouteById,
  inferChapterTitleFromSearchIndex,
  isChapterStudyFormulaLocked,
  resolveNextStudyFormulaId,
  resolveRecommendedChapterFormulaId,
} from '../src/features/learning/learningNavigator.ts';
import { buildChapterConceptLearningNodes, buildConceptStarNodes } from '../src/features/starfield/starNavigation.ts';
import {
  buildConceptLearningNav,
  createConceptLearningStep,
  resolveNextConceptFromCurrent,
} from '../src/features/graph/conceptLearning.ts';
import type { ConceptReference, ConceptView } from '../src/shared/types/conceptGraph.ts';
import type { SearchFormula } from '../src/shared/types/formula.ts';
import type { ChapterNavigatorPayload, ThemeRoutesPayload } from '../src/shared/types/learning.ts';
import type { ConceptNavigationEntry, ConceptSearchResult } from '../src/shared/types/search.ts';

const chapterPayload: ChapterNavigatorPayload = {
  groups: [
    {
      id: 'population-genetics',
      title_en: 'Population Genetics',
      title_zh: '群体遗传学',
      chapters: [
        {
          chapter: 2,
          chapter_id: 'chapter2',
          title_en: 'Foundations of Population Genetics',
          title_zh: '群体遗传学基础',
          description_en: 'Core allele-frequency formulas.',
          description_zh: '核心等位基因频率公式。',
          backbone_formula_ids: ['formula_2.1', 'formula_2.2a'],
          full_formula_ids: ['formula_2.1', 'formula_2.2a', 'formula_2.2b'],
          representative_formula_ids: ['formula_2.1'],
          difficulty: 'introductory',
        },
      ],
    },
  ],
};

const themePayload: ThemeRoutesPayload = {
  paths: [
    {
      id: 'selection-detection',
      title_en: 'Selection Detection Methods',
      title_zh: '选择检测方法',
      description_en: 'Use polymorphism and divergence to detect selection.',
      description_zh: '利用多态性和分化检测选择。',
      formula_ids: ['formula_9.21a', 'formula_10.1a'],
      step_notes: [
        {
          formula_id: 'formula_10.1a',
          note_en: 'Connect neutrality-test intuition to HKA.',
          note_zh: '把中性检验直觉连接到 HKA。',
        },
      ],
      tags: ['selection', 'molecular evolution'],
      difficulty: 'intermediate',
      coverage: { chapter_count: 2, formula_count: 2 },
    },
  ],
};

test('getChapterByNumber finds chapters inside grouped navigator data', () => {
  const chapter = getChapterByNumber(chapterPayload, 2);
  assert.equal(chapter?.title_en, 'Foundations of Population Genetics');
});

test('getStudyFormulaIds returns backbone or full sequence for a chapter', () => {
  const chapter = getChapterByNumber(chapterPayload, 2)!;
  assert.deepEqual(getStudyFormulaIds({ type: 'chapter', chapter, layer: 'backbone' }), ['formula_2.1', 'formula_2.2a']);
  assert.deepEqual(getStudyFormulaIds({ type: 'chapter', chapter, layer: 'full' }), ['formula_2.1', 'formula_2.2a', 'formula_2.2b']);
});

test('resolveNextStudyFormulaId returns the next formula in the active study sequence', () => {
  assert.equal(resolveNextStudyFormulaId(['formula_2.1', 'formula_2.2a', 'formula_2.2b'], 'formula_2.1'), 'formula_2.2a');
  assert.equal(resolveNextStudyFormulaId(['formula_2.1', 'formula_2.2a'], 'formula_2.2a'), null);
  assert.equal(resolveNextStudyFormulaId(['formula_2.1'], 'formula_missing'), null);
});

test('isChapterStudyFormulaLocked unlocks current, learned, next learned-adjacent, and full sequence formulas', () => {
  const formulaIds = ['formula_2.1', 'formula_2.2a', 'formula_2.2b'];
  assert.equal(isChapterStudyFormulaLocked({ formulaIds, formulaId: 'formula_2.1', currentFormulaId: 'formula_2.1', layer: 'backbone' }), false);
  assert.equal(isChapterStudyFormulaLocked({ formulaIds, formulaId: 'formula_2.2a', currentFormulaId: 'formula_2.1', learnedFormulaIds: new Set(['formula_2.1']), layer: 'backbone' }), false);
  assert.equal(isChapterStudyFormulaLocked({ formulaIds, formulaId: 'formula_2.2b', currentFormulaId: 'formula_2.1', learnedFormulaIds: new Set(['formula_2.1']), layer: 'backbone' }), true);
  assert.equal(isChapterStudyFormulaLocked({ formulaIds, formulaId: 'formula_2.2b', currentFormulaId: 'formula_2.1', layer: 'full' }), false);
});

test('getThemeRouteById returns richer theme route data', () => {
  const route = getThemeRouteById(themePayload, 'selection-detection');
  assert.equal(route?.title_en, 'Selection Detection Methods');
  assert.equal(route?.step_notes[0].note_zh, '把中性检验直觉连接到 HKA。');
});

test('inferChapterTitleFromSearchIndex uses formula section instead of navigator placeholders', () => {
  const searchIndex: SearchFormula[] = [
    {
      id: 'formula_2.1',
      number: '2.1',
      chapter: 2,
      chapter_id: 'chapter2',
      section: 'Neutral Evolution in One- and Two-Locus Systems: Introduction',
      label: 'Formula 2.1',
      latex_preview: 'P_{ij}',
      context: 'This formula introduces the chapter.',
      keywords: [],
    },
  ];

  assert.equal(inferChapterTitleFromSearchIndex(2, searchIndex), 'Neutral Evolution in One- and Two-Locus Systems: Introduction');
});

test('getText returns requested language with English fallback', () => {
  assert.equal(getText({ en: 'Selection Detection Methods', zh: '选择检测方法' }, 'zh'), '选择检测方法');
  assert.equal(getText({ en: 'Selection Detection Methods' }, 'zh'), 'Selection Detection Methods');
});

test('resolveRecommendedChapterFormulaId prefers available representative formulas', () => {
  const chapter = getChapterByNumber(chapterPayload, 2)!;
  const searchIndex: SearchFormula[] = [
    {
      id: 'formula_2.1',
      number: '2.1',
      chapter: 2,
      chapter_id: 'chapter2',
      section: 'Neutral Evolution',
      label: 'Formula 2.1',
      latex_preview: 'p',
      context: '',
      keywords: [],
    },
  ];

  assert.equal(resolveRecommendedChapterFormulaId(chapter, searchIndex), 'formula_2.1');
});

test('resolveRecommendedChapterFormulaId falls back through backbone, full, then search index', () => {
  const chapter = {
    ...getChapterByNumber(chapterPayload, 2)!,
    representative_formula_ids: ['formula_2.missing'],
    backbone_formula_ids: ['formula_2.backbone'],
    full_formula_ids: ['formula_2.full'],
  };
  const searchIndex: SearchFormula[] = [
    {
      id: 'formula_2.full',
      number: '2.full',
      chapter: 2,
      chapter_id: 'chapter2',
      section: 'Fallback',
      label: 'Formula 2.full',
      latex_preview: 'x',
      context: '',
      keywords: [],
    },
  ];

  assert.equal(resolveRecommendedChapterFormulaId(chapter, searchIndex), 'formula_2.full');
  assert.equal(resolveRecommendedChapterFormulaId({ ...chapter, full_formula_ids: ['formula_2.missingFull'] }, searchIndex), 'formula_2.full');
});

test('resolveRecommendedChapterFormulaId returns null when a chapter has no available formulas', () => {
  const chapter = getChapterByNumber(chapterPayload, 2)!;
  assert.equal(resolveRecommendedChapterFormulaId(chapter, []), null);
});

function concept(overrides: Partial<ConceptSearchResult>): ConceptSearchResult {
  return {
    resultType: 'concept',
    id: overrides.id || `concept:${overrides.concept_id || 'concept_alpha'}`,
    concept_id: overrides.concept_id || 'concept_alpha',
    chapter_id: overrides.chapter_id || 'chapter2',
    formula_id: overrides.formula_id || 'formula_2.1',
    title: overrides.title || 'polymorphism-divergence ratio',
    context: overrides.context || '把多态性与物种间分化放在同一张检验表中比较。',
    symbol: overrides.symbol || 'P_{a}/D_{a}',
    formula_label: overrides.formula_label || 'Formula 2.1',
    formula_section: overrides.formula_section || 'Neutral Evolution',
    aliases: overrides.aliases || ['多态性分化比'],
    matchReason: overrides.matchReason,
    searchScore: overrides.searchScore,
    occurrenceCount: overrides.occurrenceCount,
    relatedFormulaLabels: overrides.relatedFormulaLabels,
    primaryFormulaId: overrides.primaryFormulaId,
  };
}

function conceptReference(overrides: Partial<ConceptReference>): ConceptReference {
  return {
    concept_id: overrides.concept_id || 'concept_neighbor',
    view_id: overrides.view_id,
    name: overrides.name || 'Neighbor concept',
    symbol: overrides.symbol,
    defined_by_formula_id: overrides.defined_by_formula_id ?? 'formula_2.2a',
    from_formula_id: overrides.from_formula_id,
    formula_label: overrides.formula_label || 'Formula 2.2a',
    clickable: overrides.clickable ?? true,
    confidence: overrides.confidence ?? 0.9,
    relation: overrides.relation,
    concept_type: overrides.concept_type,
    definition: overrides.definition,
    definition_zh: overrides.definition_zh,
    teaching_move: overrides.teaching_move,
    teaching_move_zh: overrides.teaching_move_zh,
    source_sentence: overrides.source_sentence,
    prerequisite_concepts: overrides.prerequisite_concepts,
    introduced_concepts: overrides.introduced_concepts,
  };
}

function conceptView(overrides: Partial<ConceptView>): ConceptView {
  return {
    chapter_id: overrides.chapter_id || 'chapter2',
    concept_id: overrides.concept_id || 'concept_current',
    view_id: overrides.view_id,
    name: overrides.name || 'Current concept',
    definition: overrides.definition || 'Definition.',
    definition_zh: overrides.definition_zh,
    teaching_move: overrides.teaching_move,
    teaching_move_zh: overrides.teaching_move_zh,
    source_sentence: overrides.source_sentence,
    concept_type: overrides.concept_type || 'quantity_concept',
    defined_by_formula_id: overrides.defined_by_formula_id || 'formula_2.1',
    defined_symbol: overrides.defined_symbol || 'x',
    supporting_formula_label: overrides.supporting_formula_label || 'Formula 2.1',
    supporting_formula_latex: overrides.supporting_formula_latex || 'x',
    formula_position: overrides.formula_position,
    formula_section: overrides.formula_section,
    formula_subsection: overrides.formula_subsection,
    evidence: overrides.evidence || [],
    confidence: overrides.confidence ?? 0.9,
    prerequisite_concepts: overrides.prerequisite_concepts || [],
    introduced_concepts: overrides.introduced_concepts || [],
    edges: overrides.edges || [],
  };
}

test('buildConceptStarNodes groups duplicate concepts and exposes concept navigation fields', () => {
  const chapter = getChapterByNumber(chapterPayload, 2)!;
  const nodes = buildConceptStarNodes({
    chapter,
    maxConcepts: 4,
    conceptIndex: [
      concept({ concept_id: 'concept_ratio_a', formula_id: 'formula_2.1', title: 'polymorphism-divergence ratio' }),
      concept({ concept_id: 'concept_ratio_b', formula_id: 'formula_2.2a', title: 'polymorphism-divergence ratio' }),
      concept({ concept_id: 'concept_generic_statement', title: 'Formula 2.1 result', symbol: '', context: '泛公式结果。' }),
      concept({ concept_id: 'chapter3_concept', chapter_id: 'chapter3', formula_id: 'formula_3.1' }),
    ],
  });

  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].kind, 'concept');
  assert.equal(nodes[0].conceptId, 'concept_ratio_a');
  assert.equal(nodes[0].formulaId, 'formula_2.1');
  assert.equal(nodes[0].formulaLabel, '公式 2.1');
  assert.equal(nodes[0].chapterId, 'chapter2');
});

test('buildConceptStarNodes merges repeated concept navigation entries into one semantic card', () => {
  const chapter = getChapterByNumber(chapterPayload, 2)!;
  const navigation: ConceptNavigationEntry[] = [
    {
      concept_id: 'concept_ratio_a',
      formula_id: 'formula_2.1',
      title: 'polymorphism-divergence ratio',
      symbol: 'P_{a}/D_{a}',
      formula_label: 'Formula 2.1',
      formula_section: 'Neutral Evolution',
      prerequisite_concept_ids: [],
      depth: 0,
      order: 0,
    },
    {
      concept_id: 'concept_ratio_b',
      formula_id: 'formula_2.2a',
      title: 'polymorphism-divergence ratio',
      symbol: 'P_{a}/D_{a}',
      formula_label: 'Formula 2.2a',
      formula_section: 'Neutral Evolution',
      prerequisite_concept_ids: ['concept_ratio_a'],
      depth: 1,
      order: 1,
    },
  ];
  const nodes = buildConceptStarNodes({
    chapter,
    conceptNavigation: navigation,
    conceptIndex: [
      concept({ concept_id: 'concept_ratio_a', formula_id: 'formula_2.1', title: 'polymorphism-divergence ratio' }),
    ],
  });

  assert.deepEqual(nodes.map((node) => node.conceptId), ['concept_ratio_a']);
  assert.equal(nodes[0].formulaId, 'formula_2.1');
  assert.equal(nodes[0].title, 'polymorphism-divergence ratio');
  assert.equal(nodes[0].occurrenceCount, 2);
  assert.deepEqual(nodes[0].relatedFormulaLabels, ['Formula 2.1', 'Formula 2.2a']);
});

test('buildConceptStarNodes does not merge related but different probability concepts', () => {
  const chapter = getChapterByNumber(chapterPayload, 2)!;
  const nodes = buildConceptStarNodes({
    chapter,
    maxConcepts: 4,
    conceptIndex: [
      concept({ concept_id: 'concept_probability', formula_id: 'formula_2.1', title: 'Probability', symbol: 'P', context: '衡量某个事件或状态转移发生可能性的数量。' }),
      concept({ concept_id: 'concept_likelihood', formula_id: 'formula_2.2a', title: 'Likelihood', symbol: 'L', context: '衡量模型解释观测数据程度的量。' }),
    ],
  });

  assert.equal(nodes.length, 2);
  assert.deepEqual(new Set(nodes.map((node) => node.conceptId)), new Set(['concept_probability', 'concept_likelihood']));
});

test('buildConceptStarNodes excludes generic formula-statement concepts', () => {
  const chapter = getChapterByNumber(chapterPayload, 2)!;
  const nodes = buildConceptStarNodes({
    chapter,
    maxConcepts: 2,
    conceptIndex: [
      concept({ concept_id: 'concept_statement_only', title: 'Formula 2.1 result', symbol: '', context: '这一式的结果。' }),
    ],
  });

  assert.equal(nodes.length, 0);
});

test('buildChapterConceptLearningNodes uses the same filtered order for next concept learning', () => {
  const chapter = getChapterByNumber(chapterPayload, 2)!;
  const nodes = buildChapterConceptLearningNodes({
    chapter,
    maxConcepts: 3,
    conceptIndex: [
      concept({ concept_id: 'concept_formula_root', formula_id: 'formula_2.1', title: 'Likelihood', symbol: 'L' }),
      concept({ concept_id: 'concept_followup', formula_id: 'formula_2.2a', title: 'Probability density', symbol: '\\phi' }),
      concept({ concept_id: 'concept_generic_statement', title: 'Formula 2.1 result', symbol: '', context: '泛公式结果。' }),
    ],
  });
  const currentIndex = nodes.findIndex((node) => node.conceptId === 'concept_formula_root');
  const next = currentIndex >= 0 ? nodes[currentIndex + 1] : null;

  assert.equal(nodes.length, 2);
  assert.equal(nodes[currentIndex].formulaId, 'formula_2.1');
  assert.equal(next?.conceptId, 'concept_followup');
  assert.equal(next?.formulaId, 'formula_2.2a');
});

test('buildChapterConceptLearningNodes falls back to indexed symbols when navigation symbols are blank', () => {
  const chapter = getChapterByNumber(chapterPayload, 2)!;
  const conceptNavigation: ConceptNavigationEntry[] = [
    {
      concept_id: 'concept_tau_hat',
      formula_id: 'formula_2.1',
      formula_label: 'Formula 2.1',
      title: 'Tau-hat',
      symbol: '   ',
      prerequisite_concept_ids: [],
      depth: 0,
      order: 0,
    },
  ];
  const nodes = buildChapterConceptLearningNodes({
    chapter,
    maxConcepts: 3,
    conceptNavigation,
    conceptIndex: [
      concept({
        concept_id: 'concept_tau_hat',
        formula_id: 'formula_2.1',
        title: 'Tau-hat',
        symbol: '\\widehat{\\tau}',
      }),
    ],
  });

  assert.equal(nodes[0]?.symbol, '\\widehat{\\tau}');
});

test('resolveNextConceptFromCurrent prefers the chapter sequence over local prerequisite concepts', () => {
  const chapter = getChapterByNumber(chapterPayload, 2)!;
  const nodes = buildChapterConceptLearningNodes({
    chapter,
    maxConcepts: 3,
    conceptIndex: [
      concept({ concept_id: 'concept_current', formula_id: 'formula_2.1', title: 'Current', symbol: 'C' }),
      concept({ concept_id: 'concept_sequence', formula_id: 'formula_2.2a', title: 'Sequence', symbol: 'S' }),
    ],
  });
  const steps = nodes.map((node, index) => createConceptLearningStep(node, index, nodes.length));
  const target = resolveNextConceptFromCurrent({
    currentView: conceptView({
      concept_id: 'concept_current',
      prerequisite_concepts: [
        conceptReference({ concept_id: 'concept_prereq', name: 'Prerequisite concept', defined_by_formula_id: 'formula_2.2b', formula_label: 'Formula 2.2b' }),
      ],
      introduced_concepts: [
        conceptReference({ concept_id: 'concept_intro', name: 'Introduced concept', defined_by_formula_id: 'formula_2.2a', formula_label: 'Formula 2.2a' }),
      ],
    }),
    current: steps[0],
    next: steps[1],
    chapterSteps: steps,
  });

  assert.equal(target?.conceptId, 'concept_sequence');
  assert.equal(target?.formulaId, 'formula_2.2a');
  assert.equal(target?.source, 'chapter_sequence');
});

test('resolveNextConceptFromCurrent opens the referenced concept view when available', () => {
  const target = resolveNextConceptFromCurrent({
    currentView: conceptView({
      concept_id: 'canonical_response',
      view_id: 'view_current_response',
      prerequisite_concepts: [
        conceptReference({
          concept_id: 'canonical_response',
          view_id: 'view_upstream_response',
          name: 'Trait response',
          defined_by_formula_id: 'formula_2.2b',
          formula_label: 'Formula 2.2b',
        }),
      ],
    }),
    current: null,
    next: null,
    chapterSteps: [],
  });

  assert.equal(target?.conceptId, 'view_upstream_response');
  assert.equal(target?.formulaId, 'formula_2.2b');
  assert.equal(target?.source, 'adjacent');
});

test('resolveNextConceptFromCurrent ignores introduced concepts when prerequisites are unavailable', () => {
  const target = resolveNextConceptFromCurrent({
    currentView: conceptView({
      prerequisite_concepts: [
        conceptReference({ concept_id: 'concept_blocked', clickable: false }),
      ],
      introduced_concepts: [
        conceptReference({ concept_id: 'concept_intro', name: 'Introduced concept', defined_by_formula_id: 'formula_2.2a', formula_label: 'Formula 2.2a' }),
      ],
    }),
    current: null,
    next: null,
    chapterSteps: [],
  });

  assert.equal(target, null);
});

test('buildConceptLearningNav falls back to the chapter sequence without a concept edge', () => {
  const chapter = getChapterByNumber(chapterPayload, 2)!;
  const nodes = buildChapterConceptLearningNodes({
    chapter,
    maxConcepts: 3,
    conceptIndex: [
      concept({ concept_id: 'concept_current', formula_id: 'formula_2.1', title: 'Current', symbol: 'C' }),
      concept({ concept_id: 'concept_sequence', formula_id: 'formula_2.2a', title: 'Sequence', symbol: 'S' }),
    ],
  });
  const nav = buildConceptLearningNav({
    chapterId: 'chapter2',
    nodes,
    routeConceptId: 'concept_current',
    selectedFormulaId: 'formula_2.1',
    currentView: conceptView({ concept_id: 'concept_current', prerequisite_concepts: [], introduced_concepts: [] }),
    learnedConceptIds: new Set(['concept_current']),
    layer: 'backbone',
  });

  assert.equal(nav?.nextFromCurrent?.conceptId, 'concept_sequence');
  assert.equal(nav?.nextFromCurrent?.source, 'chapter_sequence');
});

test('buildConceptLearningNav skips locked sequence fallback in the recommended concept path', () => {
  const chapter = getChapterByNumber(chapterPayload, 2)!;
  const nodes = buildChapterConceptLearningNodes({
    chapter,
    maxConcepts: 3,
    conceptIndex: [
      concept({ concept_id: 'concept_current', formula_id: 'formula_2.1', title: 'Current', symbol: 'C' }),
      concept({ concept_id: 'concept_sequence', formula_id: 'formula_2.2a', title: 'Sequence', symbol: 'S' }),
    ],
  });
  const conceptNavigation: ConceptNavigationEntry[] = [
    {
      concept_id: 'concept_current',
      formula_id: 'formula_2.1',
      title: 'Current',
      symbol: 'C',
      prerequisite_concept_ids: [],
      depth: 0,
      order: 0,
    },
    {
      concept_id: 'concept_sequence',
      formula_id: 'formula_2.2a',
      title: 'Sequence',
      symbol: 'S',
      prerequisite_concept_ids: ['concept_current'],
      depth: 1,
      order: 1,
    },
  ];
  const nav = buildConceptLearningNav({
    chapterId: 'chapter2',
    nodes,
    routeConceptId: 'concept_current',
    currentView: conceptView({ concept_id: 'concept_current', prerequisite_concepts: [], introduced_concepts: [] }),
    conceptNavigation,
    learnedConceptIds: new Set(),
    layer: 'backbone',
  });

  assert.equal(nav?.steps.find((step) => step.conceptId === 'concept_sequence')?.locked, true);
  assert.equal(nav?.nextFromCurrent, null);
});

test('buildConceptLearningNav locks only the recommended concept path', () => {
  const chapter = getChapterByNumber(chapterPayload, 2)!;
  const nodes = buildChapterConceptLearningNodes({
    chapter,
    maxConcepts: 3,
    conceptIndex: [
      concept({ concept_id: 'concept_current', formula_id: 'formula_2.1', title: 'Current', symbol: 'C' }),
      concept({ concept_id: 'concept_sequence', formula_id: 'formula_2.2a', title: 'Sequence', symbol: 'S' }),
    ],
  });
  const conceptNavigation: ConceptNavigationEntry[] = [
    {
      concept_id: 'concept_current',
      formula_id: 'formula_2.1',
      title: 'Current',
      symbol: 'C',
      prerequisite_concept_ids: [],
      depth: 0,
      order: 0,
    },
    {
      concept_id: 'concept_sequence',
      formula_id: 'formula_2.2a',
      title: 'Sequence',
      symbol: 'S',
      prerequisite_concept_ids: ['concept_current'],
      depth: 1,
      order: 1,
    },
  ];
  const currentView = conceptView({
    concept_id: 'concept_current',
    prerequisite_concepts: [
      conceptReference({
        concept_id: 'concept_sequence',
        name: 'Sequence',
        defined_by_formula_id: 'formula_2.2a',
        formula_label: 'Formula 2.2a',
      }),
    ],
  });

  const backbone = buildConceptLearningNav({
    chapterId: 'chapter2',
    nodes,
    routeConceptId: 'concept_current',
    currentView,
    conceptNavigation,
    learnedConceptIds: new Set(),
    layer: 'backbone',
  });
  const full = buildConceptLearningNav({
    chapterId: 'chapter2',
    nodes,
    routeConceptId: 'concept_current',
    currentView,
    conceptNavigation,
    learnedConceptIds: new Set(),
    layer: 'full',
  });

  assert.equal(backbone?.steps.find((step) => step.conceptId === 'concept_sequence')?.locked, true);
  assert.equal(backbone?.nextFromCurrent, null);
  assert.equal(full?.steps.find((step) => step.conceptId === 'concept_sequence')?.locked, false);
  assert.equal(full?.nextFromCurrent?.conceptId, 'concept_sequence');
});

test('resolveNextConceptFromCurrent loops to the first unlocked chapter concept after the last step', () => {
  const chapter = getChapterByNumber(chapterPayload, 2)!;
  const nodes = buildChapterConceptLearningNodes({
    chapter,
    maxConcepts: 3,
    conceptIndex: [
      concept({ concept_id: 'concept_first', formula_id: 'formula_2.1', title: 'First', symbol: 'F' }),
      concept({ concept_id: 'concept_last', formula_id: 'formula_2.2a', title: 'Last', symbol: 'L' }),
    ],
  });
  const steps = nodes.map((node, index) => createConceptLearningStep(node, index, nodes.length));
  const target = resolveNextConceptFromCurrent({
    currentView: conceptView({ concept_id: 'concept_last', defined_by_formula_id: 'formula_2.2a' }),
    current: steps[1],
    next: null,
    chapterSteps: steps,
  });

  assert.equal(target?.conceptId, 'concept_first');
  assert.equal(target?.source, 'chapter_loop');
});

test('resolveNextConceptFromCurrent returns null only when no other concept is available', () => {
  const chapter = getChapterByNumber(chapterPayload, 2)!;
  const nodes = buildChapterConceptLearningNodes({
    chapter,
    maxConcepts: 1,
    conceptIndex: [
      concept({ concept_id: 'concept_only', formula_id: 'formula_2.1', title: 'Only', symbol: 'O' }),
    ],
  });
  const steps = nodes.map((node, index) => createConceptLearningStep(node, index, nodes.length));
  const target = resolveNextConceptFromCurrent({
    currentView: conceptView({ concept_id: 'concept_only' }),
    current: steps[0],
    next: null,
    chapterSteps: steps,
  });

  assert.equal(target, null);
});
