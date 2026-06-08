import type { ChapterFormula, FeaturedFormula, FormulaDependency, FormulaLearningCopyEntry, FormulaPrerequisite, SearchFormula } from '../types/formula';
import { readBracedGroup, skipWhitespace } from './latexHelpers.ts';

export interface FormulaBrief {
  id: string;
  number: string;
  title: string;
  chapter?: string | number;
  section?: string;
  latex: string;
  shortContext: string;
  longContext: string;
  keySymbols: string[];
  prerequisiteCount: number;
  formulaPrerequisiteCount: number;
  variablePrerequisiteCount: number;
}

export interface FormulaLearningCopy {
  plainMeaning: string;
  inThisChapter: string;
}

export interface ReadableFormulaCopy extends FormulaLearningCopy {
  takeaway: string;
  nextAction: string;
}

export function formulaNumber(formulaId: string): string {
  return formulaId.replace(/^formula_/, '');
}

export function compactContext(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '这条公式暂时没有可用的教材上下文。';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).replace(/\s+\S*$/, '')}…`;
}

interface BuildFormulaLearningCopyInput {
  formulaId?: string;
  language?: 'en' | 'zh';
  cache?: Record<string, FormulaLearningCopyEntry>;
  context?: string;
  latex?: string;
  chapterTitle?: string;
  formulaLabel?: string;
  formulaNumber?: string;
  section?: string;
}

function formulaDisplayName(input: BuildFormulaLearningCopyInput): string {
  return input.formulaLabel?.trim() || (input.formulaNumber ? `Formula ${input.formulaNumber}` : '这条公式');
}

function formulaLocation(input: BuildFormulaLearningCopyInput): string {
  return input.chapterTitle?.trim() || input.section?.trim() || '当前教材片段';
}

function normalizeLatex(value = ''): string {
  return value.replace(/\s+/g, '');
}

function symbolKey(value: string): string {
  return normalizeLatex(value)
    .replace(/_\{([^{}])\}/g, '_$1')
    .replace(/\^\{([^{}])\}/g, '^$1');
}

function cleanContext(value = ''): string {
  return value
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function contextExcerpt(value = '', maxLength = 150): string {
  const cleaned = cleanContext(value);
  if (!cleaned) return '';
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength).replace(/\s+\S*$/, '')}...`;
}

function readableContextHint(value = ''): string {
  const lower = value.toLowerCase();
  if (lower.includes('probability density') || lower.includes('diffusion theory') || lower.includes('hypergeometric')) {
    return '它把等位基因频率的漂变过程读成一条概率密度曲线：给定初始频率 p0 后，计算 t 代后落在某个频率 pt 附近的可能性。';
  }
  if (lower.includes('expected age') || (lower.includes('allele') && lower.includes('older'))) {
    return '它根据当前频率 p 估计中性等位基因已经存在了多久；频率越高，通常说明这条等位基因轨迹经历的时间越长。';
  }
  if (lower.includes('among-population variance') || lower.includes('heterozygosity')) {
    return '它在衡量漂变让不同群体的等位基因频率逐渐分开的速度，并把这种分化同杂合度下降联系起来。';
  }
  if (lower.includes('no directional forces') || lower.includes('neutrality')) {
    return '它表达中性漂变下的“不偏”性质：没有方向性选择时，频率的期望仍停在初始值附近。';
  }
  if (lower.includes('wright-fisher') || lower.includes('binomial')) {
    return '它把 Wright-Fisher 模型里一代抽样的结果写成概率规则，说明当前拷贝数如何随机生成下一代拷贝数。';
  }
  if (lower.includes('polymorphism') && lower.includes('divergence')) {
    return '它把群体内多态性和群体间分化放到同一个中性基准下比较，用来判断观察到的差异是否偏离中性预期。';
  }
  return '';
}

function endSentence(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  return /[。.!?！？]$/.test(trimmed) ? trimmed : `${trimmed}。`;
}

function trimLearningSentence(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return endSentence(normalized);
  const sentence = normalized
    .split(/(?<=[。.!?！？])\s*/)
    .find((item) => item.length >= 18 && item.length <= maxLength);
  if (sentence) return endSentence(sentence);
  return `${normalized.slice(0, maxLength).replace(/\s+\S*$/, '')}…`;
}

function firstUsefulClause(value: string): string {
  const normalized = cleanContext(value);
  if (!normalized) return '';
  const sentence = normalized
    .split(/(?<=[。.!?！？])\s*/)
    .find((item) => item.length > 16) || normalized;
  return trimLearningSentence(sentence, 96);
}

function formulaActionText(input: BuildFormulaLearningCopyInput): string {
  const label = formulaDisplayName(input);
  const latex = normalizeLatex(input.latex);
  const context = (input.context || '').toLowerCase();
  if (latex.includes('\\varphi') && (latex.includes('p_{t}') || context.includes('probability density'))) return '先把它当成 p 的“位置地图”：看清起点 p0、时间 t、终点 pt，再暂时放过长求和细节。';
  if (latex.includes('E(t)=') || context.includes('expected age')) return '先把 p 当成当前频率，再读 E(t) 是“这条中性等位基因大约存在了多久”。';
  if (latex.includes('\\sigma_{p}^{2}') || context.includes('among-population variance')) return '先问不同群体的 p 会散开多宽，再看 2N 和 t 如何控制散开的速度。';
  if (latex.includes('E(p_{t})=p_{0}') || context.includes('no directional forces')) return '先记住这条中性基线：漂变会让单个群体摇晃，但平均方向不偏。';
  if (latex.includes('\\Delta') && latex.includes('p_{i}') && context.includes('frequency of allele')) return '先找出选择强度、等位基因效应和 p_i 的位置，再看选择怎样给频率一个方向。';
  if (latex.includes("p_{j}^{\\prime}") || context.includes('average effect')) return '先把 p_j 和 b_j 看成一对会共同更新的状态量，再看 Price 框架如何拆分变化来源。';
  if (input.latex?.includes('P_{ij}')) return '先把 i、j、2N 和 P_ij 对应到“这一代到下一代”的抽样过程，再展开后继矩阵。';
  if (input.latex?.includes('\\sigma_{A}^{2}') || input.latex?.includes('h^')) return '先确认哪些量描述变异、哪些量描述选择强度，再看响应如何被预测。';
  if (input.latex?.includes('\\pi') && input.latex?.includes('D')) return '先分清多态性、分化和突变率各自的位置，再看检验统计量怎样比较它们。';
  return `读 ${label} 时，先点开式中陌生符号，再沿图谱看它依赖的前置定义。`;
}

