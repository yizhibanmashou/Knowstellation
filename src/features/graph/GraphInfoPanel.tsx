import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { ConceptReference, ConceptView } from '../../shared/types/conceptGraph';
import type { FormulaLearningCopyPayload, FormulaPrerequisite, SearchFormula, StorylineEntry } from '../../shared/types/formula';
import type { LanguageCode, StudyContext } from '../../shared/types/learning';
import { useDependencyGraph } from './useDependencyGraph';
import { generateChapterOverview, generateFormulaNotes, type ChapterOverviewResponse, type FormulaNoteResponse } from '../../shared/services/llmClient';
import { rawFormulaNumber } from '../../shared/utils/constants';
import { buildReadableFormulaCopy } from './formulaInfo';
import { DEFAULT_LANGUAGE, formatChapterLabel, formatSectionLabel, getUiCopy, joinMeta } from '../../shared/utils/uiCopy';
import { MathFormula } from '../../shared/components/MathFormula';
import { RichMathText } from '../../shared/components/RichMathText';

interface GraphInfoPanelProps {
  searchIndex: SearchFormula[];
  formulaLearningCopy: FormulaLearningCopyPayload['items'];
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

function getStudyContextText(studyContext: StudyContext, language: LanguageCode) {
  if (studyContext.type === 'chapter') {
    return {
      title: language === 'zh' ? studyContext.chapter.title_zh : studyContext.chapter.title_en,
      description: language === 'zh' ? studyContext.chapter.description_zh : studyContext.chapter.description_en,
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

interface ConceptReferenceListProps {
  title: string;
  layer: string;
  items: ConceptReference[];
  empty: string;
  more: (count: number) => string;
}

function ConceptReferenceList({ title, layer, items, empty, more }: ConceptReferenceListProps) {
  const visibleItems = items.slice(0, 8);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);

  return (
    <details className="graph-info-panel__copy-block graph-info-panel__copy-block--concept-layer">
      <summary className="graph-info-panel__copy-heading">
        <span className="graph-info-panel__summary-label">{title}</span>
        <small>{layer}</small>
        <small>{items.length}</small>
      </summary>
      {items.length ? (
        <div className="graph-info-panel__concept-reference-list">
          {visibleItems.map((item) => {
            const symbol = item.symbol || item.via_symbol || '';
            const definition = item.definition_zh || item.definition || '';
            return (
              <article
                className="graph-info-panel__concept-reference"
                key={`${item.concept_id || item.name}:${item.defined_by_formula_id || item.from_formula_id || symbol}`}
              >
                <div className="graph-info-panel__concept-reference-header">
                  <strong><RichMathText text={item.name} /></strong>
                  <small>{item.formula_label}</small>
                </div>
                {symbol ? (
                  <div className="graph-info-panel__concept-reference-symbol">
                    <MathFormula latex={symbol} inline />
                  </div>
                ) : null}
                {definition ? <p><RichMathText text={definition} /></p> : null}
              </article>
            );
          })}
          {hiddenCount ? <p className="graph-info-panel__concept-layer-more">{more(hiddenCount)}</p> : null}
        </div>
      ) : (
        <p className="graph-info-panel__concept-layer-empty">{empty}</p>
      )}
    </details>
  );
}

export function GraphInfoPanel({ searchIndex, formulaLearningCopy, studyContext, storylines }: GraphInfoPanelProps) {
  const { focusFormulaId = '', chapterId: routeChapterId = '' } = useParams();
  const [params] = useSearchParams();
  const { loadChapter } = useDependencyGraph();
  const [language, setLanguage] = useState<LanguageCode>(DEFAULT_LANGUAGE);
  const [selectedFormulaId, setSelectedFormulaId] = useState(focusFormulaId);
  const [selectedConceptView, setSelectedConceptView] = useState<ConceptView | null>(null);
  const [prerequisites, setPrerequisites] = useState<FormulaPrerequisite[]>([]);
  const [prerequisitesLoadedFor, setPrerequisitesLoadedFor] = useState('');
  const [llmState, setLlmState] = useState<LlmFormulaState>({ key: '', status: 'idle', value: null });
  const [chapterOverviewState, setChapterOverviewState] = useState<LlmChapterState>({ key: '', status: 'idle', value: null });
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
  const isChapterGraph = Boolean(routeChapterId && !focusFormulaId);
  const requestedMode = params.get('mode');
  const isConceptMode = !routeChapterId && requestedMode !== 'guided' && requestedMode !== 'explore';
  const conceptView = isConceptMode ? selectedConceptView : null;
  const conceptMeta = conceptView
    ? joinMeta([
        conceptView.supporting_formula_label,
        formatChapterLabel(conceptView.chapter_id, undefined, language),
        formatSectionLabel(conceptView.formula_section, language),
      ])
    : '';
  const chapterOverviewFallback =
    studyContext.type === 'chapter'
      ? language === 'zh'
        ? studyContext.chapter.description_zh
        : studyContext.chapter.description_en
      : studyContextText?.description || '';
  const chapterOverviewText = chapterOverviewState.value?.overview || chapterOverviewFallback;
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
    context: formula?.context,
    latex: formula?.latex_preview,
    chapterTitle:
      studyContext.type === 'chapter'
        ? language === 'zh'
          ? studyContext.chapter.title_zh
          : studyContext.chapter.title_en
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
        context: formula?.context,
        latex: formula?.latex_preview,
        chapterTitle:
          studyContext.type === 'chapter'
            ? language === 'zh'
              ? studyContext.chapter.title_zh
              : studyContext.chapter.title_en
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
    if (!formula?.id || isChapterGraph) {
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
  }, [formula?.chapter_id, formula?.id, isChapterGraph, loadChapter]);

  useEffect(() => {
    if (!formula?.id || isChapterGraph) {
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
  }, [formula?.context, formula?.id, formula?.latex_preview, formula?.section, isChapterGraph, language, prerequisites, prerequisitesLoadedFor]);

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
      chapterTitle: language === 'zh' ? chapter.title_zh : chapter.title_en,
      chapterDescription: language === 'zh' ? chapter.description_zh : chapter.description_en,
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

  return (
    <div className="graph-info-panel">
      <div className="graph-info-panel__hero graph-info-panel__hero--learning-card">
        <p className="graph-info-panel__eyebrow">{isChapterGraph ? copy.chapterGraph : conceptView ? copy.conceptEyebrow : copy.eyebrow}</p>
        <h1>
          {conceptView && !isChapterGraph ? (
            <RichMathText text={conceptView.name} />
          ) : (
            isChapterGraph ? studyContextText?.title || formatChapterLabel(routeChapterId, undefined, language) : formula?.label || `Formula ${formulaNumber}`
          )}
        </h1>
        <p className="graph-info-panel__meta">
          {conceptView
            ? conceptMeta
            : formula
              ? joinMeta([formula.number, formatChapterLabel(formula.chapter_id, formula.chapter, language), formatSectionLabel(formula.section, language)])
              : `Formula ${formulaNumber}`}
        </p>
        {story ? <p className="graph-info-panel__origin">来自故事线：{storyTitle}</p> : null}
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
          <div className="graph-info-panel__concept-symbol">
            <span>{copy.conceptSymbol}</span>
            <div>
              <MathFormula latex={conceptView.defined_symbol} inline />
            </div>
          </div>
          <div className="graph-info-panel__copy-block graph-info-panel__copy-block--concept-definition">
              <div className="graph-info-panel__copy-heading">
                <span>{copy.conceptDefinition}</span>
            </div>
            <p><RichMathText text={conceptView.definition_zh || conceptView.definition} /></p>
          </div>
          <ConceptReferenceList
            title={copy.prerequisiteConcepts}
            layer={language === 'zh' ? '第 1 层前置' : 'Layer 1'}
            items={conceptView.prerequisite_concepts}
            empty={language === 'zh' ? '当前概念没有可展开的前置概念。' : 'No prerequisite concepts are available for this concept.'}
            more={(count) => language === 'zh' ? `还有 ${count} 个同层概念，可在画布中继续按层展开查看。` : `${count} more same-layer concepts are available on the canvas.`}
          />
          <ConceptReferenceList
            title={copy.introducedConcepts}
            layer={language === 'zh' ? '第 2 层本式符号' : 'Layer 2'}
            items={conceptView.introduced_concepts}
            empty={language === 'zh' ? '当前公式没有额外的本式符号需要展开。' : 'No additional formula symbols need to be expanded here.'}
            more={(count) => language === 'zh' ? `还有 ${count} 个同层概念，可在画布中继续按层展开查看。` : `${count} more same-layer concepts are available on the canvas.`}
          />
          <details className="graph-info-panel__copy-block graph-info-panel__copy-block--formula-evidence">
            <summary className="graph-info-panel__copy-heading">
              <span>{copy.supportingFormula}已折叠</span>
              <small>{conceptView.supporting_formula_label}</small>
            </summary>
            <MathFormula latex={conceptView.supporting_formula_latex} />
          </details>
        </section>
      ) : null}

      {!isChapterGraph && !conceptView ? (
        <section className="graph-info-panel__section graph-info-panel__section--primary graph-info-panel__section--what-it-says">
          <h2>公式整体读法</h2>
          <div className="graph-info-panel__copy-block graph-info-panel__copy-block--takeaway">
            <div className="graph-info-panel__copy-heading">
              <span>一眼看懂</span>
              {llmState.status === 'loading' ? <small>{copy.loading}</small> : null}
              {llmState.status === 'ready' ? <small>{copy.source}</small> : null}
              {llmState.status === 'error' ? <small>{copy.fallback}</small> : null}
            </div>
            <p><RichMathText text={learningCopy.takeaway} /></p>
          </div>
          <div className="graph-info-panel__copy-block graph-info-panel__copy-block--reading-order">
            <div className="graph-info-panel__copy-heading">
              <span>读法顺序</span>
            </div>
            <p><RichMathText text={learningCopy.nextAction} /></p>
          </div>
          <div className="graph-info-panel__copy-block">
            <div className="graph-info-panel__copy-heading">
              <span>{copy.chapter}</span>
            </div>
            <p><RichMathText text={learningCopy.inThisChapter} /></p>
          </div>
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

      {studyContextText && !isChapterGraph ? (
        <section className="graph-info-panel__section graph-info-panel__section--study-context">
          <h2>{copy.context}</h2>
          <p>
            <strong>{studyContextText.title}</strong>
          </p>
          <p><RichMathText text={studyContextText.description} /></p>
        </section>
      ) : null}
    </div>
  );
}
