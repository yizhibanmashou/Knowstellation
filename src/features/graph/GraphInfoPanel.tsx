import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { ConceptGraphPayload, ConceptReference, ConceptView } from '../../shared/types/conceptGraph';
import type { ChapterDependencies, FormulaLearningCopyPayload, FormulaPrerequisite, SearchFormula, StorylineEntry } from '../../shared/types/formula';
import type { LanguageCode, StudyContext } from '../../shared/types/learning';
import { useDependencyGraph } from './useDependencyGraph';
import { useConceptGraph } from './useConceptGraph';
import {
  generateChapterOverview,
  generateConceptDetails,
  generateFormulaNotes,
  type ChapterOverviewResponse,
  type ConceptDetailReference,
  type ConceptDetailResponse,
  type FormulaNoteResponse,
} from '../../shared/services/llmClient';
import { rawFormulaNumber } from '../../shared/utils/constants';
import { buildReadableFormulaCopy } from './formulaInfo';
import {
  DEFAULT_LANGUAGE,
  formatChapterDescription,
  formatChapterLabel,
  formatChapterTitle,
  formatConceptTitle,
  formatFormulaReferenceLabel,
  getUiCopy,
  joinMeta,
} from '../../shared/utils/uiCopy';
import { RichMathText } from '../../shared/components/RichMathText';

interface GraphInfoPanelProps {
  searchIndex: SearchFormula[];
  formulaLearningCopy: FormulaLearningCopyPayload['items'];
  takeawayCache?: Record<string, string>;
  studyContext: StudyContext;
  storylines: StorylineEntry[];
}

interface LlmFormulaState {
  key: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  value: FormulaNoteResponse | null;
}

interface LlmChapterState {
  key: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  value: ChapterOverviewResponse | null;
}

interface LlmConceptState {
  key: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  value: ConceptDetailResponse | null;
}

interface ConceptMapOverviewState {
  key: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  viewCount: number;
  relationCount: number;
}

interface FormulaMapOverviewState {
  key: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  formulaCount: number;
  relationCount: number;
}

function getStudyContextText(studyContext: StudyContext, language: LanguageCode) {
  if (studyContext.type === 'chapter') {
    return {
      title: formatChapterTitle({
        chapterId: studyContext.chapter.chapter_id,
        chapter: studyContext.chapter.chapter,
        titleEn: studyContext.chapter.title_en,
        titleZh: studyContext.chapter.title_zh,
        language,
      }),
      description: formatChapterDescription({
        chapterId: studyContext.chapter.chapter_id,
        chapter: studyContext.chapter.chapter,
        descriptionEn: studyContext.chapter.description_en,
        descriptionZh: studyContext.chapter.description_zh,
        formulaCount: studyContext.chapter.full_formula_ids.length,
        sectionHint: studyContext.chapter.section_hint,
        language,
      }),
    };
  }
  if (studyContext.type === 'theme') {
    return {
      title: language === 'zh' ? studyContext.route.title_zh : studyContext.route.title_en,
      description: language === 'zh' ? studyContext.route.description_zh : studyContext.route.description_en,
    };
  }
  return null;
}

function conceptTypeLabel(conceptType = '', language: LanguageCode): string {
  const key = conceptType.toLowerCase();
  if (language === 'zh') {
    if (key.includes('operator')) return '运算规则';
    if (key.includes('math')) return '数学结构';
    if (key.includes('domain')) return '生物学条件';
    return '核心量';
  }
  if (key.includes('operator')) return 'operation rule';
  if (key.includes('math')) return 'mathematical structure';
  if (key.includes('domain')) return 'biological condition';
  return 'core quantity';
}

function cleanPanelText(value = ''): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function firstEvidenceSentence(view: ConceptView): string {
  return cleanPanelText(view.source_sentence || view.evidence.find((item) => cleanPanelText(item.sentence))?.sentence || '');
}

function conceptReferenceSymbol(reference: ConceptReference): string {
  return cleanPanelText(reference.symbol || reference.via_symbol || '');
}

function conceptReferenceDefinition(reference: ConceptReference): string {
  return cleanPanelText(reference.definition_zh || reference.definition || reference.source_sentence || '');
}

function referenceTitle(reference: ConceptReference, language: LanguageCode): string {
  return formatConceptTitle(reference.name, conceptReferenceSymbol(reference), language) || reference.name;
}