function formulaTakeawayText(input: BuildFormulaLearningCopyInput, plainMeaning: string): string {
  const label = formulaDisplayName(input);
  const latex = normalizeLatex(input.latex);
  const context = (input.context || '').toLowerCase();
  if (latex.includes('\\varphi') && (latex.includes('p_{t}') || context.includes('probability density'))) return '从 p0 出发，t 代后的 p 有一张概率地图。';
  if (latex.includes('E(t)=') || context.includes('expected age')) return '当前频率 p 可以反推出中性等位基因的大致年龄。';
  if (latex.includes('\\sigma_{p}^{2}') || context.includes('among-population variance')) return '漂变让不同群体的 p 逐渐散开，方差记录散开的宽度。';
  if (latex.includes('E(p_{t})=p_{0}') || context.includes('no directional forces')) return '中性漂变会摇晃 p，但平均方向不偏离 p0。';
  if (latex.includes('\\Delta') && latex.includes('p_{i}') && context.includes('frequency of allele')) return '选择开始给 p_i 的变化一个方向。';
  if (latex.includes("p_{j}^{\\prime}") || context.includes('average effect')) return '频率和等位基因效应可以一起更新。';
  return trimLearningSentence(
    plainMeaning.replace(/^这(?:个|条)公式(?:表示|给出|用|通过)?[:：]?\s*/, '') ||
      `${label} 是本节推导中的一个检查点。`,
    88,
  );
}

export function polishFormulaLearningCopy(copy: FormulaLearningCopy, input: BuildFormulaLearningCopyInput = {}): ReadableFormulaCopy {
  const chapterText = formulaLocation(input);
  const contextHint = firstUsefulClause(input.context || '');
  const plainMeaning = trimLearningSentence(
    copy.plainMeaning || contextHint || `${formulaDisplayName(input)} 要先从等号两侧的量读起：左边通常是要预测或定义的对象，右边给出它由哪些条件决定。`,
    170,
  );
  const inThisChapter = trimLearningSentence(
    copy.inThisChapter ||
      `在${chapterText}中，它的作用是把前面的符号定义压成一个可继续推导的关系，方便后面沿图谱展开。`,
    170,
  );
  const takeaway = formulaTakeawayText(input, plainMeaning);
  return {
    plainMeaning,
    inThisChapter,
    takeaway,
    nextAction: formulaActionText(input),
  };
}

function inferFormulaCopy(input: BuildFormulaLearningCopyInput, label: string, chapterText: string): FormulaLearningCopy {
  const latex = normalizeLatex(input.latex);
  const context = input.context || '';
  const lowerContext = context.toLowerCase();

  if (latex.includes('\\varphi') && (latex.includes('p_{t}') || lowerContext.includes('probability density'))) {
    return {
      plainMeaning: `先别被长求和吓住。${label} 要回答的是：p 从 p0 出发，经过 t 代后，落在某个 pt 附近的机会有多大。`,
      inThisChapter: `它把“每一代随机抽一次”的想法，变成一张能连续追踪的频率路线图；后面讲固定、丢失和群体分化时，都要靠这张图做背景。`,
    };
  }

  if (latex.includes('E(t)=') || lowerContext.includes('expected age')) {
    return {
      plainMeaning: `${label} 把今天看到的频率 p，翻译成这个中性等位基因大概已经存在了多久。p 越高，通常表示它在群体里走过的路更长。`,
      inThisChapter: `它把问题从“p 会到哪里”推进到“p 已经走了多久”；有了这个时间尺度，后面才能比较不同群体被漂变拉开的程度。`,
    };
  }

  if (latex.includes('\\sigma_{p}^{2}') || lowerContext.includes('among-population variance')) {
    return {
      plainMeaning: `${label} 在量“散得多开”：许多群体都从同一个 p0 出发，漂变 t 代后，各自的 p 会分散到什么程度。`,
      inThisChapter: `它把单个群体的漂变，拉成群体之间的差异问题；读者可以用这条方差基线判断群体分化是不是漂变自然造成的。`,
    };
  }

  if (latex.includes('E(p_{t})=p_{0}') || lowerContext.includes('no directional forces')) {
    return {
      plainMeaning: `${label} 是中性漂变的基线：单个群体里的 p 会乱晃，但把许多重复群体平均起来，还是回到起点 p0。`,
      inThisChapter: `它先告诉你“随机漂变本身没有平均方向”；后面一旦看到 p 系统性上升或下降，就知道需要选择等其他力量来解释。`,
    };
  }

  if (latex.includes('\\Delta') && latex.includes('p_{i}') && lowerContext.includes('frequency of allele')) {
    return {
      plainMeaning: `${label} 在问 pi 会往哪边变。它把频率变化写成由当前位置、等位基因效应和适合度差异共同推出来的方向。`,
      inThisChapter: `它把前面的中性基线接到选择模型上：随机漂变只让 p 晃动，选择则开始给 p 一个明确的上升或下降方向。`,
    };
  }

  if (latex.includes("p_{j}^{\\prime}") || lowerContext.includes('average effect')) {
    return {
      plainMeaning: `${label} 把 pj 和 bj 都写成“旧值加变化”。也就是说，故事不只记录某个等位基因多了多少，还记录它带来的效应有没有变。`,
      inThisChapter: `它把 p 的故事接进 Price 方程：频率变化和效应变化被放到同一张账本里，后面才能拆分演化响应来自哪里。`,
    };
  }

  if (/P_\{?ij\}?=\\binom/.test(latex) || (latex.includes('P_{ij}') && lowerContext.includes('wright-fisher'))) {
    return {
      plainMeaning: `${label} 给出 Wright-Fisher 模型的一步转移概率：当前有 i 个 B 拷贝时，下一代恰好出现 j 个 B 拷贝的概率。它把“抽取 2N 个配子”写成一个二项分布。`,
      inThisChapter: `在${chapterText}中，它是后续转移矩阵和漂变推导的入口；先理解 P_ij、i、j 和 2N，后面读等位基因频率变化会顺很多。`,
    };
  }

  if (/R=\\sigma_\{?A\}?\^\{?2\}?\\beta/.test(latex) || (latex.includes('\\sigma_{A}^{2}') && latex.includes('\\beta'))) {
    return {
      plainMeaning: `${label} 把选择响应 R 写成加性遗传方差 sigma_A^2 与选择梯度 beta 的乘积。它强调：选择能推动多少变化，既取决于可遗传变异有多少，也取决于性状和适合度之间的关联强度。`,
      inThisChapter: `在${chapterText}中，它把育种者方程从 R = h^2 S 改写到 Robertson-Price / Lande 方程的语言里，为后面多性状响应和 G beta 形式做铺垫。`,
    };
  }

  if (/E\(\\overline\{z\}_\{?t\}?\)=\\mu\+E\(g_\{?t\}?\)\+b_\{?t\}?/.test(latex)) {
    return {
      plainMeaning: `${label} 把第 t 代样本均值的期望拆成三部分：基准均值 mu、遗传偏离的期望 E(g_t)，以及环境偏离 b_t。它是在问短期响应里“均值变了多少”来自哪里。`,
      inThisChapter: `在${chapterText}中，它把漂变和选择造成的遗传变化同环境偏差分开，方便后面继续讨论短期响应的方差。`,
    };
  }

  if (/R=h\^\{?2\}?S/.test(latex)) {
    return {
      plainMeaning: `${label} 是育种者方程：选择响应 R 等于狭义遗传力 h^2 乘以选择差 S。它把“被选择的亲本有多不同”和“这种差异有多少可遗传”合在一起预测下一代均值变化。`,
      inThisChapter: `在${chapterText}中，它是连接遗传力、选择差和响应预测的核心公式，后面的方差形式和多性状形式都会回到这个思想。`,
    };
  }

  if (latex.includes('\\pi') && latex.includes('D') && lowerContext.includes('divergence')) {
    return {
      plainMeaning: `${label} 同时写出中性模型下的多态性 pi_i 和群体间分化 D_i。两者都含有突变率 mu_i，因此可以用它们的比例比较不同基因座是否符合中性预期。`,
      inThisChapter: `在${chapterText}中，它为基于分化的中性检验建立基准关系；先看清 pi、D、N_e 和 t 的角色，再读后面的比值会更直接。`,
    };
  }

  if (/\\overline\{z\}=\\sum/.test(latex)) {
    return {
      plainMeaning: `${label} 把总体平均性状值写成各类别频率 q_i 与类别性状值 z_i 的加权和。也就是说，平均值会随着类别频率或类别性状值的变化而变化。`,
      inThisChapter: `在${chapterText}中，它给 Price 方程后续分解提供起点：先把平均值写清楚，后面才能追踪选择如何改变这个平均。`,
    };
  }

  const readableHint = readableContextHint(context);
  return {
    plainMeaning: readableHint
      ? `${label} 把本节正在讨论的对象写成可计算的关系。${readableHint}`
      : `${label} 需要结合所在章节的定义来读：先辨认等号两侧的量，再沿图谱查看它依赖的符号和前置公式。`,
    inThisChapter: `在${chapterText}中，它像一个推导路标：先确认每个符号的含义，再看它把前面的定义带向哪一个后续问题。`,
  };
}

