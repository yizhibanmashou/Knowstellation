import type { ChapterFormula, FeaturedFormula, FormulaDependency, FormulaLearningCopyEntry, FormulaPrerequisite, SearchFormula } from '../../shared/types/formula';
import { readBracedGroup, skipWhitespace } from '../../shared/utils/latexHelpers.ts';

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
  takeawayCache?: Record<string, string>;
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
  return value.replace(/&/g, '').replace(/\s+/g, '');
}

function symbolKey(value: string): string {
  return normalizeLatex(value)
    .replace(/\\(?:mathbf|boldsymbol|bm|mathbb|mathcal|mathit|mathsf|mathrm)\{([^{}]+)\}/g, '$1')
    .replace(/\\(?:mathbf|boldsymbol|bm|mathbb|mathcal|mathit|mathsf|mathrm)(\\?[A-Za-z])/g, '$1')
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
    .split(/(?<=[。!?！？])\s*/)
    .find((item) => item.length >= 18 && item.length <= maxLength);
  if (sentence) return endSentence(sentence);
  return `${normalized.slice(0, maxLength).replace(/\s+\S*$/, '')}…`;
}

function firstUsefulClause(value: string): string {
  const normalized = cleanContext(value);
  if (!normalized) return '';
  const sentence = normalized
    .split(/(?<=[。!?！？])\s*/)
    .find((item) => item.length > 16) || normalized;
  return trimLearningSentence(sentence, 96);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function withoutFormulaLead(value: string, input: BuildFormulaLearningCopyInput): string {
  const label = formulaDisplayName(input);
  return value
    .replace(new RegExp(`^${escapeRegex(label)}\\s*`, 'i'), '')
    .replace(/^Formula\s+\S+\s*/i, '')
    .replace(/^这(?:个|条)?公式\s*/, '')
    .replace(/^[:：]\s*/, '')
    .replace(/^是/, '')
    .trim();
}

function formulaFamilyTakeaway(input: BuildFormulaLearningCopyInput): string {
  const latex = normalizeLatex(input.latex);
  const context = [input.context, input.section].filter(Boolean).join(' ').toLowerCase();

  if (/f_\{?t\}?=/.test(latex) && (context.includes('inbreeding') || context.includes('identity-by-descent') || context.includes('parental generation'))) {
    return '第 t 代近交系数由本代直接同源的机会和上一代近交水平递推得到。';
  }

  if (/H_\{?t\}?=/.test(latex) && (latex.includes('H_{0}') || latex.includes('H_0'))) {
    return '第 t 代杂合度等于初始杂合度乘上每代保留下来的比例。';
  }

  if (latex.includes('F_{ST}=') || latex.includes('FST=')) {
    return '群体分化指数用等位基因频率在群体间的方差来衡量分化程度。';
  }

  if ((latex.includes('N_{e}=') || latex.includes('N_e=') || latex.includes('N_{es}=') || latex.includes('N_es=')) && context.includes('effective')) {
    return '有效群体大小由上一代繁殖个体数、成功配子数的变异或协方差，以及平均后代数共同决定。';
  }

  if (latex.includes('a_{n}=\\sum')) {
    return '样本校正常数是 1 到 n-1 的调和和，用来校正分离位点估计 θ 的样本量。';
  }

  if (latex.includes('\\widehat{\\theta}_{\\pi}')) {
    return '用样本序列的平均两两差异估计 θ，也就是突变和漂变共同决定的多样性尺度。';
  }

  if (latex.includes('\\widehat{\\theta}_{S}') || latex.includes('\\widehat{\\theta}_{s}')) {
    return '用分离位点数和样本校正常数估计 θ，反映样本中累积的中性变异量。';
  }

  if (latex.includes('\\widehat{\\theta}_{1}') || latex.includes('\\widehat{\\theta}_1')) {
    return '用单例突变数估计 θ，强调样本里最低频变异携带的突变信息。';
  }

  if (latex.includes('\\Delta\\mathbf{p}=') && latex.includes('\\mathbf{G}') && latex.includes('\\nabla')) {
    return '把多等位基因的频率变化写成遗传协方差矩阵和平均适合度梯度的乘积。';
  }

  if (latex.includes('\\overline{W}=') && latex.includes('W_{AA}') && latex.includes('W_{Aa}')) {
    return '群体平均适合度是三种基因型适合度按基因型频率加权后的平均。';
  }

  if (/p\^\{?\\prime\}?=p/.test(latex) && latex.includes('W_{\\mathrm{a}}') && latex.includes('\\overline{W}')) {
    return '选择后的等位基因频率等于原频率按边际适合度相对平均适合度重新加权。';
  }

  if (latex.includes('\\delta_{\\mathbf{y}}=') && latex.includes('\\widehat{y}_{0}')) {
    return '把各时间点的等位基因频率观测值减去共同初始频率，得到用于检验的偏离向量。';
  }

  if (latex.includes('\\Delta') && /p_\{?i\}?/.test(latex) && context.includes('allele')) {
    return '等位基因频率的变化由当前频率、等位基因适合度和群体平均适合度共同决定。';
  }

  if (latex.includes('\\overline{z}=\\sum') || latex.includes('\\bar{z}=\\sum')) {
    return '总体平均性状值是各类别频率与类别性状值的加权和。';
  }

  if (latex.includes('f_{s}=') && latex.includes('\\Delta_{q}')) {
    return '扫荡强度 f_s 表示初始连锁关联在有利等位基因固定后保留下来的比例。';
  }

  if (latex.includes('\\overline{W}=1-s') && latex.includes('1-\\mu')) {
    return '突变选择平衡下，隐性有害等位基因造成的平均适合度损失等于突变率。';
  }

  if (latex.includes('H_{h}=\\mathrm{E}(H)') && latex.includes('\\Delta_{q}^{2}')) {
    return '扫荡后的期望杂合度等于初始杂合度减去连锁关联变化造成的损失。';
  }

  if (latex.includes('\\mathbf{V}=') && latex.includes('\\widehat{p}_{0}') && latex.includes('\\widehat{p}_{t}')) {
    return '把初始频率估计值和第 t 代频率估计值的方差、协方差放进同一个矩阵。';
  }

  if (latex.includes('\\widehat{\\delta}_{t}=') && latex.includes('\\widehat{p}_{t}') && latex.includes('\\widehat{p}_{0}')) {
    return '估计的频率变化等于第 t 代频率估计值减去初始频率估计值。';
  }

  if (latex.includes('X_{i}^{2}=') && context.includes('hka')) {
    return '计算第 i 个基因对 HKA 检验拟合误差的贡献，衡量观察值偏离中性期望的程度。';
  }

  if (latex.includes('\\pi_{i}=4N_{e}\\mu_{i}') && latex.includes('D_{i}=2t\\mu_{i}')) {
    return '中性模型下，多样性由有效群体大小和突变率决定，分化由分化时间和突变率决定。';
  }

  if (latex.includes('P_{h}=') && (context.includes('haplotype') || context.includes('fisher'))) {
    return '把所有不比观察值更极端的单倍型配置概率相加，得到单倍型检验的尾部概率。';
  }

  if (latex.includes('rEHH_{i}=') || latex.includes('rEHH_i=')) {
    return '用第 i 个核心等位基因的 EHH 除以其他等位基因的平均 EHH，衡量它的长程单倍型优势。';
  }

  if (latex.includes('\\lambda=') && latex.includes('\\mu_{b}')) {
    return '有利突变的历史事件率由选择强度尺度和有利突变率共同决定。';
  }

  if (/\\gamma_?\{?t\}?=/.test(latex) && latex.includes('\\lambda_1^t')) {
    return '同源状态系数随世代按转移矩阵特征值递推变化。';
  }

  if (latex.includes('\\mathbf{V}=\\mathrm{Cov}(\\mathbf{y})')) {
    return '把亲属性状的协方差分解为遗传方差、显性方差、近交关系矩阵和环境方差的贡献。';
  }

  if (latex.includes('\\beta=\\Pr') && latex.includes('\\chi')) {
    return '计算在备择方差下未拒绝原假设的概率，也就是方差检验的 β 错误率。';
  }

  if (latex.includes('\\mu_{t}=\\theta+') && latex.includes('e^{-at}')) {
    return '性状均值会随时间从初始值向最适值靠近，靠近速度由稳定选择强度控制。';
  }

  if (latex.includes('w_i=') && latex.includes('e^{-(\\Delta_i/2)}')) {
    return 'Akaike 权重把每个候选模型的 AIC 差值转换成相对支持度。';
  }

  if (latex.includes('Q_{x}=\\mathbf{x}^{T}\\mathbf{x}')) {
    return 'Berg-Coop Qx 统计量衡量 GWAS 效应在群体间偏离中性协方差预期的程度。';
  }

  if (latex.includes('\\Delta\\mu_{A_{z}}=') && latex.includes('\\sigma(A_{z},w)')) {
    return '育种值均值的变化等于育种值与相对适合度的协方差。';
  }

  if (latex.includes('\\bar\\imath=') && latex.includes('\\varphi')) {
    return '截断选择强度等于选择差除以标准差，也可由截断点的正态密度和入选比例算出。';
  }

  if (latex.includes('S=\\varphi') && latex.includes('\\frac{\\sigma}{p}')) {
    return '截断选择差由截断点的正态密度、性状标准差和入选比例共同决定。';
  }

  if (latex.includes('\\Delta\\mu_{t}') && latex.includes('\\rho') && latex.includes('S_{t}-S_{t-1}')) {
    return '短期均值变化由上一轮均值变化和相邻两代选择差的改变共同传递。';
  }

  if (latex.includes('b_{op}=') && latex.includes('\\sigma_A^2') && latex.includes('\\sigma_AA^2')) {
    return '亲子回归斜率合并加性、上位性和亲子环境协方差，用来预测短期响应。';
  }

  if (latex.includes('z_{o}=\\mu+') && latex.includes('z_{m}') && latex.includes('z_{f}')) {
    return '后代表型由群体均值、父母偏离均值的遗传贡献以及环境残差相加得到。';
  }

  if (latex.includes('\\sigma_{E}^{2}=\\mathrm{E}') && latex.includes('\\mu_{A_{v}}')) {
    return '环境方差等于基础环境方差加上环境方差育种值的群体均值。';
  }

  if (latex.includes('z_{i}=\\mu+G_{i}+E')) {
    return '个体表型由群体均值、基因型效应和环境偏差相加得到。';
  }

  if (latex.includes('\\overline{z}_{t}=\\mu_{t}+e_{t}')) {
    return '第 t 代样本平均性状等于该系真实均值加上抽样残差。';
  }

  if (latex.includes('\\delta_{i}=\\overline{z}_{i}-z_{i}')) {
    return '个体后代均值相对自身性状的偏离，由亲代回归、亲代均值差和残差共同决定。';
  }

  if (latex.includes('e_{x}=x-') && latex.includes('\\beta_{x|z}')) {
    return '把 x 中能由 z 线性预测的部分扣除，剩下的是相对 z 的残差。';
  }

  if (latex.includes('E[z_{o}\\midz_{fa},z_{mo}]=')) {
    return '用父本和母本性状相对均值的偏离，预测后代性状的期望值。';
  }

  if (latex.includes('E_{s}') && latex.includes('S_{fa}') && latex.includes('S_{mo}')) {
    return '被选亲本的后代均值等于基础均值，加上父本和母本选择差的回归加权贡献。';
  }

  if (latex.includes('E[y_{o}-\\mu_{y}\\midz_{x}]=')) {
    return '用被选性状 x 的偏离预测后代响应性状 y 的期望偏离。';
  }

  if (latex.includes('R_{y}=\\mu_{y}^{**}-\\mu_{y}') && latex.includes('S_{z}')) {
    return '选择 z 性状时，y 性状的相关响应由两性状协方差、z 的选择差和性状尺度共同决定。';
  }

  if (latex.includes('\\mathbf{R}=\\mathbf{G}\\mathbf{P}^{-1}\\mathbf{S}')) {
    return '多性状选择响应由遗传协方差矩阵、表型协方差矩阵和选择差向量共同决定。';
  }

  if (latex.includes('\\boldsymbol{\\beta}=\\mathbf{P}^{-1}\\mathbf{S}')) {
    return '把多性状选择差转换成选择梯度，说明每个性状在控制协方差后的选择方向。';
  }

  if ((latex.includes('\\widehat{\\boldsymbol{\\mu}}') || latex.includes('\\widehat{\\mu}')) && latex.includes('\\widehat{\\mathbf{a}}')) {
    return '简化后的混合模型方程同时估计总体均值和个体育种值。';
  }

  if (latex.includes('\\Delta\\overline{z}') || latex.includes('\\Delta{z}') || latex.includes('w|\\Delta')) {
    return '把总选择梯度拆成直接效应和社会效应两部分，说明群体均值变化来自哪里。';
  }

  if (latex.includes('\\mathbf{y}=\\mathbf{X}\\boldsymbol{\\beta}+\\mathbf{Z}\\mathbf{a}+\\mathbf{e}')) {
    return '混合模型把观测值分解为固定效应、随机育种值和残差。';
  }

  if (latex.includes('S_{1}=P_{11}\\beta_{1}+P_{12}\\beta_{2}')) {
    return '性状 1 的选择差混合了自身直接选择和与性状 2 协方差带来的间接选择。';
  }

  if (latex.includes('R_{y}=') && latex.includes('S_{x_{m}}') && latex.includes('S_{x_{f}}')) {
    return '对子代性状 y 的响应等于母本和父本两个被选性状贡献的和。';
  }

  if (latex.includes('z_i=P_{d_i}') && latex.includes('P_{s_j}')) {
    return '个体表型由自己的直接效应和同组其他个体的社会效应相加得到。';
  }

  if (latex.includes('B=-2\\sum') && latex.includes('d_{i}p_{i}(1-p_{i})')) {
    return '近交衰退参数汇总各位点显性偏离和等位基因频率共同造成的平均效应。';
  }

  if (latex.includes('n_{e}=\\frac{n}{1+c_{v}^{2}}')) {
    return '有效位点数会随各位点遗传方差贡献的不均匀程度而低于实际位点数。';
  }

  if (latex.includes('\\widehat{n}=') && latex.includes('R_{H}R_{L}') && latex.includes('\\sigma_{A}^{2}')) {
    return '用高、低选择线响应的乘积和加性遗传方差估计影响性状的位点数。';
  }

  if (latex.includes('x=\\frac{r\\sqrt{n}}{2d}')) {
    return 'Fisher 尺度参数把突变步长、性状维度和到最适点的距离合成，用来计算突变有利概率。';
  }

  if (latex.includes('\\widetilde{h}^{2}=') && latex.includes('h_{m}^{2}')) {
    return '平衡遗传力由有效群体大小和突变输入决定，并随突变遗传力增加而接近上限。';
  }

  if (latex.includes('\\overline{W}_{1}=') && latex.includes('\\sum_{r=1}^{n}W_{1}(r)')) {
    return '第一轮平均适合度是所有个体在该选择事件中的适合度平均。';
  }

  if (latex.includes('S_i=\\sum') && latex.includes('\\beta_j') && latex.includes('P_{ij}')) {
    return '某性状的选择差等于所有性状选择梯度按表型协方差加权后的合成结果。';
  }

  if (latex.includes('\\widehat{\\theta}=\\max_{\\theta}')) {
    return '贝叶斯点估计取后验分布达到最大的位置。';
  }

  if (latex.includes('X^{2}=-2k\\ln') && latex.includes('\\overline{p}_{G}')) {
    return 'Fisher 合并检验把多个 p 值的几何平均转成卡方统计量。';
  }

  if (latex.includes('\\theta=\\cos^{-1}') && latex.includes('||\\bf{x}||')) {
    return '两个向量之间的角度由点积除以各自长度乘积的反余弦给出。';
  }

  if (latex.includes('\\nabla\\mathbf{x}[f]=') && latex.includes('\\partial')) {
    return '梯度向量收集函数对每个变量的偏导数。';
  }

  return '';
}

function isCorrelatedResponseAccuracyFormula(latex = '', context = ''): boolean {
  const compact = normalizeLatex(latex);
  const lowerContext = context.toLowerCase();
  return (
    compact.includes('R_{y}=') &&
    compact.includes('\\bar{\\imath}_{z}') &&
    compact.includes('\\rho(z_{x},y_{o})') &&
    (compact.includes('\\sigma(y)') || lowerContext.includes('accuracy in predicting'))
  );
}

function isSweepLinkedHeterozygosityFormula(latex = '', context = ''): boolean {
  const compact = normalizeLatex(latex);
  const lowerContext = context.toLowerCase();
  return (
    (compact.includes('\\frac{H_{h}}{H_{0}}') || compact.includes('H_{h}/H_{0}')) &&
    compact.includes('p(0)') &&
    (compact.includes('c/s') || compact.includes('\\frac{2c}{s}') || lowerContext.includes('linked to a selected site'))
  );
}

function isTaroneGreenlandNeutralityIndexFormula(latex = '', context = ''): boolean {
  const compact = normalizeLatex(latex);
  const lowerContext = context.toLowerCase();
  return (
    (compact.includes('NI_{TG}=') || compact.includes('NI_TG=')) &&
    compact.includes('D_{si}') &&
    compact.includes('P_{ai}') &&
    (lowerContext.includes('tarone') || lowerContext.includes('greenland') || lowerContext.includes('odds ratio'))
  );
}

function isPathAnalysisTotalEffectFormula(latex = '', context = ''): boolean {
  const compact = normalizeLatex(latex);
  const lowerContext = context.toLowerCase();
  return (
    compact.includes('\\boldsymbol{\\eta}=') &&
    compact.includes('\\boldsymbol{\\Phi}') &&
    compact.includes('\\boldsymbol{\\beta}_{pa}') &&
    (compact.includes('(\\mathbf{I}-\\mathbf{B})^{-1}') || lowerContext.includes('path analysis'))
  );
}

function isAssortativeMatingResponseFormula(latex = '', context = ''): boolean {
  const compact = normalizeLatex(latex);
  const lowerContext = context.toLowerCase();
  return (
    compact.includes('R(k)=') &&
    compact.includes('h^{2}(k)') &&
    compact.includes('d(k)') &&
    (lowerContext.includes('assortative mating') || lowerContext.includes('single-generation response'))
  );
}

function isSelectionExperimentCvFormula(latex = '', context = ''): boolean {
  const compact = normalizeLatex(latex);
  const lowerContext = context.toLowerCase();
  return (
    compact.includes('E\\left[R_{C}(t)\\right]') &&
    compact.includes('\\mathrm{CV}\\left[R_{C}(t)\\right]') &&
    (compact.includes('Nt') || lowerContext.includes('without a control line'))
  );
}

function splitLatexSides(latex = ''): { lhs: string; rhs: string } {
  const cleaned = latex
    .replace(/\\begin\{[^{}]+\}/g, '')
    .replace(/\\end\{[^{}]+\}/g, '')
    .trim();
  const index = cleaned.indexOf('=');
  if (index < 0) return { lhs: '', rhs: cleaned };
  return {
    lhs: cleaned.slice(0, index).trim(),
    rhs: cleaned.slice(index + 1).trim(),
  };
}

function readableFormulaSymbol(symbol: string, input: BuildFormulaLearningCopyInput): string {
  const context = [input.latex, input.context, input.section].filter(Boolean).join(' ');
  const known = conciseKnownSymbolLabel(symbol, context);
  if (known) return known;
  const compact = normalizeLatex(symbol);
  const cleaned = cleanSymbolForText(symbol);

  if (/^\\widehat\{?\\?theta/.test(compact) || /^widehattheta/.test(cleaned)) return 'θ 估计量';
  if (/^\\widehat/.test(compact) || /^widehat/.test(cleaned)) return `估计的${cleaned.replace(/^widehat/, '') || '目标量'}`;
  if (/^\\Delta\\mathbf\{?p\}?/.test(compact) || /^Deltap$/.test(cleaned)) return '等位基因频率变化向量';
  if (/^\\Delta/.test(compact) || /^Delta/.test(cleaned)) return `${cleaned.replace(/^Delta/, '') || '目标量'}的变化量`;
  if (/^\\mathbf\{?V\}?/.test(compact)) return '方差协方差矩阵';
  if (/^\\mathbf\{?p\}?/.test(compact)) return '频率向量';
  if (/^\\mathbf\{?y\}?/.test(compact)) return '观测向量';
  if (/^\\mathbf\{?X\}?/.test(compact)) return '设计矩阵';
  if (/^\\mathbf\{?M\}?/.test(compact)) return '转移矩阵';
  if (/^\\mathbf/.test(compact) || /^mathbf/.test(cleaned)) return '矩阵或向量量';

  if (/^R(?:_|\b)/.test(compact)) return '选择响应';
  if (/^S(?:_|\b)/.test(compact)) return '选择差';
  if (/^\\bar\{\\imath\}|^\\overline\{\\imath\}/.test(compact)) return '选择强度';
  if (/^\\rho/.test(compact)) return '预测准确度';
  if (/^h\^\{?2\}?$/.test(compact)) return '狭义遗传力';
  if (/^\\sigma/.test(compact)) return compact.includes('^') ? '方差' : '标准差';
  if (/^H(?:_|\b)/.test(compact)) return '杂合度';
  if (/^NI/.test(compact)) return '中性指数';
  if (/^\\boldsymbol\{\\eta\}/.test(compact)) return '总选择效应';
  if (/^\\boldsymbol\{\\beta\}/.test(compact)) return '直接选择梯度';
  if (/^d(?:\(|_|\b)/.test(compact)) return '连锁不平衡量';
  if (/^p(?:\(|_|\b)/.test(compact)) return '等位基因频率';
  if (/^D(?:_|\b)/.test(compact)) return '分化量';
  if (/^P(?:_|\b)/.test(compact)) return '多态性';

  return cleaned || '目标量';
}

function uniqueFormulaLabels(items: string[]): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  items.forEach((item) => {
    const normalized = item.replace(/\s+/g, '');
    if (!item || seen.has(normalized)) return;
    seen.add(normalized);
    labels.push(item);
  });
  return labels;
}

function joinChineseList(items: string[]): string {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]}和${items[1]}`;
  return `${items.slice(0, -1).join('、')}和${items[items.length - 1]}`;
}

function formulaTopicPhrase(input: BuildFormulaLearningCopyInput): string {
  const context = [input.section, input.context].filter(Boolean).join(' ').toLowerCase();
  if (context.includes('breeder') || context.includes('single-generation response')) return '一代选择响应';
  if (context.includes('assortative mating')) return '选型交配下的选择响应';
  if (context.includes('control populations') || context.includes('experimental designs')) return '选择实验的响应和不确定性';
  if (context.includes('neutral locus linked to a selected site')) return '选择扫荡后的连锁多样性';
  if (context.includes('molecular data') || context.includes('neutrality') || context.includes('divergence-based')) return '中性检验';
  if (context.includes('path analysis')) return '路径分析中的选择效应';
  if (context.includes('wright-fisher') || context.includes('neutral evolution')) return '中性漂变';
  if (context.includes('correlation') || context.includes('accuracy in predicting')) return '相关性状的响应预测';
  return '当前主题';
}

function formulaVerbForContext(input: BuildFormulaLearningCopyInput, lhs: string): string {
  const context = [input.section, input.context].filter(Boolean).join(' ').toLowerCase();
  if (lhs.includes('概率') || lhs.includes('P_') || context.includes('probability')) return '计算';
  if (lhs.includes('估计') || context.includes('estimate') || context.includes('estimator')) return '估计';
  if (lhs.includes('检验') || context.includes('test statistic') || context.includes('test')) return '衡量';
  if (lhs.includes('响应') || context.includes('response')) return '预测';
  if (lhs.includes('频率') || context.includes('frequency')) return '更新';
  if (lhs.includes('均值') || context.includes('mean')) return '求出';
  if (lhs.includes('方差') || context.includes('variance')) return '分解';
  if (lhs.includes('适合度') || context.includes('fitness')) return '计算';
  if (lhs.includes('杂合度') || context.includes('heterozygosity')) return '追踪';
  return '计算';
}

function structuralFormulaSummary(input: BuildFormulaLearningCopyInput): string {
  const family = formulaFamilyTakeaway(input);
  if (family) return family;

  const sides = splitLatexSides(input.latex || '');
  const lhsSymbol = lhsPrimarySymbol(sides.lhs);
  const lhs = lhsSymbol ? readableFormulaSymbol(lhsSymbol, input) : '';
  const rhsSymbols = extractLatexVariableSymbols(sides.rhs)
    .filter((symbol) => !lhsSymbol || symbolKey(symbol) !== symbolKey(lhsSymbol))
    .map((symbol) => readableFormulaSymbol(symbol, input));
  const rhsLabels = uniqueFormulaLabels(rhsSymbols).filter((label) => label && label !== lhs).slice(0, 3);

  const verb = formulaVerbForContext(input, lhs);
  if (lhs && rhsLabels.length >= 2) return `用${joinChineseList(rhsLabels)}${verb}${lhs}。`;
  if (lhs && rhsLabels.length === 1) return `用${rhsLabels[0]}${verb}${lhs}。`;
  if (lhs) return `给出${lhs}的${verb}方式。`;
  return '把本式关注的量写成可比较、可代入的数学关系。';
}

function formulaActionText(input: BuildFormulaLearningCopyInput): string {
  const label = formulaDisplayName(input);
  const latex = normalizeLatex(input.latex);
  const context = (input.context || '').toLowerCase();
  if (isHeterozygosityDecayFormula(input.latex, input.context)) return '先看起点 H_0，再看每代保留比例 (1 - 1/(2N))，最后读 t 代后的 H_t。';
  if (latex.includes('\\varphi') && (latex.includes('p_{t}') || context.includes('probability density'))) return '先把它当成 p 的“位置地图”：看清起点 p0、时间 t、终点 pt，再暂时放过长求和细节。';
  if (latex.includes('E(t)=') || context.includes('expected age')) return '先把 p 当成当前频率，再读 E(t) 是“这条中性等位基因大约存在了多久”。';
  if (latex.includes('\\sigma_{p}^{2}') || context.includes('among-population variance')) return '先问不同群体的 p 会散开多宽，再看 2N 和 t 如何控制散开的速度。';
  if (latex.includes('E(p_{t})=p_{0}') || context.includes('no directional forces')) return '先记住这条中性基线：漂变会让单个群体摇晃，但平均方向不偏。';
  if (latex.includes('\\Delta') && latex.includes('p_{i}') && context.includes('frequency of allele')) return '先找出选择强度、等位基因效应和 p_i 的位置，再看选择怎样给频率一个方向。';
  if (latex.includes("p_{j}^{\\prime}") || context.includes('average effect')) return '先把 p_j 和 b_j 看成一对会共同更新的状态量，再看 Price 框架如何拆分变化来源。';
  if (isParentSpecificBreederResponseFormula(input.latex, input.context)) return '先把 R 当成下一代响应，再看父本和母本的选择差如何被对应的亲子回归系数加权相加。';
  if (isCorrelatedResponseAccuracyFormula(input.latex, input.context)) return '先把 R_y 读作相关性状的响应，再看它如何由选择强度、预测准确度和 y 性状标准差相乘得到。';
  if (input.latex?.includes('P_{ij}')) return '先把 i、j、2N 和 P_ij 对应到“这一代到下一代”的抽样过程，再展开后继矩阵。';
  if (input.latex?.includes('\\sigma_{A}^{2}') || input.latex?.includes('h^')) return '先确认哪些量描述变异、哪些量描述选择强度，再看响应如何被预测。';
  if (input.latex?.includes('\\pi') && input.latex?.includes('D')) return '先分清多态性、分化和突变率各自的位置，再看检验统计量怎样比较它们。';
  return structuralFormulaSummary(input) || `${label} 把本式关注的量写成可代入、可比较的数学关系。`;
}

function isHeterozygosityDecayFormula(latex = '', context = ''): boolean {
  const compact = normalizeLatex(latex);
  const lowerContext = context.toLowerCase();
  const hasHeterozygosityTerms =
    (compact.includes('H_{t}') || compact.includes('H_t')) &&
    (compact.includes('H_{0}') || compact.includes('H_0'));
  const hasDriftDecayFactor =
    compact.includes('\\frac{1}{2N}') ||
    compact.includes('1/(2N)') ||
    compact.includes('1-1/2N');
  return hasHeterozygosityTerms && hasDriftDecayFactor && (compact.includes('^{t}') || lowerContext.includes('heterozygosity'));
}

function isParentSpecificBreederResponseFormula(latex = '', context = ''): boolean {
  const compact = normalizeLatex(latex);
  const lowerContext = context.toLowerCase();
  const hasDaughterOrSonResponse = /R_\{?(?:da|so)\}?=/.test(compact);
  const hasParentSelectionTerms =
    (compact.includes('S_{fa}') || compact.includes('S_fa')) &&
    (compact.includes('S_{mo}') || compact.includes('S_mo'));
  const hasParentRegressionTerms =
    compact.includes('b_{da,fa}') ||
    compact.includes('b_{da,mo}') ||
    compact.includes('b_{so,fa}') ||
    compact.includes('b_{so,mo}');
  const contextMatches =
    lowerContext.includes('selected parents') &&
    (lowerContext.includes('regression coefficient of daughters') ||
      lowerContext.includes('mother-daughter regression coefficient') ||
      lowerContext.includes('likewise, for sons'));

  return (hasDaughterOrSonResponse && hasParentSelectionTerms && hasParentRegressionTerms) || contextMatches;
}

function isWrightFisherTransitionFormula(latex = '', context = ''): boolean {
  const compact = normalizeLatex(latex);
  const lowerContext = context.toLowerCase();
  return (
    (compact.includes('P_{ij}=') || compact.includes('P_ij=')) &&
    (compact.includes('\\binom') || compact.includes('2N')) &&
    (lowerContext.includes('wright-fisher') || lowerContext.includes('binomial') || lowerContext.includes('gamete'))
  );
}

function formulaTakeawayText(input: BuildFormulaLearningCopyInput, plainMeaning: string): string {
  const latex = normalizeLatex(input.latex);
  const context = (input.context || '').toLowerCase();
  const family = formulaFamilyTakeaway(input);
  if (family) return family;
  if (isHeterozygosityDecayFormula(input.latex, input.context)) return '杂合度按固定比例逐代下降；N 越大，下降越慢。';
  if (isWrightFisherTransitionFormula(input.latex, input.context)) return '计算 Wright-Fisher 模型中，从 i 个拷贝转到下一代 j 个拷贝的概率。';
  if (latex.includes('\\varphi') && (latex.includes('p_{t}') || context.includes('probability density'))) return '从 p0 出发，t 代后的 p 有一张概率地图。';
  if (latex.includes('E(t)=') || context.includes('expected age')) return '当前频率 p 可以反推出中性等位基因的大致年龄。';
  if (latex.includes('\\sigma_{p}^{2}') || context.includes('among-population variance')) return '漂变让不同群体的 p 逐渐散开，方差记录散开的宽度。';
  if (latex.includes('E(p_{t})=p_{0}') || context.includes('no directional forces')) return '中性漂变会摇晃 p，但平均方向不偏离 p0。';
  if (latex.includes('\\Delta') && latex.includes('p_{i}') && context.includes('frequency of allele')) return '选择开始给 p_i 的变化一个方向。';
  if (latex.includes("p_{j}^{\\prime}") || context.includes('average effect')) return '频率和等位基因效应可以一起更新。';
  if (isParentSpecificBreederResponseFormula(input.latex, input.context)) return '下一代响应由父本和母本的选择差共同决定，并按亲子回归系数加权。';
  if (/R=h\^\{?2\}?S/.test(latex)) return '选择响应等于狭义遗传力乘以选择差。';
  if (/R=\\sigma_\{?A\}?\^\{?2\}?\\beta/.test(latex) || (latex.includes('\\sigma_{A}^{2}') && latex.includes('\\beta'))) return '选择响应等于加性遗传方差乘以选择梯度。';
  if (isCorrelatedResponseAccuracyFormula(input.latex, input.context)) return '把相关性状的响应写成选择强度、预测准确度和性状变异的乘积。';
  if (isSweepLinkedHeterozygosityFormula(input.latex, input.context)) return '估计选择扫荡后，连锁中性位点还能保留多少初始杂合度。';
  if (isTaroneGreenlandNeutralityIndexFormula(input.latex, input.context)) return '把多个基因的多态性和分化信息加权合并成一个中性指数。';
  if (isPathAnalysisTotalEffectFormula(input.latex, input.context)) return '把直接选择梯度通过路径矩阵转换成总选择效应。';
  if (isAssortativeMatingResponseFormula(input.latex, input.context)) return '计算经历 k 代选型交配后，单代选择能产生的响应。';
  if (isSelectionExperimentCvFormula(input.latex, input.context)) return '同时给出无对照线选择实验的期望响应和响应变异系数。';

  const structural = structuralFormulaSummary(input);
  if (structural) return trimLearningSentence(structural, 92);

  return trimLearningSentence(
    withoutFormulaLead(plainMeaning, input) || '给出当前主题中的关键计算关系。',
    92,
  );
}

export function polishFormulaLearningCopy(copy: FormulaLearningCopy, input: BuildFormulaLearningCopyInput = {}): ReadableFormulaCopy {
  const chapterText = formulaLocation(input);
  const plainMeaning = trimLearningSentence(
    copy.plainMeaning || structuralFormulaSummary(input),
    170,
  );
  const inThisChapter = trimLearningSentence(
    copy.inThisChapter ||
      `在${chapterText}中，它概括${formulaTopicPhrase(input)}里需要计算的核心关系。`,
    170,
  );
  const cachedTakeaway = input.takeawayCache?.[input.formulaId || ''];
  const takeaway = formulaTakeawayText(input, plainMeaning);
  return {
    plainMeaning: cachedTakeaway || plainMeaning,
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
      plainMeaning: `${label} 把等位基因频率和等位基因效应都写成“旧值加变化”。也就是说，故事不只记录某个等位基因多了多少，还记录它带来的效应有没有变。`,
      inThisChapter: `它把 p 的故事接进 Price 方程：频率变化和效应变化被放到同一张账本里，后面才能拆分演化响应来自哪里。`,
    };
  }

  if (isParentSpecificBreederResponseFormula(input.latex, input.context)) {
    return {
      plainMeaning: `${label} 把后代的选择响应 R 拆成父本和母本两条贡献：各自的选择差 S，乘上对应的亲子回归系数 b，再相加得到下一代的预期变化。`,
      inThisChapter: `在${chapterText}中，它把育种者方程推广到父母分别被选择的情形，说明父本和母本的选择压力会怎样共同决定后代响应。`,
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
      plainMeaning: `${label} 把选择响应写成加性遗传方差与选择梯度的乘积。它强调：选择能推动多少变化，既取决于可遗传变异有多少，也取决于性状和适合度之间的关联强度。`,
      inThisChapter: `在${chapterText}中，它把育种者方程改写到 Robertson-Price / Lande 方程的语言里，为后面多性状响应和矩阵形式做铺垫。`,
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
      plainMeaning: `${label} 同时写出中性模型下的第 i 位点多态性和群体间分化。两者都含有第 i 位点突变率，因此可以用它们的比例比较不同基因座是否符合中性预期。`,
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
  const formulaSummary = structuralFormulaSummary(input);
  return {
    plainMeaning: readableHint
      ? `${label} 把本节正在讨论的对象写成可计算的关系。${readableHint}`
      : `${label} ${withoutFormulaLead(formulaSummary, input) || '把本节关注的量写成可代入、可比较的数学关系。'}`,
    inThisChapter: `在${chapterText}中，它把${formulaTopicPhrase(input)}中的关键问题压缩成一个可计算的公式。`,
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

function humanizeSubscriptLabel(value = ''): string {
  const cleaned = cleanSubscriptLabel(value).replace(/\s+/g, '');
  const labels: Record<string, string> = {
    fa: '父本',
    f: '父本',
    mo: '母本',
    m: '母本',
    da: '雌性后代',
    daughter: '雌性后代',
    so: '雄性后代',
    son: '雄性后代',
    o: '后代',
    p: '亲本',
    z: 'z 性状',
    y: 'y 性状',
    x: 'x 性状',
    w: '适合度',
    W: '适合度',
    A: '育种值',
    Az: 'z 性状育种值',
    A_z: 'z 性状育种值',
    Aw: '适合度育种值',
    A_w: '适合度育种值',
    Ay: 'y 性状育种值',
    A_y: 'y 性状育种值',
  };
  return labels[cleaned] || cleaned;
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
  const label = humanizeSubscriptLabel(subscript);
  if (!label) return baseLabel;
  if (/^[0-9]+$/.test(label)) return `第 ${label} 类${baseLabel}`;
  if (/^[A-Za-zΑ-Ωα-ω]$/u.test(label)) return `第 ${label} 类${baseLabel}`;
  return `${label}的${baseLabel}`;
}

function humanizeTraitRoleSubscript(value = ''): string {
  return humanizeSubscriptLabel(value).replace(/\s*性状$/, '');
}

function traitRoleLabel(subscript: string, role: string): string {
  const label = humanizeTraitRoleSubscript(subscript);
  return /^[A-Za-zΑ-Ωα-ω]$/u.test(label) ? `${label} 的${role}` : `${label}的${role}`;
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
  const lowerContext = context.toLowerCase();
  const hasSelectionGradientStructure =
    /\\sigma_\{?z\}?\^\{?2\}?/.test(compactContext) ||
    /\\sigma\(?\{?z\}?\)?\^\{?2\}?/.test(compactContext) ||
    /R=.*\\beta/.test(compactContext) ||
    /\\sigma_\{?A\}?\^\{?2\}?\\beta/.test(compactContext);

  if ((normalized === '\\mu^*' || normalized === '\\mu^{*}') && (hasTraitContext || hasFitnessContext || hasQuantGenContext)) {
    return '选择后加权均值';
  }
  if (/^p(?:_\{?([^{}]+)\}?)?\^\{?2\}?$/.test(normalized)) {
    const subscript = normalized.match(/^p_\{?([^{}]+)\}?/)?.[1] || '';
    return subscript ? formatIndexedLabel(subscript, '等位基因频率平方项') : '等位基因频率平方项';
  }
  if (/^p(?:_\{?([^{}]+)\}?)?\^\{?3\}?$/.test(normalized)) {
    const subscript = normalized.match(/^p_\{?([^{}]+)\}?/)?.[1] || '';
    return subscript ? formatIndexedLabel(subscript, '等位基因频率三次项') : '等位基因频率三次项';
  }
  if (/^z(?:_\{?([^{}]+)\}?)?\^\{?2\}?$/.test(normalized) && hasTraitContext) {
    const subscript = normalized.match(/^z_\{?([^{}]+)\}?/)?.[1] || '';
    return subscript ? formatIndexedLabel(subscript, '性状平方项') : '性状平方项';
  }
  if (/^s\^\{?2\}?$/.test(normalized) && (hasFitnessContext || hasTraitContext)) return '选择强度平方项';
  if (/^s\^\{?3\}?$/.test(normalized) && (hasFitnessContext || hasTraitContext)) return '选择强度三次项';
  if (normalized === 'O' && /O\s*\(/.test(context)) return '高阶误差项';
  if (/^E\^\{?\\prime\}?$/.test(normalized) && /environment|环境/.test(lowerContext)) return '后代环境条件';
  if (/^\\(?:overline|bar)\{W\}\^\{?\\prime\}?$/.test(normalized) && hasFitnessContext) return '选择后平均适合度';

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

  const meanBreedingValueSubscript = overlineSubscript(normalized, 'A');
  if (meanBreedingValueSubscript !== null) {
    const label = meanBreedingValueSubscript ? formatIndexedLabel(meanBreedingValueSubscript, '育种值') : '育种值';
    return `平均${label}`;
  }

  const breedingValueSubscript = extractSubscript(normalized, 'A');
  if (breedingValueSubscript) {
    return formatIndexedLabel(breedingValueSubscript, '育种值');
  }

  const selectionIntensitySubscript = overlineSubscript(normalized, '\\\\imath');
  if (selectionIntensitySubscript !== null) {
    return selectionIntensitySubscript ? `${selectionIntensitySubscript} 的选择强度` : '平均选择强度';
  }

  const sigmaSubscript = extractSubscript(normalized, '\\sigma');
  if (sigmaSubscript) {
    const label = sigmaComponentLabel(sigmaSubscript, /\^\{?2\}?/.test(normalized));
    if (label) return label;
  }

  const responseSubscript = extractSubscript(normalized, 'R');
  if ((normalized === 'R' || responseSubscript) && hasTraitContext) {
    return responseSubscript ? traitRoleLabel(responseSubscript, '选择响应') : '选择响应';
  }

  const differentialSubscript = extractSubscript(normalized, 'S');
  if ((normalized === 'S' || differentialSubscript) && hasTraitContext) {
    return differentialSubscript ? traitRoleLabel(differentialSubscript, '选择差') : '选择差';
  }

  const betaSubscript = extractSubscript(normalized, '\\beta');
  if ((normalized === '\\beta' || betaSubscript) && (hasTraitContext || hasFitnessContext || hasSelectionGradientStructure)) {
    return betaSubscript ? traitRoleLabel(betaSubscript, '选择梯度') : '选择梯度';
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
    '\\mathbf{R}': '响应向量',
    '\\mathbf{G}': '遗传协方差矩阵',
    '\\mathbf{P}': '表型协方差矩阵',
    '\\mathbf{S}': '选择差向量',
    '\\mathbf{B}': '路径系数矩阵',
    '\\mathbf{I}': '单位矩阵',
    '\\mathbf{D}': '标准差尺度矩阵',
    '\\mathbf{z}': '性状向量',
    '\\boldsymbol{\\mu}': '均值向量',
    '\\boldsymbol{\\eta}': '总选择效应',
    '\\boldsymbol{\\Phi}': '路径传递矩阵',
    '\\boldsymbol{\\beta}_{pa}': '直接选择梯度',
    '\\boldsymbol{\\beta}': '选择梯度向量',
    '\\boldsymbol{\\sigma}': '标准差向量',
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
    .replace(/\\(?:widehat|hat|overline|bar|tilde|widetilde|vec)\{([^{}]+)\}/g, '$1')
    .replace(/\\(?:mathbf|boldsymbol|mathrm|mathbb|mathcal|mathit|mathsf)\{([^{}]+)\}/g, '$1')
    .replace(/\\(?:mathbf|boldsymbol|mathrm|mathbb|mathcal|mathit|mathsf)\s+(\\?[A-Za-z])/g, '$1')
    .replace(/\\operatorname\{([^{}]+)\}/g, '$1')
    .replace(/\\Delta/g, 'Δ')
    .replace(/\\mu/g, 'μ')
    .replace(/\\theta/g, 'θ')
    .replace(/\\sigma/g, 'σ')
    .replace(/\\rho/g, 'ρ')
    .replace(/\\lambda/g, 'λ')
    .replace(/\\gamma/g, 'γ')
    .replace(/\\eta/g, 'η')
    .replace(/\\varphi/g, 'φ')
    .replace(/\\pi/g, 'π')
    .replace(/\\imath/g, 'i')
    .replace(/\\/g, '')
    .replace(/[{}&]/g, '')
    .replace(/_/g, '')
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
  return Boolean(/^[A-Z]$/.test(symbolValue) && wholeValue && wholeValue !== symbolValue && wholeValue.includes(symbolValue));
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