function compactReferenceList(references: ConceptReference[] = [], language: LanguageCode, limit = 3): string {
  const names = references.slice(0, limit).map((reference) => referenceTitle(reference, language)).filter(Boolean);
  if (!names.length) return '';
  const suffix = references.length > names.length ? (language === 'zh' ? '等' : ' and others') : '';
  return language === 'zh' ? `${names.join('、')}${suffix}` : `${names.join(', ')}${suffix}`;
}

function toConceptDetailReferences(references: ConceptReference[] = [], language: LanguageCode): ConceptDetailReference[] {
  return references.slice(0, 6).map((reference) => ({
    name: referenceTitle(reference, language),
    symbol: conceptReferenceSymbol(reference),
    definition: conceptReferenceDefinition(reference),
    relation: reference.relation || '',
    formulaLabel: formatFormulaReferenceLabel(reference.formula_label, language),
  }));
}

function buildConceptReading(view: ConceptView, language: LanguageCode, llmDetail?: ConceptDetailResponse | null): string {
  if (llmDetail?.explanation) return cleanPanelText(llmDetail.explanation);
  const definition = cleanPanelText(view.definition_zh || view.definition);
  const title = formatConceptTitle(view.name, '', language);
  const symbol = cleanPanelText(view.defined_symbol);
  const formulaLabel = formatFormulaReferenceLabel(view.supporting_formula_label, language);
  const prerequisites = compactReferenceList(view.prerequisite_concepts, language);
  const successors = compactReferenceList(view.successor_concepts || [], language);

  if (language === 'zh') {
    const formulaPart = formulaLabel ? `在 ${formulaLabel} 中，它通常是读懂该式计算对象或条件的关键量` : '它主要通过当前局部图里的关系来定位作用';
    const relationPart = prerequisites || successors
      ? `${prerequisites ? `先理解 ${prerequisites}` : '先看清本节点定义'}${successors ? `，再过渡到 ${successors}` : '，再回到公式继续展开'}`
      : '可以先把它当作当前公式里的局部定义，再回到图谱观察后续连接';
    return `${definition ? `${definition} ` : `${title} 是本章概念路径中的一个阅读节点。`}${symbol ? `这里的 ${symbol} 不是孤立符号，而是和公式语境绑定的概念。` : ''}${formulaPart}；学习时可以${relationPart}。`;
  }

  const formulaPart = formulaLabel ? `In ${formulaLabel}, it anchors the quantity, condition, or comparison that the formula needs` : 'Its role is mainly defined by its local graph relationships';
  const relationPart = prerequisites || successors
    ? `${prerequisites ? `read it after ${prerequisites}` : 'start from this definition'}${successors ? `, then move toward ${successors}` : ', then return to the formula path'}`
    : 'treat it as a local formula definition before following later graph links';
  return `${definition ? `${definition} ` : `${title} is a reading node in this chapter concept path. `}${symbol ? `Here ${symbol} should be read in its formula context, not as an isolated symbol. ` : ''}${formulaPart}; when studying, ${relationPart}.`;
}

function countConceptMapRelations(graph: ConceptGraphPayload): number {
  const relations = new Set<string>();
  graph.views.forEach((view) => {
    const currentId = view.view_id || view.concept_id;
    (view.prerequisite_concepts || []).forEach((reference) => {
      const sourceId = reference.view_id || reference.concept_id;
      if (sourceId && currentId && sourceId !== currentId) relations.add(`${sourceId}->${currentId}:${reference.relation || 'prerequisite_for'}`);
    });
    (view.successor_concepts || []).forEach((reference) => {
      const targetId = reference.view_id || reference.concept_id;
      if (currentId && targetId && currentId !== targetId) relations.add(`${currentId}->${targetId}:${reference.relation || 'successor_for'}`);
    });
    (view.edges || []).forEach((edge) => {
      if (edge.from && edge.to && edge.from !== edge.to) relations.add(`${edge.from}->${edge.to}:${edge.relation}`);
    });
  });
  return relations.size;
}

function countFormulaMapRelations(chapter: ChapterDependencies): number {
  const relations = new Set<string>();
  chapter.dependencies.forEach((dependency) => {
    dependency.prerequisites.forEach((prerequisite) => {
      if (prerequisite.type !== 'formula' || !prerequisite.target_id || prerequisite.cross_chapter || prerequisite.edge_status === 'rejected') return;
      relations.add(`${prerequisite.target_id}->${dependency.dependent_id}`);
    });
  });
  return relations.size;
}

