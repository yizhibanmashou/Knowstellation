import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { FormulaLearningCopyPayload, FormulaPrerequisite, SearchFormula, StorylineEntry } from '../../types/formula';
import type { LanguageCode, StudyContext } from '../../types/learning';
import { useDependencyGraph } from '../../hooks/useDependencyGraph';
import { generateChapterOverview, generateFormulaNotes, type ChapterOverviewResponse, type FormulaNoteResponse } from '../../services/llmClient';
import { rawFormulaNumber } from '../../utils/constants';
import { buildReadableFormulaCopy } from '../../utils/formulaInfo';
import { DEFAULT_LANGUAGE, formatChapterLabel, formatSectionLabel, getUiCopy, joinMeta } from '../../utils/uiCopy';
import { MathFormula } from '../common/MathFormula';
import { RichMathText } from '../common/RichMathText';

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

export function GraphInfoPanel({ searchIndex, formulaLearningCopy, studyContext, storylines }: GraphInfoPanelProps) {
  const { focusFormulaId = '', chapterId: routeChapterId = '' } = useParams();
  const [params] = useSearchParams();
  const { loadChapter } = useDependencyGraph();
  const [language, setLanguage] = useState<LanguageCode>(DEFAULT_LANGUAGE);
  const [selectedFormulaId, setSelectedFormulaId] = useState(focusFormulaId);
  const [prerequisites, setPrerequisites] = useState<FormulaPrerequisite[]>([]);
  const [prerequisitesLoadedFor, setPrerequisitesLoadedFor] = useState('');
  const [llmState, setLlmState] = useState<LlmFormulaState>({ key: '', status: 'idle', value: null });
  const [chapterOverviewState, setChapterOverviewState] = useState<LlmChapterState>({ key: '', status: 'idle', value: null });
  const lookup = useMemo(() => new Map(searchIndex.map((item) => [item.id, item])), [searchIndex]);

  useEffect(() => {
    setSelectedFormulaId(focusFormulaId);
  }, [focusFormulaId]);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ formulaId?: string }>).detail;
      if (detail?.formulaId) setSelectedFormulaId(detail.formulaId);
    };
    window.addEventListener('litgraph:formula-details', listener);
    return () => window.removeEventListener('litgraph:formula-details', listener);
  }, []);

  const formula = lookup.get(selectedFormulaId) || lookup.get(focusFormulaId);
  const formulaNumber = rawFormulaNumber(formula?.id || focusFormulaId);
  const copy = getUiCopy(language).graph.info;
  const studyContextText = getStudyContextText(studyContext, language);
  const isChapterGraph = Boolean(routeChapterId && !focusFormulaId);
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
  const explorableSymbols = useMemo(
    () =>
      prerequisites
        .filter((item) => item.type === 'variable_definition' && (item.edge_status ?? 'accepted') === 'accepted' && item.symbol)
        .slice(0, 5),
    [prerequisites],
  );

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
        <p className="graph-info-panel__eyebrow">{isChapterGraph ? copy.chapterGraph : copy.eyebrow}</p>
        <h1>{isChapterGraph ? studyContextText?.title || formatChapterLabel(routeChapterId, undefined, language) : formula?.label || `Formula ${formulaNumber}`}</h1>
        <p className="graph-info-panel__meta">
          {formula ? joinMeta([formula.number, formatChapterLabel(formula.chapter_id, formula.chapter, language), formatSectionLabel(formula.section, language)]) : `Formula ${formulaNumber}`}
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

      {!isChapterGraph ? (
        <section className="graph-info-panel__section graph-info-panel__section--primary graph-info-panel__section--what-it-says">
          <h2>公式整体读法</h2>
          <div className="graph-info-panel__copy-block">
            <div className="graph-info-panel__copy-heading">
              <span>{copy.plain}</span>
              {llmState.status === 'loading' ? <small>{copy.loading}</small> : null}
              {llmState.status === 'ready' ? <small>{copy.source}</small> : null}
              {llmState.status === 'error' ? <small>{copy.fallback}</small> : null}
            </div>
            <p><RichMathText text={learningCopy.plainMeaning} /></p>
          </div>
          <div className="graph-info-panel__copy-block graph-info-panel__copy-block--takeaway">
            <div className="graph-info-panel__copy-heading">
              <span>一眼看懂</span>
            </div>
            <p><RichMathText text={learningCopy.takeaway} /></p>
          </div>
          <div className="graph-info-panel__copy-block">
            <div className="graph-info-panel__copy-heading">
              <span>{copy.chapter}</span>
            </div>
            <p><RichMathText text={learningCopy.inThisChapter} /></p>
          </div>
          <div className="graph-info-panel__copy-block">
            <div className="graph-info-panel__copy-heading">
              <span>下一步读法</span>
            </div>
            <p><RichMathText text={learningCopy.nextAction} /></p>
          </div>
          <div className="graph-info-panel__copy-block graph-info-panel__copy-block--local-focus">
            <div className="graph-info-panel__copy-heading">
              <span>局部精读</span>
            </div>
            <p>扫过公式本体里的蓝色高亮区域，可以直接看单个符号、括号组合或整式片段在当前公式中的含义。</p>
            {explorableSymbols.length ? (
              <div className="graph-info-panel__symbol-strip" aria-label="可精读符号">
                {explorableSymbols.map((item) => (
                  <span key={`${item.symbol}:${item.sense_id || item.meaning || item.definition || ''}`}>
                    <MathFormula latex={item.symbol || ''} inline />
                  </span>
                ))}
              </div>
            ) : null}
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
