import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, Network } from 'lucide-react';
import type { FormulaDataState } from '../hooks/useFormulaData';
import type { ChapterDependencies, ChapterFormula, StorylineStep } from '../types/formula';
import { useDependencyGraph } from '../hooks/useDependencyGraph';
import { useGraphStore } from '../stores/graphStore';
import { MathFormula } from '../components/common/MathFormula';
import { RichMathText } from '../components/common/RichMathText';
import { generateStorylineNarrative, type StorylineNarrativeResponse } from '../services/llmClient';
import { formulaChapter, rawFormulaNumber } from '../utils/constants';
import { buildReadableFormulaCopy } from '../utils/formulaInfo';
import {
  buildNarrativeBridge,
  buildStorylineNextStepText,
  buildStorylineRoleText,
  buildStorylineTransitionText,
} from '../utils/storylineLearningCopy';
import { DEFAULT_LANGUAGE, formatChapterLabel, formatSectionLabel, getUiCopy } from '../utils/uiCopy';
import './StorylinePage.css';

interface StorylinePageProps {
  data: FormulaDataState;
}

interface FormulaRelations {
  chapter: ChapterDependencies | null;
  formula: ChapterFormula | null;
}

interface NarrativeState {
  key: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  value: StorylineNarrativeResponse | null;
}

const EMPTY_RELATIONS: FormulaRelations = {
  chapter: null,
  formula: null,
};