export function buildFormulaLearningCopy(input: BuildFormulaLearningCopyInput): FormulaLearningCopy {
  const language = input.language || 'zh';
  const cached = input.formulaId ? input.cache?.[input.formulaId]?.[language] : undefined;
  if (cached?.plainMeaning && cached?.inThisChapter) return cached;

  const label = formulaDisplayName(input);
  const location = formulaLocation(input);
  const section = input.section?.trim();

  if (language === 'zh') {
    const chapterText = section ? `${location}「${section}」` : location;
    return inferFormulaCopy(input, label, chapterText);
  }

  return {
    plainMeaning: `${label} is a mathematical relationship used in ${location}. Read it by identifying the variables first, then following the graph to see which earlier definitions support it.`,
    inThisChapter: section
      ? `In ${location}, this formula is a study checkpoint for the ${section} section: understand its symbols, inspect its prerequisites, and connect it back to the chapter argument.`
      : `In ${location}, this formula is a study checkpoint: understand its symbols, inspect its prerequisites, and connect it back to the chapter argument.`,
  };
}

export function buildReadableFormulaCopy(input: BuildFormulaLearningCopyInput): ReadableFormulaCopy {
  return polishFormulaLearningCopy(buildFormulaLearningCopy(input), input);
}

export function standaloneGraphCopy(): string {
  return '这个公式目前在本地图谱中没有已确认的前置或后续关系。';
}

function cleanVariableText(value?: string): string {
  return (value || '')
    .replace(/\s+/g, ' ')
    .replace(/\$\s*([^$]+?)\s*\$/g, '$1')
    .replace(/^line and\s+/i, '')
    .trim();
}

export function humanizeSource(value?: string): string {
  const source = (value || 'context').replace(/_/g, ' ').toLowerCase();
  if (source === 'nearby text') return '本地上下文';
  if (source === 'text excerpt') return '教材摘录';
  return source;
}

export function explainVariablePrerequisite(prereq: FormulaPrerequisite): string {
  const symbol = prereq.symbol || '这个符号';
  const excerpt = cleanVariableText(prereq.source_excerpt);
  const meaning = cleanVariableText(prereq.meaning);
  const definition = cleanVariableText(prereq.definition);

  if (meaning && !/^local variable used near/i.test(meaning)) return meaning;
  if (definition && !/^local variable used near/i.test(definition)) return definition;
  if (excerpt) return excerpt;
  return `${symbol}: 在教材当前上下文中定义。`;
}

export function conciseVariablePrerequisite(prereq: FormulaPrerequisite): string {
  const symbol = prereq.symbol || prereq.via_symbol || '';
  const symbolContext = [prereq.meaning, prereq.definition, prereq.source_excerpt, prereq.reason]
    .filter(Boolean)
    .join(' ');
  const symbolLabel = conciseKnownSymbolLabel(symbol, symbolContext);
  if (symbolLabel) return symbolLabel;

  const text = explainVariablePrerequisite(prereq)
    .replace(/^.*?在这里很关键，因为当前公式依赖它的含义：/, '')
    .replace(/^.*?:\s*/, '')
    .replace(/。.*$/, '')
    .replace(/；.*$/, '')
    .replace(/，.*$/, '')
    .trim();

  if (!text) return '当前公式中的关键符号';
  return text.length > 28 ? `${text.slice(0, 28)}...` : text;
}

