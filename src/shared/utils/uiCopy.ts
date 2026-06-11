import type { LanguageCode } from '../types/learning';

export const DEFAULT_LANGUAGE: LanguageCode = 'zh';

const UI_COPY = {
  zh: {
    app: {
      subtitle: '知识星构导航系统',
      searchPlaceholder: '搜索公式、章节或主题',
      home: '首页',
      clearSearch: '清空搜索',
      formulaUnavailable: '公式暂时无法渲染',
    },
    home: {
      eyebrow: '书本与论文知识星构',
      intro:
        '把书本与论文转换成可导航的知识星构。从章节星图、公式搜索或叙事线开始，沿着概念、符号和证据理解原始资料。',
      sectors: '章节',
      nodes: '公式',
      paths: '叙事线',
      pathways: '知识路径',
      pathwayIntro:
        '故事线带你跨越章节，追踪核心概念在书本与论文中的演化轨迹。',
      enterStoryline: '进入叙事线',
    },
    chapter: {
      fallbackTitle: '章节暂不可用',
      fallbackDescription: '请回到首页重新选择章节。',
      description:
        '先从推荐起点进入，再逐步展开这个章节中的公式、变量和前置关系。',
      nodesDiscovered: '个公式节点',
      backboneRoots: '个推荐起点',
      entryPoints: '推荐学习起点',
      roots: '个起点',
      backToHome: '返回章节星图',
    },
    search: {
      chapterTag: '章节',
      formulaTag: '公式',
      formulaCount: '个公式',
    },
    navigator: {
      title: '学习导航',
      description: '按章节或主题路线开始学习。',
      byChapter: '按章节',
      byTheme: '按主题',
      chapters: '个章节',
      formulas: '个公式',
      themeRoute: '主题路线',
      startRoute: '开始路线',
      enterChapter: '进入章节星图',
      roots: '个起点',
    },
    formulaCard: {
      eyebrow: '公式',
      chapter: '第 {chapter} 章',
      whatItSays: '这条公式在说什么',
      plain: '通俗解释',
      inChapter: '本章作用',
      openGraph: '打开学习图谱',
      fallbackContext: '这条公式暂时没有可用的教材上下文。',
      close: '关闭公式卡片',
      tooltipEyebrow: '演化公式',
      tooltipHint: '单击查看 · 双击打开图谱',
    },
    graph: {
      panelLabel: '公式',
      home: 'Home',
      expand: 'Expand',
      atlas: '缩略图',
      fullChapter: '全章',
      focus: '焦点',
      nodes: '节点',
      links: '连接',
      dismissHint: '关闭提示',
      fromStoryline: '来自叙事线：',
      emptyChapter: '暂未找到这个章节的公式数据。',
      missingFormula: '没有在当前章节中找到这个公式。',
      missingConcept: '已切换到公式证据视图。',
      dataError: '图谱数据暂时无法加载。',
      standalone: '这个公式目前在本地图谱中没有已确认的前置或后续关系。',
      chapterGraphSuffix: '全章图谱',
      hints: {
        concept: '概念视图：从当前概念出发，先看一跳前置，再看本式符号；公式作为证据保留。',
        guided: '引导学习：先点公式卡片理解符号，再选择看前置概念或后续公式。',
        explore: '自由探索：点击公式，在当前章节里展开它的前置和后续关系。',
      },
      modes: {
        concept: {
          label: 'Concept',
          description: '以概念为入口查看一跳前置关系',
        },
        guided: {
          label: 'Guided',
          description: '先看符号，再看后续公式',
        },
        explore: {
          label: 'Explore',
          description: '打开章节尺度的关系图',
        },
        locked: '整章图谱固定使用自由探索模式。',
      },
      node: {
        actions: '公式展开动作',
        prerequisiteTrigger: '看前置概念',
        successorTrigger: '看后续公式',
        locked: '未解锁',
        start: '起点',
        layer: (depth: number) => `第 ${depth} 层`,
        symbolNotes: '符号精读',
        symbolLoading: '正在生成解释...',
        symbolSource: 'LLM 解释',
        symbolFallback: '本地符号导读',
        symbolEmpty: '这条公式暂时没有识别到可精读的符号。',
        lockedReason: '先学习与它相连的前置公式后解锁。',
        learned: '已学',
      },
      timeline: {
        chapter: '章节顺序',
        theme: '主题路线',
        backbone: '推荐主线',
        full: '完整序列',
        collapse: '收起',
        expand: '展开',
      },
      info: {
        eyebrow: '公式旁注',
        chapterGraph: '整章图谱',
        conceptEyebrow: '概念局部视图',
        conceptSymbol: '概念符号',
        conceptDefinition: '概念解读',
        prerequisiteConcepts: '前置概念',
        introducedConcepts: '本式符号',
        evidence: '证据',
        supportingFormula: '支撑公式',
        plain: '通俗解释',
        chapter: '本章作用',
        context: '上下文',
        selected: '当前公式',
        loading: 'LLM 正在生成这条公式的教材导读...',
        fallback: '本地教材导读',
        source: 'LLM 已更新',
        languageEnglish: 'English',
        languageChinese: '中文',
      },
      edge: {
        uses: '依赖',
      },
      variable: {
        loading: '正在阅读...',
        ready: 'LLM 解释',
      },
    },
    storyline: {
      loading: '正在加载故事线',
      preparing: '正在准备叙事路径。',
      loadingNote: '公式数据和依赖关系正在从本地图谱中读取。',
      missing: '没有找到故事线',
      missingTitle: '换一条叙事路径试试。',
      backHome: '首页',
      steps: '步叙事路线',
      selectedFormula: '当前公式',
      openGraph: '打开图谱',
      routeEyebrow: '符号路线',
      routeTitle: '沿着公式读懂一条思想线',
      openCurrentGraph: '打开当前图谱',
      generating: '正在生成教材导读...',
      localNarrative: '正在使用本地叙事',
      role: '在故事线中的角色',
      transition: '演化轨迹',
      next: '叙事衔接',
      storyBridge: '故事串联',
    },
  },
  en: {
    app: {
      subtitle: 'Knowledge Constellation System',
      searchPlaceholder: 'Search formula, chapter, or topic',
      home: 'Home',
      clearSearch: 'Clear search',
      formulaUnavailable: 'Formula unavailable',
    },
    home: {
      eyebrow: 'Books and Papers as Knowledge Stars',
      intro:
        'Turn dense books and papers into navigable knowledge constellations. Start from a chapter star map, formula search, or storyline, then follow concepts through the source.',
      sectors: 'Sectors',
      nodes: 'Nodes',
      paths: 'Paths',
      pathways: 'Knowledge Pathways',
      pathwayIntro:
        'Storylines trace how core concepts evolve across chapters.',
      enterStoryline: 'Enter storyline',
    },
    chapter: {
      fallbackTitle: 'Chapter unavailable',
      fallbackDescription: 'Return to the home map and choose another chapter.',
      description:
        'Start from a recommended entry point, then expand formulas, variables, and prerequisites in this chapter.',
      nodesDiscovered: 'nodes',
      backboneRoots: 'backbone roots',
      entryPoints: 'Backbone Entry Points',
      roots: 'roots',
      backToHome: 'Back to chapter star map',
    },
    search: {
      chapterTag: 'Chapter',
      formulaTag: 'Formula',
      formulaCount: 'formulas',
    },
    navigator: {
      title: 'Learning Navigator',
      description: 'Choose a chapter or a thematic route.',
      byChapter: 'By Chapter',
      byTheme: 'By Theme',
      chapters: 'chapters',
      formulas: 'formulas',
      themeRoute: 'Theme route',
      startRoute: 'Start route',
      enterChapter: 'Enter chapter star',
      roots: 'roots',
    },
    formulaCard: {
      eyebrow: 'Formula',
      chapter: 'Ch {chapter}',
      whatItSays: 'What it says',
      plain: 'Plain meaning',
      inChapter: 'In this chapter',
      openGraph: 'Open learning graph',
      fallbackContext: 'No textbook context is available for this formula yet.',
      close: 'Close formula card',
      tooltipEyebrow: 'Evolution Formula',
      tooltipHint: 'Click once to inspect · Double-click to open graph',
    },
    graph: {
      panelLabel: 'Formula',
      home: 'Home',
      expand: 'Expand',
      atlas: 'Atlas',
      fullChapter: 'Full chapter',
      focus: 'Focus',
      nodes: 'nodes',
      links: 'links',
      dismissHint: 'Dismiss hint',
      fromStoryline: 'From storyline: ',
      emptyChapter: 'No formulas were found for this chapter.',
      missingFormula: 'This formula was not found in the current chapter.',
      missingConcept: 'Switched to the formula evidence view.',
      dataError: 'Graph data could not be loaded.',
      standalone: 'This formula currently stands alone in the local graph.',
      chapterGraphSuffix: 'full graph',
      hints: {
        concept: 'Concept: start from the current concept, show one-hop prerequisites and formula symbols; formulas stay as evidence.',
        guided: 'Guided: click the formula card first, then choose prerequisites or successors.',
        explore: 'Explore: click formulas to expand relationships inside this chapter.',
      },
      modes: {
        concept: { label: 'Concept', description: 'Use concepts as the graph entry point' },
        guided: { label: 'Guided', description: 'Symbols first, successors second' },
        explore: { label: 'Explore', description: 'Open the chapter-scale relationship map' },
        locked: 'Chapter graphs use Explore mode.',
      },
      node: {
        actions: 'Formula expansion actions',
        prerequisiteTrigger: 'Show prerequisite concepts',
        successorTrigger: 'Show successor formulas',
        locked: 'Locked',
        start: 'Start',
        layer: (depth: number) => `Layer ${depth}`,
        symbolNotes: 'Symbol notes',
        symbolLoading: 'Generating explanation...',
        symbolSource: 'LLM note',
        symbolFallback: 'Local symbol note',
        symbolEmpty: 'No variable notes are available for this formula yet.',
        lockedReason: 'Learn a connected prerequisite formula first to unlock it.',
        learned: 'Learned',
      },
      timeline: {
        chapter: 'Chapter sequence',
        theme: 'Theme route',
        backbone: 'Backbone',
        full: 'Full sequence',
        collapse: 'Collapse',
        expand: 'Expand',
      },
      info: {
        eyebrow: 'Formula margin note',
        chapterGraph: 'Chapter graph',
        conceptEyebrow: 'Concept view',
        conceptSymbol: 'Concept symbol',
        conceptDefinition: 'Concept reading',
        prerequisiteConcepts: 'Prerequisites',
        introducedConcepts: 'Introduced',
        evidence: 'Evidence',
        supportingFormula: 'Supporting formula',
        plain: 'Plain meaning',
        chapter: 'In this chapter',
        context: 'Context',
        selected: 'Selected formula',
        loading: 'Asking the LLM for a formula-specific explanation...',
        fallback: 'LLM is unavailable, showing the local explanation.',
        source: 'LLM refreshed',
        languageEnglish: 'English',
        languageChinese: '中文',
      },
      edge: { uses: 'uses' },
      variable: { loading: 'LLM reading...', ready: 'LLM note' },
    },
    storyline: {
      loading: 'Loading storyline',
      preparing: 'Preparing the narrative path.',
      loadingNote: 'Formula data and dependencies are being read from the local graph.',
      missing: 'Storyline not found',
      missingTitle: 'Try another narrative path.',
      backHome: 'Home',
      steps: 'steps',
      selectedFormula: 'Selected formula',
      openGraph: 'Open graph',
      routeEyebrow: 'Symbol route',
      routeTitle: 'Read one idea through formulas',
      openCurrentGraph: 'Open current graph',
      generating: 'Generating academic insight...',
      localNarrative: 'Using local narrative',
      role: 'Role in this storyline',
      transition: 'Transition',
      next: 'Next step',
      storyBridge: 'Story bridge',
    },
  },
} satisfies Record<LanguageCode, any>;

