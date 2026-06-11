import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, ChevronLeft } from 'lucide-react';
import type { FormulaDataState } from '../features/learning/useFormulaData';
import { SearchBar } from '../features/search/SearchBar';
import { StarField } from '../features/starfield/StarField';
import { buildFormulaStarNodes, type StarNode } from '../features/starfield/starNavigation';
import { getChapterById, resolveRecommendedChapterFormulaId } from '../features/learning/learningNavigator';
import { DEFAULT_LANGUAGE, formatChapterLabel, getUiCopy } from '../shared/utils/uiCopy';

function entryHint(index: number, isRecommended: boolean): string {
  if (isRecommended) return '推荐先从这里进入：它最适合作为本章公式网络的第一颗锚点。';
  if (index === 0) return '这一式通常承担开场定义，适合先用来熟悉本章符号。';
  if (index <= 2) return '这一式能把前面的符号放进推导关系里，适合顺着主线继续读。';
  return '当你已经掌握前几步后，再用这一式检查本章的延伸关系。';
}

interface ChapterPageProps {
  data: FormulaDataState;
}

export function ChapterPage({ data }: ChapterPageProps) {
  const { chapterId = '' } = useParams();
  const navigate = useNavigate();
  const copy = getUiCopy(DEFAULT_LANGUAGE);
  const chapter = useMemo(() => getChapterById(data.chapterNavigator, chapterId), [chapterId, data.chapterNavigator]);
  const formulaNodes = useMemo(
    () => (chapter ? buildFormulaStarNodes({ chapter, searchIndex: data.searchIndex, featured: data.featured }) : []),
    [chapter, data.featured, data.searchIndex],
  );
  const startingNodes = useMemo(() => formulaNodes.filter((node) => node.isBackbone).slice(0, 8), [formulaNodes]);
  const recommendedFormulaId = useMemo(
    () => (chapter ? resolveRecommendedChapterFormulaId(chapter, data.searchIndex) : null),
    [chapter, data.searchIndex],
  );

  const enterNode = (node: StarNode) => {
    if (node.kind === 'formula') {
      const entry = node.isBackbone ? '&entry=chapter' : '';
      navigate(`/graph/${node.id}?study=chapter&chapterId=${chapterId}&layer=backbone${entry}`);
    }
  };
  const enterRecommendedFormula = () => {
    if (recommendedFormulaId) navigate(`/graph/${recommendedFormulaId}?study=chapter&chapterId=${chapterId}&layer=backbone&entry=chapter`);
  };
  const entryPanel = chapter ? (
    <>
      <div className="chapter-entry-panel__header">
        <p>{copy.chapter.entryPoints}</p>
        <span>{chapter.backbone_formula_ids.length} {copy.chapter.roots}</span>
      </div>
      <div className="chapter-entry-panel__list">
        {startingNodes.map((node, index) => (
          <button key={node.id} type="button" onClick={() => (node.id === recommendedFormulaId ? enterRecommendedFormula() : enterNode(node))} className="chapter-entry-panel__item">
            <span className="chapter-entry-panel__number">{String(index + 1).padStart(2, '0')}</span>
            <span className="chapter-entry-panel__content">
              <strong>{node.label}</strong>
              <span>{node.title}</span>
              <em>{entryHint(index, node.id === recommendedFormulaId)}</em>
            </span>
            <ArrowRight size={16} className="text-cyan-500/40" />
          </button>
        ))}
      </div>
    </>
  ) : null;

  return (
    <section className="chapter-shell relative min-h-screen w-full overflow-y-auto overflow-x-hidden bg-[#02040a] text-white font-['Space_Grotesk'] lg:h-screen lg:overflow-hidden">
      <StarField nodes={formulaNodes} visible={Boolean(chapter)} onEnterNode={enterNode} rightReserveClassName="chapter-starfield-reserve" />

      {/* HUD Elements */}
      <div className="pointer-events-none absolute inset-0 z-20 border-[24px] border-white/[0.01]" />
      <div className="pointer-events-none absolute left-10 top-10 z-20 h-4 w-4 border-l-2 border-t-2 border-cyan-500/30" />
      <div className="pointer-events-none absolute right-10 top-10 z-20 h-4 w-4 border-r-2 border-t-2 border-cyan-500/30" />
      <div className="pointer-events-none absolute bottom-10 left-10 z-20 h-4 w-4 border-b-2 border-l-2 border-cyan-500/30" />
      <div className="pointer-events-none absolute bottom-10 right-10 z-20 h-4 w-4 border-b-2 border-r-2 border-cyan-500/30" />

      <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(90deg,rgba(2,4,10,0.78)_0%,transparent_42%,rgba(2,4,10,0.18)_100%),linear-gradient(180deg,rgba(2,4,10,0.2)_0%,transparent_40%,rgba(2,4,10,0.8)_100%)]" />

      <div className="chapter-topbar absolute left-10 top-10 z-40 flex items-center gap-6 animate-[fadeSlideUp_0.8s_ease_both]">
        <Link to="/" className="chapter-back-button" aria-label={copy.chapter.backToHome}>
          <ChevronLeft size={22} />
        </Link>
        <div className="chapter-topbar__search w-[320px]">
          <SearchBar searchIndex={data.searchIndex} conceptIndex={data.conceptIndex} chapterNavigator={data.chapterNavigator} size="compact" />
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-12 left-10 z-20 max-w-2xl pr-6 md:left-14 md:bottom-14">
        <div className="flex items-center gap-3 mb-4 animate-[fadeSlideUp_0.7s_ease_0.1s_both]">
          <span className="h-[1px] w-8 bg-cyan-500/50" />
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-400/80">
            {chapter ? formatChapterLabel(chapter.chapter_id, chapter.chapter) : copy.chapter.fallbackTitle}
          </p>
        </div>
        <h1 className="text-balance text-5xl font-bold leading-[1.1] tracking-tight text-white md:text-7xl animate-[fadeSlideUp_0.7s_ease_0.25s_both]">
          {chapter?.title_zh || chapter?.title_en.replace(' Formula Navigator', '') || copy.chapter.fallbackTitle}
        </h1>
        <p className="mt-7 max-w-lg text-lg leading-relaxed text-slate-400 animate-[fadeSlideUp_0.7s_ease_0.45s_both]">
          {chapter ? chapter.description_zh || copy.chapter.description : copy.chapter.fallbackDescription}
        </p>
        {chapter ? (
          <div className="mt-10 flex flex-wrap gap-4 text-xs font-bold tracking-widest uppercase text-slate-500 animate-[fadeSlideUp_0.7s_ease_0.65s_both]">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/5 bg-white/[0.03] backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
              <span>{formulaNodes.length} {copy.chapter.nodesDiscovered}</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-cyan-500/10 bg-cyan-500/[0.03] text-cyan-400/90 backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
              <span>{chapter.backbone_formula_ids.length} {copy.chapter.backboneRoots}</span>
            </div>
          </div>
        ) : null}
      </div>

      {chapter ? (
        <aside className="chapter-entry-panel absolute right-10 top-10 z-30 hidden w-[380px] lg:block animate-[fadeSlideUp_0.8s_ease_both]">
          {entryPanel}
        </aside>
      ) : null}

      {chapter ? (
        <aside className="chapter-entry-panel chapter-entry-panel--mobile relative z-30 mx-4 mb-6 mt-[760px] lg:hidden">
          {entryPanel}
        </aside>
      ) : null}
    </section>
  );
}