function hasAnyContext(value: string, terms: string[]): boolean {
  const lower = value.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

function hasMkFormulaStructure(value = ''): boolean {
  const compact = normalizeLatex(value);
  if (!compact) return false;
  const hasMkEstimator = /\\widehat\{\\overline\{\\alpha\}\}(?:_\{?[A-Za-z]+\}?)?/.test(compact)
    || /^.*(?:^|=)1-NI_\{?[A-Za-z]+\}?/.test(compact)
    || /NI_\{?[A-Za-z]+\}?/.test(compact);
  const hasMkSiteTerms = /D_\{?[as][A-Za-z0-9]*\}?/.test(compact)
    && /P_\{?[as][A-Za-z0-9]*\}?/.test(compact);
  return hasMkEstimator && hasMkSiteTerms;
}

const FITNESS_CONTEXT_TERMS = [
  'fitness',
  'relative fitness',
  'mean fitness',
  'viability selection',
  'selection',
  '适合度',
  '选择',
];

const TRAIT_CONTEXT_TERMS = [
  'trait',
  'phenotype',
  'phenotypic',
  'breeder',
  'selection differential',
  'selection intensity',
  'response',
  '性状',
  '表型',
  '育种',
  '选择差',
  '选择强度',
  '响应',
];

const POPGEN_CONTEXT_TERMS = [
  'allele',
  'frequency',
  'wright-fisher',
  'population',
  'polymorphism',
  'divergence',
  'neutral',
  'mutation',
  'locus',
  'nucleotide',
  'fixation',
  '等位基因',
  '频率',
  '种群',
  '群体',
  '多态',
  '分化',
  '中性',
  '突变',
  '位点',
];

const QUANT_GEN_CONTEXT_TERMS = [
  'heritability',
  'additive genetic',
  'genetic variance',
  'phenotypic variance',
  'environmental variance',
  'epistatic variance',
  'additive-by-additive',
  'epistasis',
  'quantitative',
  'variance in short-term response',
  '遗传力',
  '加性遗传',
  '遗传方差',
  '表型方差',
  '环境方差',
  '数量遗传',
];

const OPTIMUM_CONTEXT_TERMS = [
  'optimum',
  'optimal',
  'stabilizing selection',
  'normalizing selection',
  'fitness model',
  '最适',
  '稳定选择',
];

function cleanSubscriptLabel(value = ''): string {
  return value
    .replace(/\\mathrm\{([^{}]+)\}/g, '$1')
    .replace(/\\operatorname\{([^{}]+)\}/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\\/g, '')
    .trim();
}

function extractSubscript(normalized: string, prefix: string): string {
  if (!normalized.startsWith(`${prefix}_`)) return '';
  const rest = normalized.slice(prefix.length + 1);
  if (rest.startsWith('{')) {
    let depth = 0;
    for (let index = 0; index < rest.length; index += 1) {
      const char = rest[index];
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      if (depth === 0) return cleanSubscriptLabel(rest.slice(1, index));
    }
  }
  return cleanSubscriptLabel(rest.replace(/\^.*$/, ''));
}

function overlineSubscript(normalized: string, inner: string): string | null {
  const pattern = new RegExp(`^\\\\(?:overline|bar)\\{\\{?${inner}\\}?\\}(?:_(?:\\{(.+)\\}|([^{}^]+)))?`);
  const match = normalized.match(pattern);
  if (!match) return null;
  return cleanSubscriptLabel(match[1] || match[2] || '');
}

function formatIndexedLabel(subscript: string, baseLabel: string): string {
  if (!subscript) return baseLabel;
  if (/^[0-9]+$/.test(subscript)) return `第 ${subscript} 类${baseLabel}`;
  if (/^[A-Za-zΑ-Ωα-ω]$/u.test(subscript)) return `第 ${subscript} 类${baseLabel}`;
  return `${subscript} 的${baseLabel}`;
}

function sigmaComponentLabel(component: string, squared: boolean): string {
  const cleaned = cleanSubscriptLabel(component);
  const variance = squared ? '方差' : '标准差';
  const labels: Record<string, string> = {
    A: `加性遗传${variance}`,
    AA: `加性×加性${variance}`,
    AAA: `三阶加性上位性${variance}`,
    AAAA: `四阶加性上位性${variance}`,
    D: `显性遗传${variance}`,
    G: `遗传${variance}`,
    z: `表型${variance}`,
    e: `环境${variance}`,
    E: `环境${variance}`,
    m: `突变${variance}`,
    k: squared ? '家系间后代数方差' : '家系间后代数标准差',
    w: squared ? '家系间适合度方差' : '家系间适合度标准差',
    B: `组间${variance}`,
    b: `均值偏差${variance}`,
  };

  if (/^overlinez/.test(cleaned)) return squared ? '平均性状方差' : '平均性状标准差';
  return labels[cleaned] || '';
}

function conciseKnownSymbolLabel(symbol: string, context = ''): string {
  const normalized = symbol.replace(/\s+/g, '');
  const hasFitnessContext = hasAnyContext(context, FITNESS_CONTEXT_TERMS);
  const hasTraitContext = hasAnyContext(context, TRAIT_CONTEXT_TERMS);
  const hasPopgenContext = hasAnyContext(context, POPGEN_CONTEXT_TERMS);
  const hasQuantGenContext = hasAnyContext(context, QUANT_GEN_CONTEXT_TERMS) || hasTraitContext;
  const hasOptimumContext = hasAnyContext(context, OPTIMUM_CONTEXT_TERMS);
  const hasMkContext = hasMkFormulaStructure(context) || hasAnyContext(context, ['McDonald', 'Kreitman', 'MK test', 'neutrality index', 'neutral', 'Yule-Simpson', 'silent-site', 'silent site', 'replacement', 'adaptive substitutions', 'substitutions that are adaptive', 'polymorphism', 'divergence']);
  const compactContext = context.replace(/\s+/g, '');
  const hasSelectionGradientStructure =
    /\\sigma_\{?z\}?\^\{?2\}?/.test(compactContext) ||
    /\\sigma\(?\{?z\}?\)?\^\{?2\}?/.test(compactContext) ||
    /R=.*\\beta/.test(compactContext) ||
    /\\sigma_\{?A\}?\^\{?2\}?\\beta/.test(compactContext);

  if (/\\widehat\{\\overline\{\\alpha\}\}(?:_\{?[A-Za-z]+\}?)?$/.test(normalized) && hasMkContext) {
    return '适应性替换比例估计量';
  }
  if (/^NI_\{?TG\}?$/.test(normalized) && hasMkContext) return 'Tarone-Greenland 加权中性指数';
  if (/^NI(?:_\{?[A-Za-z]+\}?)?$/.test(normalized) && hasMkContext) return '中性指数';

  const fitnessSubscript = extractSubscript(normalized, 'W');
  if (fitnessSubscript && hasFitnessContext) return `第 ${fitnessSubscript} 类适合度`;

  const relativeFitnessSubscript = extractSubscript(normalized, 'w');
  if (relativeFitnessSubscript && hasFitnessContext) return `第 ${relativeFitnessSubscript} 类相对适合度`;

  const traitMeanSubscript = overlineSubscript(normalized, 'z');
  if (traitMeanSubscript !== null && hasTraitContext) return formatIndexedLabel(traitMeanSubscript, '平均性状值');

  const selectionIntensitySubscript = overlineSubscript(normalized, '\\\\imath');
  if (selectionIntensitySubscript !== null) {
    return selectionIntensitySubscript ? `${selectionIntensitySubscript} 的选择强度` : '平均选择强度';
  }

  const sigmaSubscript = extractSubscript(normalized, '\\sigma');
  if (sigmaSubscript && (hasQuantGenContext || hasSelectionGradientStructure)) {
    const label = sigmaComponentLabel(sigmaSubscript, /\^\{?2\}?/.test(normalized));
    if (label) return label;
  }

  const responseSubscript = extractSubscript(normalized, 'R');
  if ((normalized === 'R' || responseSubscript) && hasTraitContext) {
    return responseSubscript ? `${responseSubscript} 的选择响应` : '选择响应';
  }

  const differentialSubscript = extractSubscript(normalized, 'S');
  if ((normalized === 'S' || differentialSubscript) && hasTraitContext) {
    return differentialSubscript ? `${differentialSubscript} 的选择差` : '选择差';
  }

  const betaSubscript = extractSubscript(normalized, '\\beta');
  if ((normalized === '\\beta' || betaSubscript) && (hasTraitContext || hasFitnessContext || hasSelectionGradientStructure)) {
    return betaSubscript ? `${betaSubscript} 的选择梯度` : '选择梯度';
  }

  const pSubscript = extractSubscript(normalized, 'p');
  if (pSubscript && hasPopgenContext) return formatIndexedLabel(pSubscript, '等位基因频率');

  const mkSiteLabel = mkSiteSymbolLabel(normalized, hasMkContext);
  if (mkSiteLabel) return mkSiteLabel;

  const qSubscript = extractSubscript(normalized, 'q');
  if (qSubscript && hasTraitContext) {
    return normalized.includes('\\prime') || normalized.includes("'")
      ? formatIndexedLabel(qSubscript, '后代频率')
      : formatIndexedLabel(qSubscript, '类别频率');
  }

  if (normalized === 'p' && hasPopgenContext) return '等位基因频率';
  if ((normalized === 'w' || normalized === 'W') && hasFitnessContext) {
    return normalized === 'w' ? '相对适合度' : '适合度';
  }
  if (normalized === 'z' && hasTraitContext) return '性状值';
  if ((normalized === '\\mu_z' || normalized === '\\mu_{z}') && hasTraitContext) return '性状均值';
  if (normalized === '\\mu' && hasTraitContext) return '基准均值';
  if ((normalized === '\\theta' || normalized === 'theta') && hasOptimumContext) return '最适性状值';
  if ((normalized === 'V_s' || normalized === 'V_{s}') && hasOptimumContext) return '稳定选择宽度';
  if ((normalized === 'V_B' || normalized === 'V_{B}') && hasQuantGenContext) return '组间方差';
  if ((normalized === 'h^2' || normalized === 'h^{2}') && hasQuantGenContext) return '狭义遗传力';
  if ((normalized === 'N' || normalized === 'N_t' || normalized === 'N_{t}') && hasPopgenContext) {
    if (normalized === 'N_t' || normalized === 'N_{t}') return '第 t 代个体数';
    return '实际繁殖个体数';
  }

  const labels: Record<string, string> = {
    '\\overline{W}': '平均适合度',
    '\\bar{W}': '平均适合度',
    '\\barW': '平均适合度',
    '\\overline{w}': '平均相对适合度',
    '\\bar{w}': '平均相对适合度',
    '\\barw': '平均相对适合度',
    'N_{e}': '有效种群大小',
    'N_e': '有效种群大小',
    '\\sigma_{k}^{2}': '家系间后代数方差',
    '\\sigma_k^2': '家系间后代数方差',
    '\\sigma_{w}^{2}': '家系间适合度方差',
    '\\sigma_w^2': '家系间适合度方差',
    '\\mu_{k}': '平均后代数',
    '\\mu_k': '平均后代数',
    '\\mu_{i}': '第 i 位点突变率',
    '\\mu_i': '第 i 位点突变率',
    '\\pi_i': '第 i 位点多样性',
    '\\pi_{i}': '第 i 位点多样性',
    'D_i': '第 i 位点分化',
    'D_{i}': '第 i 位点分化',
    'P_{t}': '同源概率',
    'H_{t}': '第 t 代杂合度',
    'H_{0}': '初始杂合度',
    'T': '世代时间',
    'D_{a}': '替换位点分化',
    'D_{s}': '沉默位点分化',
    'P_{a}': '替换位点多态性',
    'P_{s}': '沉默位点多态性',
    'S_{a}': '替换位点多态性',
    'S_{s}': '沉默位点多态性',
    '\\mu_{a}': '替换位点突变率',
    '\\mu_{s}': '沉默位点突变率',
    '\\theta_{a}': '替换位点 θ',
    '\\theta_{s}': '沉默位点 θ',
    '\\theta_{W}': '适合度 θ',
    '\\theta_W': '适合度 θ',
    '\\theta_{z}': '性状 θ',
    '\\theta_z': '性状 θ',
    'a_{n}': '样本校正常数',
    'n_{a}': '替换位点数',
    'n_{s}': '沉默位点数',
    'f': '替换比例',
  };
  return labels[normalized] || '';
}

function mkSiteSymbolLabel(normalized: string, hasMkContext: boolean): string {
  if (!hasMkContext) return '';
  const match = normalized.match(/^([DPS])_\{?([as])([A-Za-z0-9]*)\}?$/);
  if (!match) return '';
  const [, quantity, siteType, index] = match;
  const siteLabel = siteType === 'a' ? '替换位点' : '沉默位点';
  const quantityLabel = quantity === 'D' ? '分化' : quantity === 'P' ? '多态性' : '多态位点数';
  const suffix = index ? `（第 ${index} 个基因）` : '';
  return `${siteLabel}${quantityLabel}${suffix}`;
}

function cleanSymbolForText(symbol: string): string {
  return symbol
    .replace(/\\/g, '')
    .replace(/[{}]/g, '')
    .trim();
}

function describeKnownSymbolLabel(symbol: string, label: string): string {
  const plainSymbol = cleanSymbolForText(symbol);
  if (label.includes('适合度')) return `${plainSymbol} 表示${label}，用于描述选择中不同类别的繁殖成功差异。`;
  if (label.includes('性状')) return `${plainSymbol} 表示${label}，用于追踪表型或数量性状在群体中的变化。`;
  if (label.includes('选择强度')) return `${plainSymbol} 表示${label}，也就是标准化后的选择差。`;
  if (label.includes('选择梯度')) return `${plainSymbol} 表示${label}，描述性状值与适合度之间的局部关联强度。`;
  if (label.includes('选择响应')) return `${plainSymbol} 表示${label}，也就是选择后性状均值预期改变的量。`;
  if (label.includes('选择差')) return `${plainSymbol} 表示${label}，即被选亲本均值相对选择前群体均值的偏离。`;
  if (label.includes('估计量')) return `${plainSymbol} 表示${label}，把多态性和分化信息合并成对自适应替换比例的估计。`;
  if (label.includes('Tarone-Greenland')) return `${plainSymbol} 是 ${label}，用来把多个基因的 MK 比值按沉默位点信息加权合并。`;
  if (label.includes('中性指数')) return `${plainSymbol} 表示${label}，用来比较替换位点和沉默位点的多态性/分化比例。`;
  if (label.includes('方差') || label.includes('标准差')) return `${plainSymbol} 表示${label}，是本式中衡量变异尺度的量。`;
  if (label.includes('遗传力')) return `${plainSymbol} 表示${label}，说明表型差异中可由加性遗传效应传递的比例。`;
  if (label.includes('等位基因频率')) return `${plainSymbol} 表示${label}，用于追踪群体中等位基因组成的变化。`;
  if (label.includes('后代频率') || label.includes('类别频率')) return `${plainSymbol} 表示${label}，用于对各类别的性状值做加权平均。`;
  if (label.includes('突变率')) return `${plainSymbol} 表示${label}，决定该位点引入新变异的速率。`;
  if (label.includes('多样性')) return `${plainSymbol} 表示${label}，用于衡量群体内的多态水平。`;
  if (label.includes('分化')) return `${plainSymbol} 表示${label}，用于衡量群体或谱系之间的差异。`;
  if (label.includes('多态性')) return `${plainSymbol} 表示${label}，用于衡量群体内仍在分离的变异量。`;
  return `${plainSymbol} 表示${label}；先用这个短标签定位它在本式中的角色。`;
}

export function describeFormulaSymbol(symbol: string, formula?: Pick<ChapterFormula, 'id' | 'latex' | 'context_text'>): string {
  const latex = normalizeLatex(formula?.latex);
  const plainSymbol = cleanSymbolForText(symbol);
  const normalizedSymbol = symbol.replace(/\s+/g, '');
  const symbolContext = [formula?.latex, formula?.context_text].filter(Boolean).join(' ');
  const lowerContext = symbolContext.toLowerCase();
  const knownLabel = conciseKnownSymbolLabel(symbol, symbolContext);
  const hasWrightFisherContext = hasAnyContext(symbolContext, ['wright-fisher', 'gamete', 'copy', 'copies', '2N', 'allele', '拷贝', '等位基因']);

  if (formula && isAlleleFitnessUpdateFormula(formula)) {
    if (symbol === 'p') return 'p 表示选择发生前的等位基因 a 频率，是本式追踪频率变化的起点。';
    if (symbol === 'p^{\\prime}' || symbol === "p'") return "p' 表示经过一代 viability selection 之后，等位基因 a 的新频率。";
    if (symbol === 'W_{\\mathrm{a}}' || symbol === 'W_a') return 'W_a 表示等位基因 a 的边际适合度，决定选择会把 a 的频率推高还是压低。';
    if (symbol === '\\overline{W}') return 'W 的横线表示群体平均适合度；本式用 W_a 与平均适合度的比值来缩放频率 p。';
  }

  if (
    normalizedSymbol === '\\overline{W}' ||
    normalizedSymbol === '\\bar{W}' ||
    normalizedSymbol === '\\barW'
  ) {
    return 'W 的横线表示群体平均适合度；它把各基因型或类别的适合度按频率加权成总体平均。';
  }

  if (
    normalizedSymbol === '\\overline{w}' ||
    normalizedSymbol === '\\bar{w}' ||
    normalizedSymbol === '\\barw'
  ) {
    return 'w 的横线表示平均相对适合度；本式用它作为选择响应或梯度的归一化尺度。';
  }

  if ((symbol === 'W' || /^W_\{?/.test(symbol)) && (lowerContext.includes('fitness') || /\\overline\{W\}|\\bar\{?W\}?/.test(formula?.latex || ''))) {
    const subscript = symbol.match(/^W_\{?([^{}]+)\}?$/)?.[1];
    if (subscript) return `第 ${subscript} 类适合度；W_${subscript} 表示第 ${subscript} 类或第 ${subscript} 个基因型的适合度。`;
    return 'W 表示适合度，是选择公式里衡量繁殖成功的量。';
  }

  if (symbol === 'P_{ij}') return '在本式中，P_ij 表示从当前 i 个 B 拷贝转移到下一代 j 个 B 拷贝的概率，是 Wright-Fisher 转移矩阵里的一个元素。';
  if (symbol === 'i' && hasWrightFisherContext) return 'i 表示当前这一代中 B 等位基因的拷贝数，公式用它来给每次抽样的成功概率 i/(2N) 定值。';
  if (symbol === 'j' && hasWrightFisherContext) return 'j 表示下一代中 B 等位基因的拷贝数，也就是这个二项分布正在计算的结果。';
  if (symbol === 'N' && hasWrightFisherContext) return 'N 是群体大小参数；在二倍体 Wright-Fisher 模型里，2N 表示下一代抽样的基因拷贝数。';
  if (symbol === 'R' && knownLabel === '选择响应') return 'R 表示选择响应，也就是经过一代选择后性状均值预期改变的量。';
  if ((symbol === '\\sigma_{A}^{2}' || symbol === '\\sigma_A^2') && knownLabel) return 'sigma_A^2 是加性遗传方差，表示能被选择转化为后代响应的可遗传变异。';
  if ((symbol === '\\sigma_{AA}^{2}' || symbol === '\\sigma_AA^2') && knownLabel) return 'sigma_AA^2 是加性×加性方差，表示两个位点加性效应相互作用贡献的上位性方差。';
  if (symbol === '\\beta' && knownLabel === '选择梯度') return 'beta 是选择梯度或性状值与适合度之间的关联强度，决定选择沿哪个方向、以多大强度推动响应。';
  if ((symbol === 'h^2' || symbol === 'h^{2}') && knownLabel) return 'h^2 是狭义遗传力，表示表型差异中有多少可以通过加性遗传效应传给下一代。';
  if (symbol === 'S' && knownLabel === '选择差') return 'S 是选择差，表示被选亲本的平均性状值相对选择前群体均值偏离多少。';
  if (symbol === '\\overline{z}_{t}') return 'z_t 的横线表示第 t 代样本平均性状值；本式关心这个平均值在漂变、选择和环境偏差下的期望。';
  if (symbol === '\\mu' && knownLabel) return 'mu 表示基准群体均值，是本式拆分平均值时的参照点。';
  if (symbol === 'g_{t}') return 'g_t 表示第 t 代遗传偏离；在漂变下它的期望为 0，在选择下会由育种者方程累积。';
  if (symbol === 'b_{t}') return 'b_t 表示第 t 代的平均环境偏离，用来把环境造成的均值变化同遗传变化分开。';
  if (symbol === '\\pi_i') return 'pi_i 表示第 i 个基因座的核苷酸多样性，用来衡量群体内多态性。';
  if (symbol === 'D_i') return 'D_i 表示第 i 个基因座的群体间分化量，用来和多态性一起构成中性检验的比较基准。';
  if (symbol === 'N_e') return 'N_e 是有效群体大小，决定中性模型下多态性水平的尺度。';
  if (symbol === '\\mu_i') return 'mu_i 表示第 i 个基因座的突变率，它同时影响多态性和分化。';
  if (knownLabel) return describeKnownSymbolLabel(symbol, knownLabel);

  const excerpt = contextExcerpt(formula?.context_text, 120);
  if (latex && latex.includes(normalizeLatex(symbol))) {
    return excerpt
      ? `${plainSymbol} 是这个公式直接使用的符号。先结合附近文字读它的定义：${excerpt}`
      : `${plainSymbol} 是这个公式直接使用的符号；需要结合本节文字确认它在当前模型中的含义。`;
  }
  return excerpt
    ? `${plainSymbol} 出现在当前公式附近的教材语境中，可以先按这段话定位它的含义：${excerpt}`
    : `${plainSymbol} 是当前公式需要辨认的符号；建议沿图谱查看它的定义或前置公式。`;
}

function isAlleleFitnessUpdateFormula(formula: Pick<ChapterFormula, 'latex' | 'context_text'>): boolean {
  const latex = normalizeLatex(formula.latex);
  const context = formula.context_text.toLowerCase();
  return (
    /p\^\{?\\prime\}?=p/.test(latex) &&
    /W_\{?\\mathrm\{?a\}?\}?/.test(latex) &&
    /\\(?:overline|bar)\{W\}/.test(latex) &&
    hasAnyContext(context, ['marginal fitness', 'viability selection', 'mean fitness', 'allele'])
  );
}

const GREEK_SYMBOL_COMMANDS = new Set([
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'varepsilon',
  'zeta',
  'eta',
  'theta',
  'vartheta',
  'iota',
  'kappa',
  'lambda',
  'mu',
  'nu',
  'xi',
  'pi',
  'varpi',
  'rho',
  'varrho',
  'sigma',
  'varsigma',
  'tau',
  'upsilon',
  'phi',
  'varphi',
  'chi',
  'psi',
  'omega',
  'Gamma',
  'Delta',
  'Theta',
  'Lambda',
  'Xi',
  'Pi',
  'Sigma',
  'Upsilon',
  'Phi',
  'Psi',
  'Omega',
  'imath',
]);

const SYMBOL_WRAPPER_COMMANDS = new Set([
  'bar',
  'boldsymbol',
  'mathbf',
  'mathbb',
  'mathcal',
  'mathit',
  'mathsf',
  'mathrm',
  'overline',
  'hat',
  'widehat',
  'tilde',
  'widetilde',
  'vec',
]);

const TEXT_COMMANDS = new Set(['begin', 'end', 'operatorname', 'text', 'textrm', 'textit', 'textbf']);
const OPERATOR_COMMANDS = new Set(['frac', 'dfrac', 'tfrac', 'binom', 'sqrt', 'sum', 'prod', 'int', 'lim', 'left', 'right', 'quad', 'qquad', 'partial']);
const TEXT_WORDS = new Set(['and', 'where', 'if', 'for', 'with', 'when']);

function readLatexCommand(input: string, start: number): { name: string; end: number } | null {
  if (input[start] !== '\\') return null;
  let end = start + 1;
  while (/[A-Za-z]/.test(input[end] || '')) end += 1;
  if (end === start + 1) return null;
  return { name: input.slice(start + 1, end), end };
}

function readScriptSuffix(input: string, start: number): { suffix: string; end: number } {
  let index = skipWhitespace(input, start);
  let suffix = '';
  while (input[index] === '_' || input[index] === '^') {
    const mark = input[index];
    const valueStart = skipWhitespace(input, index + 1);
    const group = readBracedGroup(input, valueStart);
    if (group) {
      suffix += `${mark}{${group.value}}`;
      index = skipWhitespace(input, group.end);
      continue;
    }
    const command = readLatexCommand(input, valueStart);
    if (command) {
      suffix += `${mark}\\${command.name}`;
      index = skipWhitespace(input, command.end);
      continue;
    }
    if (input[valueStart]) {
      suffix += `${mark}${input[valueStart]}`;
      index = skipWhitespace(input, valueStart + 1);
      continue;
    }
    break;
  }
  return { suffix, end: index };
}

function readSymbolArgument(input: string, start: number): { raw: string; end: number } | null {
  const index = skipWhitespace(input, start);
  const group = readBracedGroup(input, index);
  if (group) return { raw: group.value, end: group.end };

  const command = readLatexCommand(input, index);
  if (command && (GREEK_SYMBOL_COMMANDS.has(command.name) || SYMBOL_WRAPPER_COMMANDS.has(command.name))) {
    const scripts = readScriptSuffix(input, command.end);
    return { raw: `\\${command.name}${scripts.suffix}`, end: scripts.end };
  }

  if (/[A-Za-z]/.test(input[index] || '')) {
    const scripts = readScriptSuffix(input, index + 1);
    return { raw: `${input[index]}${scripts.suffix}`, end: scripts.end };
  }

  return null;
}

function lhsPrimarySymbol(latex = ''): string {
  const lhs = latex
    .replace(/\\begin\{[^{}]+\}/g, '')
    .replace(/\\end\{[^{}]+\}/g, '')
    .split('=')[0] || '';
  const normalized = lhs.replace(/\s+/g, '');
  if (!normalized || /[+\-*/(),]/.test(normalized)) return '';
  if (!/^[\\A-Za-z]/.test(normalized)) return '';
  if (/(?:\\sum|\\prod|\\int|\\frac|\\sqrt|\\left|\\right)/.test(normalized)) return '';
  return lhs.trim();
}

function isSplitFromWholeSymbol(symbol: string, whole: string): boolean {
  const symbolValue = symbolKey(symbol);
  const wholeValue = symbolKey(whole);
  return Boolean(/^[A-Z]$/.test(symbolValue) && wholeValue && wholeValue.includes(symbolValue));
}

function isLikelySymbolCore(value: string): boolean {
  const compact = normalizeLatex(value);
  if (!compact || TEXT_WORDS.has(compact.toLowerCase())) return false;
  if (/^[A-Za-z](?:[_^].+)?$/.test(compact)) return true;
  if (/^[A-Z]{2}(?:[_^].+)?$/.test(compact)) return true;
  if (/^\\[A-Za-z]+(?:[_^].+)?$/.test(compact)) return true;
  if (/^\\[A-Za-z]+\{.+\}(?:[_^].+)?$/.test(compact)) return true;
  return false;
}

function addScannedSymbol(symbols: string[], seen: Set<string>, symbol: string) {
  if (!isLikelySymbolCore(symbol)) return;
  const key = symbolKey(symbol);
  if (!key || seen.has(key)) return;
  seen.add(key);
  symbols.push(symbol);
}

function extractLatexVariableSymbols(latex = ''): string[] {
  const symbols: string[] = [];
  const seen = new Set<string>();
  let index = 0;

  while (index < latex.length) {
    const char = latex[index];

    if (char === '\\') {
      const command = readLatexCommand(latex, index);
      if (!command) {
        index += 1;
        continue;
      }

      if (TEXT_COMMANDS.has(command.name)) {
        const group = readBracedGroup(latex, skipWhitespace(latex, command.end));
        index = group?.end ?? command.end;
        continue;
      }

      if (SYMBOL_WRAPPER_COMMANDS.has(command.name)) {
        const argument = readSymbolArgument(latex, command.end);
        if (!argument) {
          index = command.end;
          continue;
        }
        const scripts = readScriptSuffix(latex, argument.end);
        const compactArgument = normalizeLatex(argument.raw);
        if (!(command.name === 'mathrm' && (compactArgument === 'd' || TEXT_WORDS.has(compactArgument.toLowerCase())))) {
          addScannedSymbol(symbols, seen, `\\${command.name}{${argument.raw}}${scripts.suffix}`);
        }
        index = scripts.end;
        continue;
      }

      if (GREEK_SYMBOL_COMMANDS.has(command.name)) {
        const scripts = readScriptSuffix(latex, command.end);
        addScannedSymbol(symbols, seen, `\\${command.name}${scripts.suffix}`);
        index = scripts.end;
        continue;
      }

      index = OPERATOR_COMMANDS.has(command.name) ? command.end : command.end;
      continue;
    }

    if (/[A-Za-z]/.test(char || '')) {
      let runEnd = index + 1;
      while (/[A-Za-z]/.test(latex[runEnd] || '')) runEnd += 1;
      const run = latex.slice(index, runEnd);

      if (run.length > 2 || TEXT_WORDS.has(run.toLowerCase())) {
        index = runEnd;
        continue;
      }

      if (/^[A-Z]{2}$/.test(run)) {
        const scripts = readScriptSuffix(latex, runEnd);
        addScannedSymbol(symbols, seen, `${run}${scripts.suffix}`);
        index = scripts.end;
        continue;
      }

      for (let offset = 0; offset < run.length; offset += 1) {
        const letter = run[offset];
        if (letter === 'd' && run.length === 2 && offset === 0) continue;
        const scripts = offset === run.length - 1 ? readScriptSuffix(latex, runEnd) : { suffix: '', end: runEnd };
        addScannedSymbol(symbols, seen, `${letter}${scripts.suffix}`);
        if (offset === run.length - 1) {
          index = scripts.end;
        }
      }
      continue;
    }

    index += 1;
  }

  return symbols;
}

function fallbackSymbolsForFormula(formula: ChapterFormula): string[] {
  if (isAlleleFitnessUpdateFormula(formula)) return ['p', 'p^{\\prime}', 'W_{\\mathrm{a}}', '\\overline{W}'];
  const lhsSymbol = lhsPrimarySymbol(formula.latex);
  const symbols = new Set<string>();
  if (lhsSymbol) symbols.add(lhsSymbol);
  formula.symbols_defined?.forEach((symbol) => {
    if (lhsSymbol && isSplitFromWholeSymbol(symbol, lhsSymbol)) return;
    symbols.add(symbol);
  });
  formula.symbols_used?.forEach((symbol) => {
    if (lhsSymbol && isSplitFromWholeSymbol(symbol, lhsSymbol)) return;
    symbols.add(symbol);
  });
  extractLatexVariableSymbols(formula.latex).forEach((symbol) => {
    if (![...symbols].some((item) => symbolKey(item) === symbolKey(symbol))) symbols.add(symbol);
  });
  const hasNeutralityIndex = [...symbols].some((symbol) => /^NI(?:_|\{|\b)/.test(symbol.replace(/\s+/g, '')));
  if (hasNeutralityIndex) {
    symbols.delete('N');
    symbols.delete('I');
    [...symbols].forEach((symbol) => {
      if (/^I_\{?[A-Za-z]+\}?$/.test(symbol.replace(/\s+/g, ''))) symbols.delete(symbol);
    });
  }
  return [...symbols];
}

export function buildFormulaSymbolPrerequisites(formula?: ChapterFormula): FormulaPrerequisite[] {
  if (!formula) return [];

  return fallbackSymbolsForFormula(formula)
    .filter(Boolean)
    .map((symbol) => {
      const meaning = describeFormulaSymbol(symbol, formula);
      return {
        type: 'variable_definition' as const,
        symbol,
        meaning,
        definition: meaning,
        source: 'formula_symbols',
        source_excerpt: formula.context_text,
        confidence: formula.symbols_defined?.includes(symbol) ? 0.88 : 0.74,
        edge_status: 'accepted' as const,
      };
    });
}

export function extractKeySymbols(formula?: ChapterFormula, prerequisites: FormulaPrerequisite[] = []): string[] {
  const symbols = new Set<string>();
  formula?.symbols_defined?.forEach((symbol) => symbols.add(symbol));
  formula?.symbols_used?.slice(0, 8).forEach((symbol) => symbols.add(symbol));
  prerequisites.forEach((prereq) => {
    if (prereq.via_symbol) symbols.add(prereq.via_symbol);
    if (prereq.symbol) symbols.add(prereq.symbol);
  });
  return [...symbols].filter(Boolean).slice(0, 8);
}

export function buildFormulaBrief(input: {
  id: string;
  featured?: FeaturedFormula;
  search?: SearchFormula;
  chapterFormula?: ChapterFormula;
  dependency?: FormulaDependency | null;
}): FormulaBrief {
  const prerequisites = input.dependency?.prerequisites || [];
  const context = input.search?.context || input.chapterFormula?.context_text || '';

  return {
    id: input.id,
    number: formulaNumber(input.id),
    title: input.search?.label || input.featured?.display_name || input.featured?.label || input.chapterFormula?.label || formulaNumber(input.id),
    chapter: input.search?.chapter || input.featured?.chapter,
    section: input.search?.section || input.chapterFormula?.section,
    latex: input.chapterFormula?.latex || input.search?.latex_preview || input.featured?.latex_preview || '',
    shortContext: compactContext(context, 140),
    longContext: compactContext(context, 420),
    keySymbols: extractKeySymbols(input.chapterFormula, prerequisites),
    prerequisiteCount: prerequisites.length,
    formulaPrerequisiteCount: prerequisites.filter((item) => item.type === 'formula').length,
    variablePrerequisiteCount: prerequisites.filter((item) => item.type === 'variable_definition').length,
  };
}

export function explainPrerequisite(prereq: FormulaPrerequisite): string {
  if (prereq.type === 'formula') {
    const via = prereq.via_symbol ? `，连接符号是 ${prereq.via_symbol}` : '';
    const scope = prereq.cross_chapter ? '，它来自其他章节' : '';
    return `这条前置公式支撑了当前公式${via}${scope}。`;
  }

  const symbol = prereq.symbol || '这个符号';
  const definition = explainVariablePrerequisite(prereq);
  return `${symbol} 在这里很关键，因为当前公式依赖它的含义：${definition}`;
}
