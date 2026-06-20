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
        '先浏览本章概念路径，再从无前置公式入口展开公式依赖关系。',
      nodesDiscovered: '个公式节点',
      backboneRoots: '个公式入口',
      entryPoints: '章节入口',
      roots: '个入口',
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
      roots: '个入口',
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
      expand: '展开公式',
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
        concept: '概念视图：从当前概念出发，只展开真实前置概念。',
        formula: 'Formula：在公式内悬停查看符号解释，再展开前置公式或后续公式。',
        explore: 'Formula Map：点击公式，在当前章节里展开它的前置和后续关系。',
        conceptMap: 'Concept Map：查看整章概念网络，点击概念进入局部视图。',
      },
        modes: {
          concept: {
          label: 'Concept',
          description: '以概念为入口查看一跳前置关系',
        },
        formula: {
          label: 'Formula',
          description: '先看符号，再看后续公式',
        },
        guided: {
          label: 'Guided',
          description: '按当前公式的学习路径逐步展开',
        },
        explore: {
          label: 'Formula Map',
          description: '打开章节尺度的关系图',
        },
        conceptMap: {
          label: 'Concept Map',
          description: '打开整章概念关系图',
        },
        locked: '当前入口固定使用对应整章图谱模式。',
      },
      node: {
        actions: '公式展开动作',
        prerequisiteTrigger: '看前置公式',
        successorTrigger: '看后续公式',
        locked: '未解锁',
        start: '根节点',
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
        conceptEyebrow: '概念简介',
        conceptSymbol: '概念符号',
        conceptDefinition: '概念解读',
        prerequisiteConcepts: '前置概念',
        introducedConcepts: '符号说明',
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
      role: 'Backstory',
      transition: '演化轨迹',
      next: '叙事衔接',
      storyBridge: 'But Wait…',
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
        'Start from concept entries to build the terminology map, then use formula roots to expand dependencies.',
      nodesDiscovered: 'nodes',
      backboneRoots: 'formula entries',
      entryPoints: 'Chapter entries',
      roots: 'entries',
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
      missingConcept: 'Concept data is unavailable.',
      dataError: 'Graph data could not be loaded.',
      standalone: 'This formula currently stands alone in the local graph.',
      chapterGraphSuffix: 'full graph',
      hints: {
        concept: 'Concept: start from the current concept and show only real concept prerequisites.',
        formula: 'Formula: hover inside the formula for symbol notes, then expand prerequisite or successor formulas.',
        explore: 'Formula Map: click formulas to expand relationships inside this chapter.',
        conceptMap: 'Concept Map: scan the chapter concept network, then click a concept to open its local view.',
      },
      modes: {
        concept: { label: 'Concept', description: 'Use concepts as the graph entry point' },
        formula: { label: 'Formula', description: 'Symbols first, successors second' },
        explore: { label: 'Formula Map', description: 'Open the chapter-scale formula map' },
        conceptMap: { label: 'Concept Map', description: 'Open the chapter-scale concept map' },
        locked: 'This route uses the matching chapter map mode.',
      },
      node: {
        actions: 'Formula expansion actions',
        prerequisiteTrigger: 'Show prerequisite formulas',
        successorTrigger: 'Show successor formulas',
        locked: 'Locked',
        start: 'Root',
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
        conceptEyebrow: 'Concept brief',
        conceptSymbol: 'Concept symbol',
        conceptDefinition: 'Concept reading',
        prerequisiteConcepts: 'Prerequisites',
        introducedConcepts: 'Symbol notes',
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
      role: 'Backstory',
      transition: 'Transition',
      next: 'Next step',
      storyBridge: 'But Wait…',
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

export function formatChapterTitle(input: {
  chapterId?: string;
  chapter?: number | string;
  titleEn?: string;
  titleZh?: string;
  language?: LanguageCode;
}): string {
  const language = input.language || DEFAULT_LANGUAGE;
  const preferred = language === 'zh' ? input.titleZh : input.titleEn;
  const fallback = language === 'zh' ? input.titleEn : input.titleZh;
  const title = (preferred || fallback || '').replace(/\s+/g, ' ').trim();
  const placeholder = /\b(?:Chapter|Appendix)\s+\d+\s+Formula Navigator\b/i.test(title) || /公式导航$/.test(title);
  if (!placeholder) return title || formatChapterLabel(input.chapterId, input.chapter, language);
  const label = formatChapterLabel(input.chapterId, input.chapter, language);
  return label;
}

export function formatSectionLabel(section?: string, language: LanguageCode = DEFAULT_LANGUAGE): string {
  const value = (section || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (language !== 'zh') return value;

  const normalized = value.toLowerCase();
  const mappings: Array<[RegExp, string]> = [
    [/short[- ]term changes in the mean.*breeder/, '育种者方程与短期响应'],
    [/short[- ]term changes in the mean.*truncation.*threshold/, '截断选择与阈值选择'],
    [/short[- ]term changes in the mean.*permanent.*transient/, '永久响应与暂态响应'],
    [/short[- ]term changes in the mean/, '性状均值的短期变化'],
    [/mutation[- ]drift equilibrium/, '突变-漂变平衡'],
    [/relative power of mutation and genetic drift/, '突变与遗传漂变的相对作用'],
    [/single[- ]locus selection.*two alleles/, '单基因座选择：双等位基因'],
    [/price['’]s general theorem of selection/, 'Price 选择基本定理'],
    [/the behavior of a neutral locus linked to a selected site/, '连锁于被选择位点的中性位点行为'],
    [/short[- ]term changes in the variance.*additive variance/, '方差的短期变化：1. 加性方差的变化'],
    [/short[- ]term changes in the variance.*environmental variance/, '方差的短期变化：2. 环境方差的变化'],
    [/variance in short[- ]term response/, '短期响应中的方差'],
    [/analysis of short[- ]term selection experiments.*mixed[- ]model and bayesian approaches/, '短期选择实验分析：2. 混合模型与贝叶斯方法'],
    [/evolution in natural populations.*target of selection/, '自然种群中的进化：选择的目标'],
    [/theory of expected single[- ]cycle response/, '期望单轮响应理论'],
    [/basic issues in selection response under inbreeding/, '近交下选择响应的基本问题'],
    [/gaussian continuum[- ]of[- ]alleles models/, '高斯连续等位基因模型'],
    [/deterministic single[- ]locus theory/, '确定性单基因座理论'],
    [/long[- ]term response/, '长期响应'],
    [/overview.*maintenance of variation/, '变异维持概览'],
    [/episodes of selection and the assignment of fitness/, '选择事件与适应度分配'],
    [/selection on multivariate phenotypes.*differentials and gradients/, '多变量表型上的选择：选择差与梯度'],
    [/appendix(?:: introduction)?/, '附录导论'],
    [/brief overview.*divergence[- ]based tests|divergence[- ]based tests.*overview/, '基于分化检验概览'],
    [/hka.*mcdonald|mcdonald.*kreitman|kreitman/, 'HKA 与 McDonald-Kreitman 检验'],
    [/estimating parameters.*adaptive evolution|fraction.*adaptive substitutions|adaptive substitutions/, '适应性进化参数估计'],
    [/molecular data.*detect selection|signatures.*historical events|detect selection/, '分子数据中的选择信号'],
    [/allele[- ]frequency change.*single population/, '单群体等位基因频率变化'],
    [/divergence between populations|two[- ]population comparisons/, '群体间分化比较'],
    [/response.*within[- ]population genetic variance.*drift/, '漂变下群体内遗传方差响应'],
    [/neutral divergence.*quantitative traits/, '数量性状的中性分化'],
    [/truncation selection/, '截断选择'],
    [/direct versus associative effects/, '直接效应与关联效应'],
    [/maintenance of variation/, '变异维持概览'],
    [/multivariate phenotypes|differentials and gradients/, '多变量表型选择梯度'],
    [/geometry of vectors and matrices/, '向量与矩阵几何'],
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

export function formatChapterTopic(sectionHint?: string, language: LanguageCode = DEFAULT_LANGUAGE): string {
  return formatSectionLabel(sectionHint, language) || (language === 'zh' ? '本章核心公式网络' : 'the chapter formula network');
}

export function formatChapterDescription(input: {
  chapterId?: string;
  chapter?: number | string;
  descriptionEn?: string;
  descriptionZh?: string;
  formulaCount?: number;
  sectionHint?: string;
  language?: LanguageCode;
}): string {
  const language = input.language || DEFAULT_LANGUAGE;
  const description = (language === 'zh' ? input.descriptionZh : input.descriptionEn) || (language === 'zh' ? input.descriptionEn : input.descriptionZh) || '';
  const normalizedDescription = description.replace(/\s+/g, ' ').trim();
  const generatedPlaceholder =
    /建议先看高亮起始公式/.test(normalizedDescription) ||
    /Start from the highlighted roots/i.test(normalizedDescription) ||
    /包含\s*\d+\s*个公式/.test(normalizedDescription);

  if (language !== 'zh') {
    if (!generatedPlaceholder && normalizedDescription) return normalizedDescription;
    const topic = formatChapterTopic(input.sectionHint, language);
    const count = input.formulaCount ?? 0;
    return `This chapter centers on ${topic} and contains ${count} formulas. Start from concept entry points to build the terminology map, then enter formula roots to expand dependencies.`;
  }

  const topic = formatChapterTopic(input.sectionHint, language);
  const count = input.formulaCount ?? 0;
  if (!generatedPlaceholder && normalizedDescription && !/^[A-Za-z0-9\s:,'().-]+$/.test(normalizedDescription)) {
    return normalizedDescription;
  }
  return `本章主要围绕「${topic}」展开，包含 ${count} 个公式。建议先浏览概念路径，再进入公式入口展开依赖图谱。`;
}

export function joinMeta(parts: Array<string | number | undefined | null>): string {
  return parts.filter((part) => part !== undefined && part !== null && String(part).trim()).join(' · ');
}

export function formatFormulaReferenceLabel(label?: string, language: LanguageCode = DEFAULT_LANGUAGE): string {
  const value = (label || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (language !== 'zh') return value;
  return value.replace(/^Formula\s+/i, '公式 ');
}

function hasMojibake(value: string): boolean {
  return /[\uFFFD]|\u951F\u65A4\u62F7|[\u93C4\u934F\u7ED4\u6769\u95BA\u95C1\u940E\u7943]|[\u9225\u922B\u9241\u9242\u9983]/.test(value);
}

export function formatConceptTitle(title?: string, symbol?: string, language: LanguageCode = DEFAULT_LANGUAGE): string {
  const value = (title || symbol || '').replace(/\s+/g, ' ').trim();
  if (hasMojibake(value)) return (symbol || title || '').replace(/\s+/g, ' ').trim();
  if (!value || language !== 'zh') return value;
  const compactSymbol = (symbol || '').replace(/\s+/g, '');
  const normalized = value.toLowerCase();
  const mappings: Array<[RegExp, string]> = [
    [/^change$/, '变化规则'],
    [/^class fitness$/, '类别适合度'],
    [/^selection coefficient$/, '选择系数'],
    [/^mean trait value$/, '性状均值'],
    [/^mean$/, '均值参数'],
    [/^fitness$/, '适合度'],
    [/^additive genetic variance$/, '加性遗传方差'],
    [/^inbreeding coefficient$/, '近交系数'],
    [/^probability density$/, '概率密度'],
    [/^likelihood$/, '似然函数'],
    [/^expectation$/, '期望值'],
    [/^variance$/, '方差'],
    [/^covariance$/, '协方差'],
    [/^selection differential$/, '选择差'],
    [/^selection gradient$/, '选择梯度'],
    [/^effective population size$/, '有效群体大小'],
    [/^replacement[- ]site polymorphism$/, '替换位点多态性'],
    [/^silent[- ]site polymorphism$/, '沉默位点多态性'],
    [/^replacement[- ]site divergence$/, '替换位点分化'],
    [/^silent[- ]site divergence$/, '沉默位点分化'],
    [/^adaptive substitution/, '适应性替换'],
    [/^neutrality index$/, '中性指数'],
    [/^formula\s+\S+\s+mean$/, '均值参数'],
  ];
  const mapped = mappings.find(([pattern]) => pattern.test(normalized))?.[1];
  if (mapped) return mapped;
  if (/^\\Delta$/.test(compactSymbol)) return '变化量';
  if (/^s$/.test(compactSymbol)) return '选择系数';
  if (/^W$|^\\overline\{?W\}?/.test(compactSymbol)) return '适合度';
  if (/^O$/.test(compactSymbol)) return '生物学对象';
  if (/^[A-Za-z0-9\\_{}^]+$/.test(value)) return value;
  return value;
}