export function StorylinePage({ data }: StorylinePageProps) {
  const copy = getUiCopy(DEFAULT_LANGUAGE).storyline;
  const { storylineId = '' } = useParams();
  const navigate = useNavigate();
  const { loadChapter } = useDependencyGraph();
  const learnedByChapter = useGraphStore((state: ReturnType<typeof useGraphStore.getState>) => state.learnedByChapter);
  const markLearned = useGraphStore((state: ReturnType<typeof useGraphStore.getState>) => state.markLearned);
  const storyline = useMemo(() => data.storylines.find((item) => item.id === storylineId), [data.storylines, storylineId]);
  const searchLookup = useMemo(() => new Map(data.searchIndex.map((item) => [item.id, item])), [data.searchIndex]);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [relations, setRelations] = useState<FormulaRelations>(EMPTY_RELATIONS);
  const [narrativeState, setNarrativeState] = useState<NarrativeState>({ key: '', status: 'idle', value: null });

  useEffect(() => {
    setSelectedId(storyline?.steps[0]?.formula_id || '');
  }, [storyline]);

  useEffect(() => {
    if (!storyline) return;
    const chapterIds = new Set(storyline.steps.map((step) => searchLookup.get(step.formula_id)?.chapter_id || formulaChapter(step.formula_id)));
    chapterIds.forEach((chapterId) => {
      void loadChapter(chapterId);
    });
  }, [loadChapter, searchLookup, storyline]);

  useEffect(() => {
    if (!selectedId) {
      setRelations(EMPTY_RELATIONS);
      return;
    }
    let cancelled = false;
    const chapterId = searchLookup.get(selectedId)?.chapter_id || formulaChapter(selectedId);
    loadChapter(chapterId)
      .then((chapter) => {
        if (cancelled) return;
        if (!chapter) {
          setRelations(EMPTY_RELATIONS);
          return;
        }
        const formula = chapter.formulas.find((item) => item.id === selectedId) || null;
        setRelations({ chapter, formula });
      })
      .catch(() => {
        if (!cancelled) setRelations(EMPTY_RELATIONS);
      });
    return () => {
      cancelled = true;
    };
  }, [loadChapter, searchLookup, selectedId]);

  const selectedStep = storyline?.steps.find((step) => step.formula_id === selectedId) || storyline?.steps[0];
  const selectedIndex = storyline && selectedStep ? storyline.steps.findIndex((step) => step.formula_id === selectedStep.formula_id) : -1;
  const previousStep = selectedIndex > 0 ? storyline?.steps[selectedIndex - 1] : null;
  const nextStep = storyline && selectedIndex >= 0 ? storyline.steps[selectedIndex + 1] || null : null;
  const selectedSearch = selectedStep ? searchLookup.get(selectedStep.formula_id) : undefined;
  const selectedFormula = relations.formula;
  const selectedChapterId = selectedSearch?.chapter_id || selectedFormula?.chapter_id || (selectedStep ? formulaChapter(selectedStep.formula_id) : '');
  const selectedLatex = selectedFormula?.latex || selectedSearch?.latex_preview || '';
  const selectedFormulaSignature = buildFormulaSignatureLatex(selectedLatex);
  const selectedLearned = Boolean(selectedStep && learnedByChapter[selectedChapterId]?.has(selectedStep.formula_id));
  const selectedCopy = useMemo(
    () =>
      selectedStep
        ? buildReadableFormulaCopy({
            formulaId: selectedStep.formula_id,
            language: 'zh',
            cache: data.formulaLearningCopy,
            context: selectedSearch?.context,
            latex: selectedLatex,
            chapterTitle: selectedChapterId ? formatChapterLabel(selectedChapterId, selectedSearch?.chapter) : selectedSearch?.section,
            formulaLabel: selectedSearch?.label || selectedStep.title,
            formulaNumber: rawFormulaNumber(selectedStep.formula_id),
            section: formatSectionLabel(selectedSearch?.section),
          })
        : null,
    [data.formulaLearningCopy, selectedChapterId, selectedLatex, selectedSearch?.chapter, selectedSearch?.context, selectedSearch?.label, selectedSearch?.section, selectedStep],
  );

  const fallbackNarrative = useMemo(() => {
    if (!storyline || !selectedStep) return null;
    const selectedContext = selectedSearch?.context || selectedFormula?.context_text || '';
    return {
      role: buildStorylineRoleText({
        storylineId: storyline.id,
        steps: storyline.steps,
        selected: selectedStep,
        symbol: storyline.symbol,
        plainMeaning: selectedCopy?.plainMeaning,
        chapterLabel: formatChapterLabel(selectedChapterId, selectedSearch?.chapter),
        formulaLabel: selectedSearch?.label || selectedStep.title,
        context: selectedContext,
      }),
      transition: buildStorylineTransitionText({
        storylineId: storyline.id,
        steps: storyline.steps,
        selected: selectedStep,
        symbol: storyline.symbol,
        transition: selectedStep.transition_zh || selectedStep.transition_en,
        previousTitle: previousStep?.title,
        plainMeaning: selectedCopy?.plainMeaning,
        context: selectedContext,
      }),
      next: buildStorylineNextStepText({
        storylineId: storyline.id,
        steps: storyline.steps,
        selected: selectedStep,
        symbol: storyline.symbol,
        nextTitle: nextStep ? searchLookup.get(nextStep.formula_id)?.label || nextStep.title : undefined,
      }),
    };
  }, [nextStep, previousStep?.title, searchLookup, selectedChapterId, selectedCopy?.plainMeaning, selectedFormula?.context_text, selectedSearch?.chapter, selectedSearch?.context, selectedSearch?.label, selectedStep, storyline]);
  const isCuratedNarrative = storyline?.id === 'allele-frequency';
  const narrative = isCuratedNarrative ? fallbackNarrative : narrativeState.value || fallbackNarrative;
  const narrativeBridge = narrative ? buildNarrativeBridge(narrative.transition, narrative.next) : '';
  const selectedProgress = storyline && selectedIndex >= 0 ? Math.round(((selectedIndex + 1) / storyline.steps.length) * 100) : 0;

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline || selectedIndex < 0) return;
    const selectedCard = timeline.querySelector<HTMLElement>('.storyline-step--selected');
    if (!selectedCard) return;
    const targetLeft = selectedCard.offsetLeft - (timeline.clientWidth - selectedCard.clientWidth) / 2;
    const maxLeft = timeline.scrollWidth - timeline.clientWidth;
    timeline.scrollTo({
      left: Math.max(0, Math.min(targetLeft, maxLeft)),
      behavior: 'smooth',
    });
  }, [selectedIndex]);

  useEffect(() => {
    if (!storyline || !selectedStep || isCuratedNarrative) {
      setNarrativeState({ key: '', status: 'idle', value: null });
      return;
    }
    const key = `${storyline.id}:${selectedStep.formula_id}:zh:storyline`;
    let cancelled = false;
    setNarrativeState((current) => ({
      key,
      status: 'loading',
      value: current.key === key ? current.value : null,
    }));
    generateStorylineNarrative({
      storyline,
      selectedStep,
      previousStep,
      nextStep,
      formula: {
        id: selectedStep.formula_id,
        latex: selectedLatex,
        context: selectedSearch?.context || selectedFormula?.context_text || '',
        section: selectedSearch?.section || selectedFormula?.section,
        label: selectedSearch?.label || selectedStep.title,
      },
      formulaCopy: selectedCopy,
      language: 'zh',
    })
      .then((value) => {
        if (!cancelled) setNarrativeState({ key, status: 'ready', value });
      })
      .catch(() => {
        if (!cancelled) setNarrativeState({ key, status: 'error', value: null });
      });
    return () => {
      cancelled = true;
    };
  }, [isCuratedNarrative, nextStep, previousStep, selectedCopy, selectedFormula?.context_text, selectedFormula?.section, selectedLatex, selectedSearch?.context, selectedSearch?.label, selectedSearch?.section, selectedStep, storyline]);

  const openGraph = (formulaId = selectedStep?.formula_id) => {
    if (!formulaId || !storyline) return;
    const chapterId = searchLookup.get(formulaId)?.chapter_id || formulaChapter(formulaId);
    navigate(`/graph/${formulaId}?from=storyline&storyline=${storyline.id}&chapterId=${chapterId}`);
  };

  const markSelectedLearned = () => {
    if (!selectedStep || !selectedChapterId) return;
    markLearned(selectedChapterId, selectedStep.formula_id);
  };

  const cleanSymbol = storyline?.symbol.replace(/\\/g, '') || '';
  const identityTitle = storyline?.id === 'allele-frequency' ? '等位基因频率' : storyline?.title_zh || storyline?.title_en || '';
  const identitySubtitle = storyline?.id === 'allele-frequency' ? '从计数到进化变化' : '';

  if (!storyline && (data.loading || data.supplementalLoading)) {
    return (
      <section className="storyline-page storyline-page--empty">
        <div className="storyline-empty">
          <p>{copy.loading}</p>
          <h1>{copy.preparing}</h1>
          <span className="storyline-empty__note">{copy.loadingNote}</span>
        </div>
      </section>
    );
  }

  if (!storyline) {
    return (
      <section className="storyline-page storyline-page--empty">
        <div className="storyline-empty">
          <p>{copy.missing}</p>
          <h1>{copy.missingTitle}</h1>
          <Link to="/">{copy.backHome}</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="storyline-page">
      <aside className="storyline-rail">
        <Link to="/" className="storyline-back">
          <ArrowLeft size={16} />
          {copy.backHome}
        </Link>

        <div className="storyline-identity">
          <div className="storyline-identity__meta">
            <div className="storyline-identity__symbol-card">
              <span>故事线主题</span>
              <MathFormula latex={storyline.symbol} inline className="storyline-identity__symbol" />
            </div>
            <p>{cleanSymbol} 的 {storyline.steps.length} 步旅程</p>
          </div>
          <h1>
            <span>{identityTitle}</span>
            {identitySubtitle ? <strong>{identitySubtitle}</strong> : null}
          </h1>
          <span>{storyline.intro_zh || storyline.intro_en}</span>
        </div>

        {selectedStep ? (
          <div className="storyline-selection">
            <p className="storyline-selection__eyebrow">{copy.selectedFormula}</p>
            <h2>{selectedSearch?.label || selectedStep.title}</h2>
            {selectedCopy?.takeaway ? (
              <div className="storyline-selection__takeaway">
                <span>一眼看懂</span>
                <strong>{selectedCopy.takeaway}</strong>
              </div>
            ) : null}
            <div className="storyline-selection__math">
              {selectedFormulaSignature ? (
                <div className="storyline-selection__formula-focus">
                  <span>公式线索</span>
                  <MathFormula latex={selectedFormulaSignature} inline />
                </div>
              ) : null}
              <details>
                <summary>查看完整公式</summary>
                <MathFormula latex={selectedLatex} />
              </details>
            </div>
            <div className="storyline-selection__copy">
              <span>通俗解释</span>
              <p><RichMathText text={selectedCopy?.plainMeaning} /></p>
            </div>
            <div className="storyline-selection__copy">
              <span>本章作用</span>
              <p><RichMathText text={selectedCopy?.inThisChapter} /></p>
            </div>
            {selectedCopy?.nextAction ? (
              <div className="storyline-selection__copy storyline-selection__copy--action">
                <span>快速读法</span>
                <p><RichMathText text={selectedCopy.nextAction} /></p>
              </div>
            ) : null}
            <div className="storyline-selection__actions">
              <button type="button" className="storyline-mark-learned" onClick={markSelectedLearned} disabled={selectedLearned}>
                <CheckCircle2 size={15} />
                {selectedLearned ? '已读过这一站' : '标记已读'}
              </button>
              {nextStep ? (
                <button type="button" className="storyline-next-step" onClick={() => setSelectedId(nextStep.formula_id)}>
                  下一站 {rawFormulaNumber(nextStep.formula_id)}
                  <ArrowRight size={15} />
                </button>
              ) : null}
            </div>
            <div className="storyline-symbols">
              {(selectedFormula?.symbols_defined?.length ? selectedFormula.symbols_defined : selectedFormula?.symbols_used || []).slice(0, 6).map((symbol) => (
                <MathFormula key={symbol} latex={symbol} inline />
              ))}
            </div>
            <button type="button" className="storyline-open-graph" onClick={() => openGraph()}>
              <Network size={16} />
              {copy.openGraph}
            </button>
          </div>
        ) : null}
      </aside>

      <main className="storyline-main">
        <div className="storyline-main__header">
          <div>
            <p>{copy.routeEyebrow}</p>
            <h2>{copy.routeTitle}</h2>
          </div>
          <button type="button" className="storyline-collapse" onClick={() => openGraph()}>
            <Network size={16} />
            {copy.openCurrentGraph}
          </button>
        </div>

        {selectedStep ? (
          <div className="storyline-reader" aria-label="故事线阅读进度">
            <div className="storyline-reader__topline">
              <span>第 {selectedIndex + 1} / {storyline.steps.length} 站</span>
              <strong>{selectedSearch?.label || selectedStep.title}</strong>
              <small>{selectedProgress}%</small>
            </div>
            <div className="storyline-reader__bar" aria-hidden="true">
              <i style={{ width: `${selectedProgress}%` }} />
            </div>
          </div>
        ) : null}

        <div ref={timelineRef} className="storyline-timeline" role="list" aria-label={`${storyline.title_zh || storyline.title_en} 叙事步骤`}>
          {storyline.steps.map((step, index) => {
            const formula = searchLookup.get(step.formula_id);
            const isSelected = step.formula_id === selectedStep?.formula_id;
            const stepChapterId = formula?.chapter_id || formulaChapter(step.formula_id);
            const stepLearned = Boolean(learnedByChapter[stepChapterId]?.has(step.formula_id));
            const stepLatex = formula?.latex_preview || '';
            return (
              <article
                key={step.formula_id}
                role="listitem"
                className={`storyline-step ${isSelected ? 'storyline-step--selected' : ''} ${stepLearned ? 'storyline-step--learned' : ''} animate-[fadeSlideUp_0.6s_ease_both]`}
                style={{ animationDelay: `${0.1 + index * 0.08}s` } as any}
                onClick={() => setSelectedId(step.formula_id)}
                onDoubleClick={() => openGraph(step.formula_id)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  setSelectedId(step.formula_id);
                }}
                tabIndex={0}
                aria-current={isSelected ? 'step' : undefined}
              >
                <div className="storyline-step__header">
                  <div className="storyline-step__index">{String(index + 1).padStart(2, '0')}</div>
                  <div className="storyline-step__meta">
                    <strong>{rawFormulaNumber(step.formula_id)}</strong>
                    <span>{stepLearned ? '已读' : `第 ${index + 1} 站`}</span>
                  </div>
                  <ArrowRight className="storyline-step__arrow" size={16} />
                </div>
                {stepLatex ? (
                  <div className="storyline-step__formula-main" aria-label="公式本体">
                    <span>公式</span>
                    <MathFormula latex={stepLatex} />
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>

        {selectedStep && narrative ? (
          <section className="storyline-narrative" aria-label="当前公式故事">
            <div className="storyline-narrative__card storyline-narrative__card--primary animate-[fadeSlideUp_0.8s_ease_0.2s_both]">
              <span>{copy.role}</span>
              {!isCuratedNarrative && narrativeState.status === 'loading' ? <small className="block mb-2 text-cyan-500/60 text-[10px] font-bold tracking-widest">{copy.generating}</small> : null}
              {!isCuratedNarrative && narrativeState.status === 'error' ? <small className="block mb-2 text-cyan-500/60 text-[10px] uppercase font-bold tracking-widest">{copy.localNarrative}</small> : null}
              <p><RichMathText text={narrative.role} /></p>
            </div>
            <div className="storyline-narrative__card storyline-narrative__card--bridge animate-[fadeSlideUp_0.8s_ease_0.35s_both]">
              <span>{copy.storyBridge || '故事串联'}</span>
              <p><RichMathText text={narrativeBridge} /></p>
            </div>
          </section>
        ) : null}
      </main>
    </section>
  );
}

function buildFormulaSignatureLatex(latex = ''): string {
  const normalized = latex
    .replace(/\r?\n/g, ' ')
    .replace(/\\begin\{align\*?\}|\\end\{align\*?\}|\\begin\{aligned\}|\\end\{aligned\}/g, '')
    .replace(/&/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const lhs = normalized.split(/=(?!=)/)[0]?.trim();
  return lhs && lhs.length <= 44 ? lhs : '';
}