export function getUiCopy(language: LanguageCode = DEFAULT_LANGUAGE) {
  return UI_COPY[language] || UI_COPY[DEFAULT_LANGUAGE];
}

export function formatChapterLabel(chapterId?: string, fallbackChapter?: number | string, language: LanguageCode = DEFAULT_LANGUAGE): string {
  const fallback = fallbackChapter ? String(fallbackChapter) : '';
  const appendixMatch = chapterId?.match(/^appendix(\d+)$/i);
  if (appendixMatch) return language === 'zh' ? `附录 ${appendixMatch[1]}` : `Appendix ${appendixMatch[1]}`;
  const chapterMatch = chapterId?.match(/^chapter(\d+)$/i);
  if (chapterMatch) return language === 'zh' ? `第 ${chapterMatch[1]} 章` : `Chapter ${chapterMatch[1]}`;
  if (fallback) return language === 'zh' ? `第 ${fallback} 章` : `Chapter ${fallback}`;
  return language === 'zh' ? '章节' : 'Chapter';
}

export function formatSectionLabel(section?: string, language: LanguageCode = DEFAULT_LANGUAGE): string {
  const value = (section || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (language !== 'zh') return value;

  const normalized = value.toLowerCase();
  const mappings: Array<[RegExp, string]> = [
    [/neutral evolution.*two-locus.*introduction/, '中性演化导论'],
    [/wright-fisher/, 'Wright-Fisher 模型'],
    [/selection.*mutation/, '选择与突变'],
    [/single[- ]generation response|breeder/, '单代选择响应'],
    [/neutrality test|hka|mcdonald/, '中性检验'],
    [/polymorphism.*divergence|divergence.*polymorphism/, '多态性与分化'],
    [/coalescent/, '溯祖过程'],
    [/linkage disequilibrium/, '连锁不平衡'],
    [/effective population size|effective size/, '有效群体大小'],
    [/quantitative genetics|additive genetic/, '数量遗传基础'],
  ];
  const mapped = mappings.find(([pattern]) => pattern.test(normalized))?.[1];
  if (mapped) return mapped;

  const beforeColon = value.split(':')[0]?.trim();
  const compact = beforeColon && beforeColon.length < value.length ? beforeColon : value;
  return compact.length > 34 ? `${compact.slice(0, 34).replace(/\s+\S*$/, '')}...` : compact;
}

export function joinMeta(parts: Array<string | number | undefined | null>): string {
  return parts.filter((part) => part !== undefined && part !== null && String(part).trim()).join(' · ');
}