function buildConceptMapOverviewText(
  baseDescription: string,
  overview: ConceptMapOverviewState,
  language: LanguageCode,
): string {
  const description = baseDescription.replace(/\s+/g, ' ').trim();
  const conceptCount = overview.viewCount || 0;
  const relationCount = overview.relationCount || 0;
  if (language === 'zh') {
    const countText = conceptCount
      ? `这张概念图把本章 ${conceptCount} 个概念`
      : '这张概念图把本章概念';
    const relationText = relationCount ? `和 ${relationCount} 条前置/后续关系` : '和它们之间的前置/后续关系';
    return `${description ? `${description} ` : ''}${countText}${relationText}组织成一张网络。点击概念节点可以进入局部 Concept 视图，点击公式入口可以回到对应 Formula。`;
  }
  const countText = conceptCount ? `${conceptCount} concepts` : 'the chapter concepts';
  const relationText = relationCount ? `${relationCount} prerequisite/successor links` : 'their prerequisite and successor links';
  return `${description ? `${description} ` : ''}This Concept Map organizes ${countText} and ${relationText} into a chapter-scale network. Click a concept to open its local Concept view, or use the formula entry to jump back into Formula mode.`;
}

export function GraphInfoPanel({
  searchIndex,
  formulaLearningCopy,
  takeawayCache,
  studyContext,
  storylines,
}: GraphInfoPanelProps) {
  const { focusFormulaId = '', chapterId: routeChapterId = '' } = useParams();
  const [params] = useSearchParams();
  const { loadChapter } = useDependencyGraph();
  const { loadConceptChapter } = useConceptGraph();
  const [language, setLanguage] = useState<LanguageCode>(DEFAULT_LANGUAGE);
  const [selectedFormulaId, setSelectedFormulaId] = useState(focusFormulaId);
  const [selectedConceptView, setSelectedConceptView] = useState<ConceptView | null>(null);
  const [prerequisites, setPrerequisites] = useState<FormulaPrerequisite[]>([]);
  const [prerequisitesLoadedFor, setPrerequisitesLoadedFor] = useState('');
  const [llmState, setLlmState] = useState<LlmFormulaState>({ key: '', status: 'idle', value: null });
  const [chapterOverviewState, setChapterOverviewState] = useState<LlmChapterState>({ key: '', status: 'idle', value: null });
  const [conceptDetailState, setConceptDetailState] = useState<LlmConceptState>({ key: '', status: 'idle', value: null });
  const [conceptMapOverviewState, setConceptMapOverviewState] = useState<ConceptMapOverviewState>({
    key: '',
    status: 'idle',
    viewCount: 0,
    relationCount: 0,
  });
  const [formulaMapOverviewState, setFormulaMapOverviewState] = useState<FormulaMapOverviewState>({
    key: '',
    status: 'idle',
    formulaCount: 0,
    relationCount: 0,
  });
  const lookup = useMemo(() => new Map(searchIndex.map((item) => [item.id, item])), [searchIndex]);

  useEffect(() => {
    setSelectedFormulaId(focusFormulaId);
    setSelectedConceptView(null);
  }, [focusFormulaId]);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ formulaId?: string }>).detail;
      if (detail?.formulaId) {
        setSelectedFormulaId(detail.formulaId);
        setSelectedConceptView(null);
      }
    };
    window.addEventListener('litgraph:formula-details', listener);
    return () => window.removeEventListener('litgraph:formula-details', listener);
  }, []);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ conceptView?: ConceptView }>).detail;
      if (!detail?.conceptView) return;
      setSelectedConceptView(detail.conceptView);
      setSelectedFormulaId(detail.conceptView.defined_by_formula_id);
    };
    window.addEventListener('litgraph:concept-details', listener);
    return () => window.removeEventListener('litgraph:concept-details', listener);
  }, []);

  const formula = lookup.get(selectedFormulaId) || lookup.get(focusFormulaId);
  const formulaNumber = rawFormulaNumber(formula?.id || focusFormulaId);
  const copy = getUiCopy(language).graph.info;
  const studyContextText = getStudyContextText(studyContext, language);
  const requestedMode = params.get('mode');
  const isConceptMapMode = requestedMode === 'conceptMap' && Boolean(routeChapterId && !focusFormulaId);
  const isChapterGraph = Boolean(routeChapterId && !focusFormulaId && !isConceptMapMode);
  const isConceptMode = !routeChapterId && requestedMode !== 'formula' && requestedMode !== 'explore' && requestedMode !== 'conceptMap';
  const conceptView = isConceptMode ? selectedConceptView : null;
  const conceptMeta = conceptView
    ? joinMeta([
        formatChapterLabel(conceptView.chapter_id, undefined, language),
        conceptTypeLabel(conceptView.concept_type, language),
      ])
    : '';
  const conceptDetailKey = conceptView ? `${conceptView.chapter_id}:${conceptView.view_id || conceptView.concept_id}:${language}:concept-detail` : '';
  const conceptReading = conceptView
    ? buildConceptReading(conceptView, language, conceptDetailState.key === conceptDetailKey ? conceptDetailState.value : null)
    : '';
  const chapterOverviewFallback =
    studyContext.type === 'chapter'
      ? formatChapterDescription({
          chapterId: studyContext.chapter.chapter_id,
          chapter: studyContext.chapter.chapter,
          descriptionEn: studyContext.chapter.description_en,
          descriptionZh: studyContext.chapter.description_zh,
          formulaCount: studyContext.chapter.full_formula_ids.length,
          sectionHint: studyContext.chapter.section_hint,
          language,
        })
      : studyContextText?.description || '';
  const chapterOverviewText = chapterOverviewState.value?.overview || chapterOverviewFallback;
  const conceptMapOverviewText = buildConceptMapOverviewText(chapterOverviewFallback, conceptMapOverviewState, language);
  const conceptMapMeta = conceptMapOverviewState.status === 'ready'
    ? joinMeta(['Concept Map', `${conceptMapOverviewState.viewCount} concepts`, `${conceptMapOverviewState.relationCount} links`])
    : joinMeta(['Concept Map', '概念网络']);
  const formulaMapMeta = formulaMapOverviewState.status === 'ready'
    ? joinMeta(['Formula Map', `${formulaMapOverviewState.formulaCount} formulas`, `${formulaMapOverviewState.relationCount} links`])
    : joinMeta(['Formula Map', studyContext.type === 'chapter' ? `${studyContext.chapter.full_formula_ids.length} formulas` : 'formula network']);
  const chapterOverviewFormulas = useMemo(() => {
    if (studyContext.type !== 'chapter') return [];
    const chapter = studyContext.chapter;
    const formulaIds = [
      ...chapter.backbone_formula_ids,
      ...chapter.representative_formula_ids.filter((id) => !chapter.backbone_formula_ids.includes(id)),
      ...chapter.full_formula_ids.filter((id) => !chapter.backbone_formula_ids.includes(id) && !chapter.representative_formula_ids.includes(id)).slice(0, 10),
    ];
    return formulaIds
      .map((id) => {
        const formulaItem = lookup.get(id);
        if (!formulaItem) return null;
        const role = chapter.backbone_formula_ids.includes(id) ? 'backbone' : chapter.representative_formula_ids.includes(id) ? 'representative' : 'support';
        return {
          id: formulaItem.id,
          label: formulaItem.label,
          section: formulaItem.section,
          latex_preview: formulaItem.latex_preview,
          context: formulaItem.context,
          role,
        } as const;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [lookup, studyContext]);
  const fallbackCopy = buildReadableFormulaCopy({
    formulaId: formula?.id,
    language,
    cache: formulaLearningCopy,
    takeawayCache,
    context: formula?.context,
    latex: formula?.latex_preview,
    chapterTitle:
      studyContext.type === 'chapter'
        ? formatChapterTitle({
            chapterId: studyContext.chapter.chapter_id,
            chapter: studyContext.chapter.chapter,
            titleEn: studyContext.chapter.title_en,
            titleZh: studyContext.chapter.title_zh,
            language,
          })
        : formatChapterLabel(formula?.chapter_id, formula?.chapter, language),
    formulaLabel: formula?.label,
    formulaNumber: formula?.number || formulaNumber,
    section: formula?.section,
  });
  const learningCopy = llmState.value
    ? buildReadableFormulaCopy({
        formulaId: formula?.id,
        language,
        cache: {
          [formula?.id || 'selected']: {
            [language]: llmState.value,
          },
        },
        takeawayCache,
        context: formula?.context,
        latex: formula?.latex_preview,
        chapterTitle:
          studyContext.type === 'chapter'
            ? formatChapterTitle({
                chapterId: studyContext.chapter.chapter_id,
                chapter: studyContext.chapter.chapter,
                titleEn: studyContext.chapter.title_en,
                titleZh: studyContext.chapter.title_zh,
                language,
              })
            : formatChapterLabel(formula?.chapter_id, formula?.chapter, language),
        formulaLabel: formula?.label,
        formulaNumber: formula?.number || formulaNumber,
        section: formula?.section,
      })
    : fallbackCopy;
  const story = params.get('storyline');
  const storyTitle = useMemo(() => {
    const storyline = storylines.find((item) => item.id === story);
    return storyline?.title_zh || storyline?.title_en || story;
  }, [story, storylines]);
  useEffect(() => {
    if (!formula?.id || isChapterGraph || isConceptMapMode) {
      setPrerequisites([]);
      setPrerequisitesLoadedFor('');
      return;
    }
    let cancelled = false;
    setPrerequisites([]);
    setPrerequisitesLoadedFor('');
    loadChapter(formula.chapter_id)
      .then((chapter) => {
        if (cancelled) return;
        const dependency = chapter?.dependencies.find((item) => item.dependent_id === formula.id);
        setPrerequisites(dependency?.prerequisites || []);
        setPrerequisitesLoadedFor(formula.id);
      })
      .catch(() => {
        if (!cancelled) {
          setPrerequisites([]);
          setPrerequisitesLoadedFor(formula.id);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [formula?.chapter_id, formula?.id, isChapterGraph, isConceptMapMode, loadChapter]);

  useEffect(() => {
    if (!formula?.id || isChapterGraph || isConceptMapMode) {
      setLlmState({ key: '', status: 'idle', value: null });
      return;
    }
    const key = `${formula.id}:${language}:formula-notes`;
    if (prerequisitesLoadedFor !== formula.id) {
      setLlmState((current) => ({
        key,
        status: current.key === key && current.value ? 'ready' : 'idle',
        value: current.key === key ? current.value : null,
      }));
      return;
    }
    let cancelled = false;
    setLlmState((current) => ({
      key,
      status: 'loading',
      value: current.key === key ? current.value : null,
    }));
    generateFormulaNotes({
      formulaId: formula.id,
      latex: formula.latex_preview,
      context: formula.context,
      section: formula.section,
      prerequisites,
      language,
    })
      .then((value) => {
        if (!cancelled) setLlmState({ key, status: 'ready', value });
      })
      .catch(() => {
        if (!cancelled) setLlmState({ key, status: 'error', value: null });
      });
    return () => {
      cancelled = true;
    };
  }, [formula?.context, formula?.id, formula?.latex_preview, formula?.section, isChapterGraph, isConceptMapMode, language, prerequisites, prerequisitesLoadedFor]);

  useEffect(() => {
    if (!conceptView || isChapterGraph || isConceptMapMode) {
      setConceptDetailState({ key: '', status: 'idle', value: null });
      return;
    }
    const key = `${conceptView.chapter_id}:${conceptView.view_id || conceptView.concept_id}:${language}:concept-detail`;
    let cancelled = false;
    setConceptDetailState((current) => ({
      key,
      status: 'loading',
      value: current.key === key ? current.value : null,
    }));
    generateConceptDetails({
      chapterId: conceptView.chapter_id,
      conceptId: conceptView.concept_id,
      viewId: conceptView.view_id,
      name: conceptView.name,
      symbol: conceptView.defined_symbol,
      conceptType: conceptView.concept_type,
      definition: conceptView.definition_zh?.trim() || conceptView.definition,
      sourceSentence: firstEvidenceSentence(conceptView),
      formula: {
        id: conceptView.defined_by_formula_id,
        label: conceptView.supporting_formula_label,
        latex: conceptView.supporting_formula_latex,
        section: conceptView.formula_section || formula?.section,
      },
      prerequisiteConcepts: toConceptDetailReferences(conceptView.prerequisite_concepts, language),
      successorConcepts: toConceptDetailReferences(conceptView.successor_concepts || [], language),
      language,
    })
      .then((value) => {
        if (!cancelled) setConceptDetailState({ key, status: 'ready', value });
      })
      .catch(() => {
        if (!cancelled) setConceptDetailState({ key, status: 'error', value: null });
      });
    return () => {
      cancelled = true;
    };
  }, [conceptView, formula?.section, isChapterGraph, isConceptMapMode, language]);

  useEffect(() => {
    if (!isChapterGraph || studyContext.type !== 'chapter') {
      setChapterOverviewState({ key: '', status: 'idle', value: null });
      return;
    }
    const chapter = studyContext.chapter;
    const key = `${chapter.chapter_id}:${language}:chapter-overview`;
    let cancelled = false;
    setChapterOverviewState((current) => ({
      key,
      status: 'loading',
      value: current.key === key ? current.value : null,
    }));
    generateChapterOverview({
      chapterId: chapter.chapter_id,
      chapterTitle: formatChapterTitle({
        chapterId: chapter.chapter_id,
        chapter: chapter.chapter,
        titleEn: chapter.title_en,
        titleZh: chapter.title_zh,
        language,
      }),
      chapterDescription: formatChapterDescription({
        chapterId: chapter.chapter_id,
        chapter: chapter.chapter,
        descriptionEn: chapter.description_en,
        descriptionZh: chapter.description_zh,
        formulaCount: chapter.full_formula_ids.length,
        sectionHint: chapter.section_hint,
        language,
      }),
      formulas: chapterOverviewFormulas,
      language,
    })
      .then((value) => {
        if (!cancelled) setChapterOverviewState({ key, status: 'ready', value });
      })
      .catch(() => {
        if (!cancelled) setChapterOverviewState({ key, status: 'error', value: null });
      });
    return () => {
      cancelled = true;
    };
  }, [chapterOverviewFormulas, isChapterGraph, language, studyContext]);

  useEffect(() => {
    if (!isConceptMapMode || studyContext.type !== 'chapter') {
      setConceptMapOverviewState({ key: '', status: 'idle', viewCount: 0, relationCount: 0 });
      return;
    }
    const chapterId = studyContext.chapter.chapter_id;
    let cancelled = false;
    setConceptMapOverviewState((current) => ({
      key: chapterId,
      status: current.key === chapterId && current.viewCount ? 'ready' : 'loading',
      viewCount: current.key === chapterId ? current.viewCount : 0,
      relationCount: current.key === chapterId ? current.relationCount : 0,
    }));
    loadConceptChapter(chapterId)
      .then((graph) => {
        if (cancelled) return;
        setConceptMapOverviewState({
          key: chapterId,
          status: graph ? 'ready' : 'error',
          viewCount: graph?.views.length || 0,
          relationCount: graph ? countConceptMapRelations(graph) : 0,
        });
      })
      .catch(() => {
        if (!cancelled) setConceptMapOverviewState({ key: chapterId, status: 'error', viewCount: 0, relationCount: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [isConceptMapMode, loadConceptChapter, studyContext]);

  useEffect(() => {
    if (!isChapterGraph || studyContext.type !== 'chapter') {
      setFormulaMapOverviewState({ key: '', status: 'idle', formulaCount: 0, relationCount: 0 });
      return;
    }
    const chapterId = studyContext.chapter.chapter_id;
    let cancelled = false;
    setFormulaMapOverviewState((current) => ({
      key: chapterId,
      status: current.key === chapterId && current.formulaCount ? 'ready' : 'loading',
      formulaCount: current.key === chapterId ? current.formulaCount : studyContext.chapter.full_formula_ids.length,
      relationCount: current.key === chapterId ? current.relationCount : 0,
    }));
    loadChapter(chapterId)
      .then((chapter) => {
        if (cancelled) return;
        setFormulaMapOverviewState({
          key: chapterId,
          status: chapter ? 'ready' : 'error',
          formulaCount: chapter?.formulas.length || studyContext.chapter.full_formula_ids.length,
          relationCount: chapter ? countFormulaMapRelations(chapter) : 0,
        });
      })
      .catch(() => {
        if (!cancelled) setFormulaMapOverviewState({ key: chapterId, status: 'error', formulaCount: studyContext.chapter.full_formula_ids.length, relationCount: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [isChapterGraph, loadChapter, studyContext]);

  return (
    <div className="graph-info-panel">
      <div className="graph-info-panel__hero graph-info-panel__hero--learning-card">
        <p className="graph-info-panel__eyebrow">{isConceptMapMode ? '整章概念图' : isChapterGraph ? copy.chapterGraph : conceptView ? copy.conceptEyebrow : copy.eyebrow}</p>
        <h1>
          {conceptView && !isChapterGraph && !isConceptMapMode ? (
            <RichMathText text={formatConceptTitle(conceptView.name, conceptView.defined_symbol, language)} />
          ) : (
            (isChapterGraph || isConceptMapMode) ? studyContextText?.title || formatChapterLabel(routeChapterId, undefined, language) : formula?.label || `Formula ${formulaNumber}`
          )}
        </h1>
        <p className="graph-info-panel__meta">
          {isConceptMapMode
            ? conceptMapMeta
            : isChapterGraph
            ? formulaMapMeta
            : conceptView
            ? conceptMeta
            : formula
              ? joinMeta([formula.number, formatChapterLabel(formula.chapter_id, formula.chapter, language)])
              : `Formula ${formulaNumber}`}
        </p>
        {story ? <p className="graph-info-panel__origin">Storyline: {storyTitle}</p> : null}
        <div className="graph-info-panel__metadata-row">
          <div className="graph-info-panel__language-toggle" aria-label="公式旁注语言">
            <button type="button" className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>
              {copy.languageEnglish}
            </button>
            <button type="button" className={language === 'zh' ? 'active' : ''} onClick={() => setLanguage('zh')}>
              {copy.languageChinese}
            </button>
          </div>
        </div>
      </div>

      {conceptView && !isChapterGraph ? (
        <section className="graph-info-panel__section graph-info-panel__section--concept-detail">
          <div className="graph-info-panel__copy-block graph-info-panel__copy-block--concept-definition">
            <div className="graph-info-panel__copy-heading">
              <span>{copy.conceptDefinition}</span>
              {conceptDetailState.status === 'loading' ? <small>{copy.loading}</small> : null}
              {conceptDetailState.status === 'ready' ? <small>{copy.source}</small> : null}
              {conceptDetailState.status === 'error' ? <small>{copy.fallback}</small> : null}
            </div>
            <div className="graph-info-panel__concept-reading-list">
              <p><RichMathText text={conceptReading} /></p>
            </div>
          </div>
        </section>
      ) : null}

      {!isChapterGraph && !isConceptMapMode && !conceptView ? (
        <section className="graph-info-panel__section graph-info-panel__section--primary graph-info-panel__section--what-it-says">
          <div className="graph-info-panel__copy-block graph-info-panel__copy-block--takeaway">
            <div className="graph-info-panel__copy-heading">
              <span>{copy.plain}</span>
              {llmState.status === 'loading' ? <small>{copy.loading}</small> : null}
              {llmState.status === 'ready' ? <small>{copy.source}</small> : null}
              {llmState.status === 'error' ? <small>{copy.fallback}</small> : null}
            </div>
            <p><RichMathText text={learningCopy.plainMeaning || learningCopy.takeaway} /></p>
          </div>
        </section>
      ) : null}

      {isConceptMapMode && studyContext.type === 'chapter' ? (
        <section className="graph-info-panel__section graph-info-panel__section--chapter-overview graph-info-panel__section--concept-map-overview">
          <div className="graph-info-panel__copy-heading graph-info-panel__copy-heading--overview">
            <span>概念图谱导读</span>
            {conceptMapOverviewState.status === 'loading' ? <small>{copy.loading}</small> : null}
            {conceptMapOverviewState.status === 'error' ? <small>{copy.fallback}</small> : null}
          </div>
          <p><RichMathText text={conceptMapOverviewText} /></p>
        </section>
      ) : null}

      {isChapterGraph && studyContext.type === 'chapter' ? (
        <section className="graph-info-panel__section graph-info-panel__section--chapter-overview">
          <div className="graph-info-panel__copy-heading graph-info-panel__copy-heading--overview">
            <span>章节导读</span>
            {chapterOverviewState.status === 'loading' ? <small>{copy.loading}</small> : null}
            {chapterOverviewState.status === 'ready' ? <small>{copy.source}</small> : null}
            {chapterOverviewState.status === 'error' ? <small>{copy.fallback}</small> : null}
          </div>
          <p><RichMathText text={chapterOverviewText} /></p>
        </section>
      ) : null}

    </div>
  );
}
