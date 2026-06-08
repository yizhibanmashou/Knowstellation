import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEPENDENCY_DIR = resolve(ROOT, 'data/frontend/dependency');
const PROMPT_DIR = resolve(ROOT, 'data/frontend/symbol_sense/prompts');
const STRUCTURED_DIR = resolve(ROOT, 'data/structured');
const OUTPUT_DIR = resolve(ROOT, 'data/frontend/concept_graph');

const COMMON_SYMBOL_NAMES = new Map([
  ['N', 'Population Size'],
  ['n', 'Count'],
  ['i', 'Index'],
  ['j', 'Index'],
  ['k', 'Index'],
  ['t', 'Time'],
  ['p', 'Probability'],
  ['q', 'Frequency'],
  ['w', 'Fitness'],
  ['W', 'Absolute Fitness'],
  ['z', 'Trait Value'],
  ['x', 'Variable'],
  ['y', 'Response Variable'],
  ['S', 'Selection Differential'],
  ['R', 'Response'],
  ['V', 'Variance'],
  ['C', 'Cost'],
  ['B', 'Benefit'],
  ['E', 'Expectation'],
  ['Cov', 'Covariance'],
  ['Var', 'Variance'],
  ['Pr', 'Probability'],
  ['P', 'Probability'],
  ['L', 'Likelihood'],
  ['a', 'Coefficient'],
  ['b', 'Coefficient'],
  ['d', 'Distance'],
  ['f', 'Function'],
  ['h', 'Function'],
  ['m', 'Mean'],
  ['o', 'Order Term'],
  ['r', 'Rate'],
  ['s', 'Selection Coefficient'],
  ['u', 'Mutation Rate'],
  ['v', 'Variance Function'],
  ['T', 'Time'],
  ['I', 'Information'],
  ['B_{0}', 'Bayes Factor'],
  ['I_{f}', 'Fixation Integral'],
  ['\\varphi', 'Probability Density'],
  ['\\phi', 'Probability Density'],
  ['\\pi', 'Stationary Distribution'],
  ['\\Gamma', 'Gamma Function'],
  ['\\nu', 'Degrees of Freedom'],
  ['\\theta', 'Parameter'],
  ['\\widehat{\\theta}', 'Estimator'],
  ['\\Theta', 'Parameter Vector'],
  ['\\boldsymbol{\\theta}', 'Parameter Vector'],
  ['\\widehat{\\boldsymbol{\\theta}}', 'Estimator Vector'],
  ['\\boldsymbol{\\Theta}', 'Parameter Vector'],
  ['\\mathbf{x}', 'Data Vector'],
  ['\\mathbf{I}', 'Identity Matrix'],
  ['\\mathbf{V}', 'Covariance Matrix'],
  ['\\mathbf{W}', 'Wishart Matrix'],
  ['\\mathrm{P}', 'Probability'],
  ['\\mathrm{V}', 'Variance'],
  ['\\mathrm{r}', 'Rate'],
  ['\\mathrm{a}', 'Acceptance Rate'],
  ['NI', 'Neutrality Index'],
  ['NI_{TG}', 'Tarone-Greenland Neutrality Index'],
  ['DoS', 'Direction of Selection Statistic'],
]);

const SUBSCRIPT_SYMBOL_NAMES = [
  { pattern: /^D_\{?ai\}?$/i, name: 'Replacement-Site Divergence per Gene', type: 'quantity_concept' },
  { pattern: /^D_\{?si\}?$/i, name: 'Silent-Site Divergence per Gene', type: 'quantity_concept' },
  { pattern: /^P_\{?ai\}?$/i, name: 'Replacement-Site Polymorphism per Gene', type: 'quantity_concept' },
  { pattern: /^P_\{?si\}?$/i, name: 'Silent-Site Polymorphism per Gene', type: 'quantity_concept' },
  { pattern: /^D_\{?a\}?$/i, name: 'Replacement-Site Divergence', type: 'quantity_concept' },
  { pattern: /^D_\{?s\}?$/i, name: 'Silent-Site Divergence', type: 'quantity_concept' },
  { pattern: /^P_\{?a\}?$/i, name: 'Replacement-Site Polymorphism', type: 'quantity_concept' },
  { pattern: /^P_\{?s\}?$/i, name: 'Silent-Site Polymorphism', type: 'quantity_concept' },
  { pattern: /^S_\{?a\}?$/i, name: 'Replacement-Site Segregating Sites', type: 'quantity_concept' },
  { pattern: /^S_\{?s\}?$/i, name: 'Silent-Site Segregating Sites', type: 'quantity_concept' },
  { pattern: /^\\mu_\{?a\}?$/i, name: 'Replacement-Site Mutation Rate', type: 'quantity_concept' },
  { pattern: /^\\mu_\{?s\}?$/i, name: 'Silent-Site Mutation Rate', type: 'quantity_concept' },
  { pattern: /^\\theta_\{?a\}?$/i, name: 'Replacement-Site Theta', type: 'quantity_concept' },
  { pattern: /^\\theta_\{?s\}?$/i, name: 'Silent-Site Theta', type: 'quantity_concept' },
  { pattern: /^n_\{?a\}?$/i, name: 'Replacement-Site Count', type: 'quantity_concept' },
  { pattern: /^n_\{?s\}?$/i, name: 'Silent-Site Count', type: 'quantity_concept' },
  { pattern: /^D_\{?a,n\}?$/i, name: 'Neutral Replacement Substitutions', type: 'quantity_concept' },
  { pattern: /^\\eta_\{?a\}?$/i, name: 'Adaptive Replacement Substitutions', type: 'quantity_concept' },
  { pattern: /^\\widehat\{\\eta\}_\{?a\}?$/i, name: 'Estimated Adaptive Replacement Substitutions', type: 'quantity_concept' },
  { pattern: /^\\(?:overline|bar)\{?z\}?$/i, name: 'Mean Trait Value', type: 'quantity_concept' },
  { pattern: /^\\(?:overline|bar)\{?[Ww]\}?$/i, name: 'Mean Fitness', type: 'quantity_concept' },
  { pattern: /^A$/i, name: 'Additive Genetic Value', type: 'quantity_concept' },
  { pattern: /^A_\{?T(?:,n)?\}?$/i, name: 'Total Additive Genetic Value', type: 'quantity_concept' },
  { pattern: /^A_\{?incf\}?$/i, name: 'Inclusive-Fitness Breeding Value', type: 'quantity_concept' },
  { pattern: /^A_\{?w\}?$/i, name: 'Fitness Breeding Value', type: 'quantity_concept' },
  { pattern: /^A_\{?z\}?$/i, name: 'Trait Breeding Value', type: 'quantity_concept' },
  { pattern: /^\\overline\{A\}_\{?z\}?$/i, name: 'Mean Trait Breeding Value', type: 'quantity_concept' },
  { pattern: /^\\widehat\{A\}_\{?.+\}?$/i, name: 'Estimated Relationship Matrix', type: 'quantity_concept' },
  { pattern: /^A_\{?.+\}?$/i, name: 'Additive Genetic Component', type: 'quantity_concept' },
  { pattern: /^A\^\{?.+\}?$/i, name: 'Power of Additive Matrix', type: 'math_concept' },
  { pattern: /^\\widehat\{?\\boldsymbol\{?.+\}?\}?$/i, name: 'Estimator Vector', type: 'quantity_concept' },
  { pattern: /^\\boldsymbol\{?.+\}?$/i, name: 'Parameter Vector', type: 'quantity_concept' },
  { pattern: /^\\mathbf\{?I\}?$/i, name: 'Identity Matrix', type: 'math_concept' },
  { pattern: /^\\mathbf\{?.+\}?$/i, name: 'Vector or Matrix Quantity', type: 'math_concept' },
  { pattern: /^P_\{?ij\}?$/i, name: 'Wright-Fisher Transition Probability', type: 'quantity_concept' },
  { pattern: /^P_\{?.+\}?$/i, name: 'Probability', type: 'quantity_concept' },
  { pattern: /^s_\{?.+\}?$/i, name: 'Class Selection Coefficient', type: 'quantity_concept' },
  { pattern: /^q_\{?i\}?$/i, name: 'Class Frequency', type: 'quantity_concept' },
  { pattern: /^z_\{?i\}?$/i, name: 'Class Trait Value', type: 'quantity_concept' },
  { pattern: /^w_\{?i\}?$/i, name: 'Class Fitness', type: 'quantity_concept' },
  { pattern: /^x_\{?i\}?$/i, name: 'State Probability', type: 'quantity_concept' },
  { pattern: /^f_\{?t\}?$/i, name: 'Inbreeding Coefficient', type: 'quantity_concept' },
  { pattern: /^H_\{?t\}?$/i, name: 'Heterozygosity', type: 'quantity_concept' },
  { pattern: /^\\lambda_\{?.+\}?$/i, name: 'Eigenvalue', type: 'math_concept' },
  { pattern: /^\\mu_\{?z\}?$/i, name: 'Mean Trait Value', type: 'quantity_concept' },
  { pattern: /^\\mu_\{?.+\}?$/i, name: 'Mean', type: 'quantity_concept' },
  { pattern: /^\\sigma_\{?A\}?\^\{?2\}?$/i, name: 'Additive Genetic Variance', type: 'quantity_concept' },
  { pattern: /^\\sigma_\{?B\}?\^\{?2\}?$/i, name: 'Among-Block Variance', type: 'quantity_concept' },
  { pattern: /^\\sigma_\{?G\}?\^\{?2\}?$/i, name: 'Genetic Variance', type: 'quantity_concept' },
  { pattern: /^\\sigma_\{?e\}?\^\{?2\}?$/i, name: 'Within-Block Environmental Variance', type: 'quantity_concept' },
  { pattern: /^\\sigma_\{?z\}?\^\{?2\}?$/i, name: 'Trait Variance', type: 'quantity_concept' },
  { pattern: /^\\sigma(?:_\{?.+\}?)?\^\{?2\}?$/i, name: 'Variance', type: 'quantity_concept' },
  { pattern: /^\\omega(?:\^\{?2\}?)?$/i, name: 'Fitness Width', type: 'quantity_concept' },
  { pattern: /^\\Theta$/, name: 'Parameter Vector', type: 'quantity_concept' },
  { pattern: /^\\theta$/, name: 'Optimal Trait Value', type: 'quantity_concept' },
  { pattern: /^V_\{?s\}?$/i, name: 'Strength of Stabilizing Selection', type: 'quantity_concept' },
  { pattern: /^z\^\{\*\}$/i, name: 'Optimal Trait Value', type: 'quantity_concept' },
  { pattern: /^\\widehat\{?I\}?$/i, name: 'Monte Carlo Estimate', type: 'quantity_concept' },
  { pattern: /^\\widehat\{?h\}?$/i, name: 'Estimated Function', type: 'quantity_concept' },
  { pattern: /^h_\{?0\}?$/i, name: 'Loss-Conditioned Function', type: 'quantity_concept' },
  { pattern: /^h_\{?1\}?$/i, name: 'Fixation-Conditioned Function', type: 'quantity_concept' },
  { pattern: /^\\pi_\{?t\}?$/i, name: 'Time-Dependent Distribution', type: 'quantity_concept' },
  { pattern: /^\\pi\^\{\*\}$/i, name: 'Stationary Distribution', type: 'quantity_concept' },
  { pattern: /^\\nu_\{?n\}?$/i, name: 'Posterior Degrees of Freedom', type: 'quantity_concept' },
  { pattern: /^C\^\{-1\}$/i, name: 'Inverse Normalizing Constant', type: 'quantity_concept' },
];

const GREEK_NAMES = new Map([
  ['alpha', 'Alpha'],
  ['beta', 'Beta'],
  ['gamma', 'Gamma'],
  ['delta', 'Delta'],
  ['epsilon', 'Epsilon'],
  ['varepsilon', 'Epsilon'],
  ['theta', 'Theta'],
  ['lambda', 'Lambda'],
  ['mu', 'Mean'],
  ['sigma', 'Standard Deviation'],
  ['rho', 'Correlation'],
  ['phi', 'Phi'],
  ['omega', 'Omega'],
  ['Delta', 'Change'],
]);

const OPERATOR_SYMBOLS = new Set([
  '\\sum',
  '\\prod',
  '\\int',
  '\\partial',
  '\\Delta',
  'Cov',
  'Var',
  'E',
  'Pr',
  'P',
  'log',
  'ln',
  'exp',
  'o',
]);

const IGNORED_SYMBOLS = new Set([
  '\\boldsymbol',
  '\\widehat{\\boldsymbol}',
  '\\mathbf',
  '\\mathrm',
]);

const STRUCTURED_BLOCK_PRIORITY = new Map([
  ['definition', 6],
  ['derivation', 5],
  ['proposition', 4],
  ['discussion', 3],
]);

const BAD_CONCEPT_PHRASE = /\b(first term|second term|third term|large parentheses|where|which|given that|note that|following set|standard approach|value for and|if gaussian|for gaussian|letting|assuming|subtracting|yielding|generated|is given|computed|calculated)\b/i;
const BAD_CONCEPT_NAME = /^(first|second|third|last|following|if|for|when|while|satisfies|most robust approach|additional technical restriction|within-generation change is not influenced)\b/i;
const SENTENCE_START_REPAIRS = [
  [/^qual to\b/i, 'The probability of moving from i to j'],
  [/^he parental\b/i, 'The parental'],
  [/^ose that\b/i, 'Suppose that'],
  [/^rait value\b/i, 'Trait value'],
  [/^nt applies\b/i, 'The argument applies'],
  [/^der neutrality\b/i, 'Under neutrality'],
];

const CONCEPT_DEFINITIONS = new Map([
  ['wright-fisher transition probability', 'Probability that a Wright-Fisher population moves from allele count i to allele count j in one generation.'],
  ['transition probability', 'Probability of moving from one state to another in a stochastic model.'],
  ['probability', 'A quantity measuring how likely an event or state transition is.'],
  ['population size', 'The number of individuals or gene copies represented by the population model.'],
  ['count', 'A discrete number of items, individuals, or events.'],
  ['variable', 'A placeholder quantity whose value can vary in the local formula context.'],
  ['time', 'A quantity indexing the stage, generation, or interval of the process.'],
  ['mean', 'The average value of a quantity in the relevant distribution or population.'],
  ['delta', 'A local change or increment in the modeled quantity.'],
  ['index', 'A position marker used to identify a class, state, or summation term.'],
  ['frequency', 'The relative share of a class or type in the population.'],
  ['class frequency', 'The frequency assigned to one class or type in a population sum.'],
  ['trait value', 'The numerical value of the phenotype or quantitative trait being modeled.'],
  ['mean trait value', 'The population average of the trait value across all classes or individuals.'],
  ['class trait value', 'The trait value associated with one class or type.'],
  ['fitness', 'A measure of reproductive success or contribution to the next generation.'],
  ['absolute fitness', 'Fitness measured on an absolute scale before normalization.'],
  ['mean fitness', 'The population average of fitness values.'],
  ['fitness width', 'A scale parameter controlling how quickly fitness declines away from the optimum.'],
  ['optimal trait value', 'The trait value at which the fitness function reaches its optimum.'],
  ['strength of stabilizing selection', 'A parameter describing how strongly selection pulls trait values toward an optimum.'],
  ['selection differential', 'The change in mean trait value caused by selection before transmission.'],
  ['response', 'The change in mean trait value observed after inheritance or transmission.'],
  ['variance', 'A measure of spread around the mean.'],
  ['covariance', 'A measure of how two quantities vary together.'],
  ['expectation', 'The average value predicted by a probability distribution.'],
  ['likelihood', 'A measure of how well a model explains observed data.'],
  ['coefficient', 'A scalar multiplier that controls the size of a term in the formula.'],
  ['alpha', 'A model parameter or distribution-shape parameter named alpha in the local context.'],
  ['beta', 'A model parameter, regression coefficient, or distribution-shape parameter named beta in the local context.'],
  ['standard deviation', 'A square-root scale measure of spread around the mean.'],
  ['eigenvalue', 'A scalar value associated with a matrix transformation or correlation structure.'],
  ['identity matrix', 'A matrix with ones on the diagonal and zeros elsewhere.'],
  ['parameter vector', 'A collection of model parameters treated as one vector.'],
  ['vector or matrix quantity', 'A structured mathematical quantity represented as a vector or matrix.'],
  ['order term', 'A remainder term describing the asymptotic size of an expression.'],
  ['distance', 'A measure of separation between states, values, or functions.'],
  ['function', 'A rule that maps inputs to outputs in the model.'],
  ['rate', 'A parameter describing how quickly a process occurs.'],
  ['selection coefficient', 'A parameter measuring the strength of selection.'],
  ['mutation rate', 'A parameter measuring the probability of mutation per generation.'],
  ['variance function', 'A function describing local variance in a diffusion or stochastic process.'],
  ['information', 'A quantity measuring how much data or a likelihood constrains a parameter.'],
  ['bayes factor', 'A ratio comparing how strongly data support one hypothesis over another.'],
  ['fixation integral', 'An integral used to compute fixation-related quantities.'],
  ['probability density', 'A function whose integral gives probability over a continuous range.'],
  ['stationary distribution', 'A distribution that remains unchanged under the transition dynamics.'],
  ['replacement-site divergence', 'The amount of divergence at replacement, amino-acid-changing sites between species.'],
  ['silent-site divergence', 'The amount of divergence at silent sites, used as a neutral reference in MK-style tests.'],
  ['replacement-site polymorphism', 'The amount of within-species polymorphism at replacement, amino-acid-changing sites.'],
  ['silent-site polymorphism', 'The amount of within-species polymorphism at silent sites, used as the neutral polymorphism reference.'],
  ['replacement-site divergence per gene', 'The replacement-site divergence measured for the indexed gene in a multi-gene MK-style estimator.'],
  ['silent-site divergence per gene', 'The silent-site divergence measured for the indexed gene and used as the neutral divergence reference.'],
  ['replacement-site polymorphism per gene', 'The replacement-site polymorphism measured for the indexed gene in a multi-gene MK-style estimator.'],
  ['silent-site polymorphism per gene', 'The silent-site polymorphism measured for the indexed gene and used as the neutral polymorphism reference.'],
  ['replacement-site segregating sites', 'The count of segregating replacement sites in the sample.'],
  ['silent-site segregating sites', 'The count of segregating silent sites in the sample.'],
  ['replacement-site mutation rate', 'The mutation rate assigned to replacement, amino-acid-changing sites.'],
  ['silent-site mutation rate', 'The mutation rate assigned to silent sites.'],
  ['replacement-site theta', 'The neutral diversity parameter for replacement sites.'],
  ['silent-site theta', 'The neutral diversity parameter for silent sites.'],
  ['replacement-site count', 'The number of replacement, amino-acid-changing sites.'],
  ['silent-site count', 'The number of silent sites.'],
  ['neutral replacement substitutions', 'The expected number of replacement substitutions under the neutral baseline.'],
  ['adaptive replacement substitutions', 'The number of replacement substitutions attributed to adaptive evolution.'],
  ['estimated adaptive replacement substitutions', 'An estimator for the number of adaptive replacement substitutions.'],
  ['estimated fraction of adaptive replacement substitutions', 'An estimator for the fraction of replacement substitutions that are adaptive.'],
  ['neutrality index', 'The MK-test odds ratio comparing replacement and silent polymorphism-divergence ratios.'],
  ['tarone-greenland neutrality index', 'A weighted neutrality index combining per-gene MK odds ratios across multiple genes.'],
  ['direction of selection statistic', 'A statistic comparing the fraction of replacement divergence with the fraction of replacement polymorphism.'],
  ['estimated fraction of adaptive substitutions', 'An estimator for the fraction of substitutions attributed to adaptive evolution.'],
  ['gamma function', 'A continuous extension of the factorial function.'],
  ['degrees of freedom', 'A parameter controlling the shape of a t or chi-square related distribution.'],
  ['posterior degrees of freedom', 'The degrees-of-freedom parameter after conditioning on observed data.'],
  ['parameter', 'An unknown or fixed quantity that controls a model.'],
  ['parameter vector', 'A collection of model parameters treated as one vector.'],
  ['estimator', 'A statistic used to estimate an unknown parameter.'],
  ['estimator vector', 'A vector-valued statistic used to estimate several parameters.'],
  ['data vector', 'The observed data represented as a vector.'],
  ['covariance matrix', 'A matrix describing variances and covariances among variables.'],
  ['wishart matrix', 'A random positive-definite matrix used in Wishart or inverse-Wishart models.'],
  ['acceptance rate', 'The probability or frequency of accepting a proposed move in a sampling algorithm.'],
  ['monte carlo estimate', 'An estimate computed from random samples.'],
  ['estimated function', 'A function estimated from data or simulation output.'],
  ['loss-conditioned function', 'A function conditioned on paths leading to loss.'],
  ['fixation-conditioned function', 'A function conditioned on paths leading to fixation.'],
  ['time-dependent distribution', 'A probability distribution indexed by time.'],
  ['inverse normalizing constant', 'The reciprocal of a constant that makes a probability distribution integrate to one.'],
  ['additive genetic value', 'The additive genetic contribution to an individual or trait value.'],
  ['total additive genetic value', 'The additive genetic value aggregated over a group or total phenotype.'],
  ['inclusive-fitness breeding value', 'A breeding value measured through inclusive-fitness effects.'],
  ['fitness breeding value', 'The additive genetic component associated with fitness.'],
  ['trait breeding value', 'The additive genetic component associated with the trait.'],
  ['mean trait breeding value', 'The population mean of the trait breeding value.'],
  ['estimated relationship matrix', 'An estimated matrix of genetic relationships between individuals.'],
  ['additive genetic component', 'A component representing additive genetic contribution in the model.'],
  ['power of additive matrix', 'A repeated product or power of an additive-genetic matrix.'],
  ['among-block variance', 'The variance among environmental or experimental blocks in stratified selection.'],
  ['genetic variance', 'The genetic component of phenotypic variance in the local quantitative-genetic model.'],
  ['within-block environmental variance', 'The residual environmental variance within blocks after stratification.'],
  ['class selection coefficient', 'A selection coefficient assigned to one class or genotype.'],
]);

const CONCEPT_DEFINITIONS_ZH = new Map([
  ['wright-fisher transition probability', 'Wright-Fisher 模型中，群体从一个等位基因计数状态转移到另一个状态的概率。'],
  ['transition probability', '随机过程从一个状态进入另一个状态的概率。'],
  ['probability', '衡量某个事件或状态转移发生可能性的数量。'],
  ['population size', '模型中表示的个体数或基因拷贝数。'],
  ['count', '对个体、事件或类别数量的离散计数。'],
  ['variable', '公式中取值可以变化的占位量。'],
  ['time', '表示过程所处阶段、世代或时间间隔的量。'],
  ['mean', '相关分布或群体中某个量的平均值。'],
  ['delta', '模型中某个量的局部变化或增量。'],
  ['index', '用于标记类别、状态或求和项位置的下标。'],
  ['frequency', '某个类别或类型在群体中的相对占比。'],
  ['class frequency', '群体求和中某一类别或类型对应的频率。'],
  ['trait value', '表型或数量性状在模型中的数值。'],
  ['mean trait value', '群体中性状值的平均水平。'],
  ['class trait value', '某一类别或类型对应的性状值。'],
  ['fitness', '衡量个体繁殖成功或对下一代贡献的量。'],
  ['absolute fitness', '归一化之前、按绝对尺度衡量的适合度。'],
  ['mean fitness', '群体中适合度值的平均水平。'],
  ['fitness width', '控制性状偏离最优值时适合度下降速度的尺度参数。'],
  ['optimal trait value', '使适合度函数达到最大值的性状取值。'],
  ['strength of stabilizing selection', '描述稳定化选择把性状拉向最优值强度的参数。'],
  ['selection differential', '选择作用在遗传传递之前造成的平均性状值变化。'],
  ['response', '遗传或传递之后观察到的平均性状值变化。'],
  ['variance', '衡量一个量围绕平均值分散程度的指标。'],
  ['covariance', '衡量两个量共同变化方向和强度的指标。'],
  ['expectation', '由概率分布预测出的平均值。'],
  ['likelihood', '衡量模型解释观测数据程度的量。'],
  ['coefficient', '控制公式中某一项大小的乘数。'],
  ['alpha', '局部模型中记为 alpha 的参数或分布形状参数。'],
  ['beta', '局部模型中记为 beta 的参数、回归系数或分布形状参数。'],
  ['standard deviation', '方差的平方根，用来表示分散程度的尺度。'],
  ['eigenvalue', '矩阵变换或相关结构中的特征值。'],
  ['identity matrix', '对角线为 1、其他位置为 0 的矩阵。'],
  ['parameter', '控制模型行为的未知量或固定量。'],
  ['parameter vector', '把多个模型参数作为一个向量整体表示。'],
  ['estimator', '用于估计未知参数的统计量。'],
  ['estimator vector', '用于同时估计多个参数的向量统计量。'],
  ['data vector', '以向量形式表示的观测数据。'],
  ['vector or matrix quantity', '以向量或矩阵形式表示的结构化数学量。'],
  ['covariance matrix', '描述多个变量方差和协方差的矩阵。'],
  ['wishart matrix', 'Wishart 或逆 Wishart 模型中使用的正定随机矩阵。'],
  ['order term', '描述表达式渐近规模的余项。'],
  ['distance', '衡量状态、数值或函数之间分离程度的量。'],
  ['function', '把输入映射为输出的规则。'],
  ['rate', '描述某个过程发生快慢的参数。'],
  ['selection coefficient', '衡量选择强度的参数。'],
  ['mutation rate', '衡量每一代发生突变概率的参数。'],
  ['variance function', '描述扩散或随机过程中局部方差的函数。'],
  ['information', '衡量数据或似然函数对参数约束程度的量。'],
  ['bayes factor', '比较数据支持两个假设强弱的比值。'],
  ['fixation integral', '用于计算固定相关数量的积分。'],
  ['probability density', '连续变量中积分后得到概率的函数。'],
  ['stationary distribution', '在转移动力学下保持不变的概率分布。'],
  ['replacement-site divergence', '替换位点（会改变氨基酸的位点）在物种之间积累的分化量。'],
  ['silent-site divergence', '沉默位点在物种之间积累的分化量，常作为 MK 检验中的中性参照。'],
  ['replacement-site polymorphism', '物种内替换位点（会改变氨基酸的位点）的多态性数量。'],
  ['silent-site polymorphism', '物种内沉默位点的多态性数量，常作为中性多态性参照。'],
  ['replacement-site divergence per gene', '多基因 MK 类估计中，第 i 个基因的替换位点分化量。'],
  ['silent-site divergence per gene', '多基因 MK 类估计中，第 i 个基因的沉默位点分化量，作为中性分化参照。'],
  ['replacement-site polymorphism per gene', '多基因 MK 类估计中，第 i 个基因的替换位点多态性。'],
  ['silent-site polymorphism per gene', '多基因 MK 类估计中，第 i 个基因的沉默位点多态性，作为中性多态性参照。'],
  ['replacement-site segregating sites', '样本中替换位点的分离位点数量。'],
  ['silent-site segregating sites', '样本中沉默位点的分离位点数量。'],
  ['replacement-site mutation rate', '替换位点对应的突变率。'],
  ['silent-site mutation rate', '沉默位点对应的突变率。'],
  ['replacement-site theta', '替换位点对应的中性多样性参数 θ。'],
  ['silent-site theta', '沉默位点对应的中性多样性参数 θ。'],
  ['replacement-site count', '替换位点（会改变氨基酸的位点）的数量。'],
  ['silent-site count', '沉默位点的数量。'],
  ['neutral replacement substitutions', '中性基线下预期出现的替换位点替换数。'],
  ['adaptive replacement substitutions', '归因于适应性演化的替换位点替换数。'],
  ['estimated adaptive replacement substitutions', '对适应性替换位点替换数量的估计。'],
  ['estimated fraction of adaptive replacement substitutions', '对替换位点替换中适应性部分比例的估计。'],
  ['neutrality index', 'MK 检验中的赔率比，用来比较替换位点和沉默位点的多态性/分化比例。'],
  ['tarone-greenland neutrality index', 'Tarone-Greenland 加权中性指数，用来把多个基因的 MK 赔率比合并起来。'],
  ['direction of selection statistic', '方向选择统计量，用替换位点分化比例减去替换位点多态性比例来判断选择方向。'],
  ['estimated fraction of adaptive substitutions', '对替换中由适应性演化造成的比例进行估计的统计量。'],
  ['gamma function', '阶乘函数在连续情形下的推广。'],
  ['degrees of freedom', '控制 t 分布或卡方相关分布形状的参数。'],
  ['posterior degrees of freedom', '在观测数据条件化之后得到的自由度参数。'],
  ['acceptance rate', '采样算法中接受候选移动的概率或频率。'],
  ['monte carlo estimate', '由随机样本计算得到的估计值。'],
  ['estimated function', '由数据或模拟结果估计出的函数。'],
  ['loss-conditioned function', '在路径最终丢失这一条件下定义的函数。'],
  ['fixation-conditioned function', '在路径最终固定这一条件下定义的函数。'],
  ['time-dependent distribution', '随时间变化的概率分布。'],
  ['inverse normalizing constant', '使概率分布积分为 1 的归一化常数的倒数。'],
  ['additive genetic value', '个体或性状值中的加性遗传贡献。'],
  ['total additive genetic value', '在群体或总表型中汇总的加性遗传值。'],
  ['inclusive-fitness breeding value', '通过包容适合度效应衡量的育种值。'],
  ['fitness breeding value', '与适合度相关的加性遗传组成部分。'],
  ['trait breeding value', '与性状相关的加性遗传组成部分。'],
  ['mean trait breeding value', '群体中性状育种值的平均水平。'],
  ['estimated relationship matrix', '估计得到的个体遗传关系矩阵。'],
  ['additive genetic component', '表示加性遗传贡献的模型组成部分。'],
  ['power of additive matrix', '加性遗传矩阵的幂或重复乘积。'],
  ['among-block variance', '分层选择中不同区组之间的环境或处理差异方差。'],
  ['genetic variance', '当前数量遗传模型中的遗传方差组成部分。'],
  ['within-block environmental variance', '分层后区组内部剩余的环境方差。'],
  ['class selection coefficient', '分配给某一类别或基因型的选择系数。'],
]);

function conceptDefinitionZh(name, role, conceptType) {
  const key = normalizeSpaces(name).toLowerCase();
  const stable = CONCEPT_DEFINITIONS_ZH.get(key);
  if (stable) return stable;
  if (conceptType === 'operator_or_function') return `${name} 是当前公式中使用的函数或算子，用来把输入量转换为模型需要的输出。`;
  if (conceptType === 'math_concept') return `${name} 是当前公式中使用的数学概念，用来组织或计算相关数量。`;
  if (conceptType === 'domain_concept') return `${name} 是当前公式涉及的背景概念，用来帮助解释模型中的生物学含义。`;
  if (role === 'defined') return `${name} 是由当前支撑公式引入的局部数学量。`;
  return `${name} 是当前公式中使用的背景量，用来帮助理解公式中的符号关系。`;
}

function slug(value) {
  const text = String(value || '')
    .replace(/\\/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return text || 'item';
}

function normalizeSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function repairSentenceStart(value) {
  let text = normalizeSpaces(value);
  for (const [pattern, replacement] of SENTENCE_START_REPAIRS) {
    text = text.replace(pattern, replacement);
  }
  if (text && /^[a-z]/.test(text)) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }
  return text;
}

function cleanDefinition(value, fallback) {
  const text = repairSentenceStart(value)
    .replace(/,\s*,+/g, ',')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+\)/g, ')')
    .replace(/\(\s+/g, '(')
    .replace(/\(\s*\)/g, '')
    .trim();
  const definition = text || fallback;
  return definition.length > 230 ? `${definition.slice(0, 227).replace(/\s+\S*$/, '')}...` : definition;
}

function compactText(value = '', maxLength = 210) {
  const text = normalizeSpaces(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).replace(/\s+\S*$/, '')}...`;
}

function conceptTeachingMoveFromContext(context = '') {
  const normalized = normalizeSpaces(context);
  if (!normalized) return null;
  const sentences = normalized
    .replace(/\$\$[\s\S]*?\$\$/g, ' [formula] ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizeSpaces(sentence))
    .filter(Boolean);
  const patterns = [
    { move: 'recalls prior equations to propose an estimator', zh: '回忆前式后提出估计量', test: /\brecalling\b.*\b(suggests?|estimator|approach)\b/i },
    { move: 'introduces an estimator', zh: '作为估计量引入', test: /\bestimat(?:or|e|ed|ing)\b/i },
    { move: 'defines a quantity explicitly', zh: '直接定义一个量', test: /\bdefined\s+as\b/i },
    { move: 'names a quantity used in the literature', zh: '给出文献中的名称', test: /\b(?:called|denoted\s+by)\b/i },
    { move: 'sets notation before the formula', zh: '先设定符号再写公式', test: /\b(?:let|letting)\b/i },
    { move: 'explains symbols with a where clause', zh: '用 where 解释符号', test: /\bwhere\b/i },
  ];
  for (const pattern of patterns) {
    const hit = sentences.find((sentence) => pattern.test.test(sentence));
    if (hit) {
      return {
        teaching_move: pattern.move,
        teaching_move_zh: pattern.zh,
        source_sentence: compactText(hit),
      };
    }
  }
  return {
    teaching_move: 'uses nearby prose as formula evidence',
    teaching_move_zh: '由邻近段落支撑',
    source_sentence: compactText(sentences[0] || normalized),
  };
}

function formulaContext(formula, promptRecord) {
  const parts = [promptRecord?.nearby_text, formula.context_text, formula.section, formula.subsection]
    .map((part) => normalizeSpaces(part))
    .filter(Boolean);
  const seen = new Set();
  return parts.filter((part) => {
    const key = part.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(' ');
}

function formulaNumber(formula) {
  return String(formula?.label || formula?.id || '')
    .replace(/^formula[_\s-]*/i, '')
    .replace(/^Formula\s+/i, '')
    .trim();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripLatex(value) {
  return normalizeSpaces(
    String(value || '')
      .replace(/\[\[SEE_FORMULA:[^\]]+\]\]/g, ' ')
      .replace(/\[\[SEE_TABLE:[^\]]+\]\]/g, ' ')
      .replace(/\[\[SEE_EXAMPLE:[^\]]+\]\]/g, ' ')
      .replace(/\$\$[\s\S]*?\$\$/g, ' ')
      .replace(/\$[\s\S]*?\$/g, ' ')
      .replace(/\\\[[\s\S]*?\\\]/g, ' ')
      .replace(/\\\([\s\S]*?\\\)/g, ' ')
      .replace(/\\[a-zA-Z]+\{([^{}]+)\}/g, '$1')
      .replace(/[{}_^]/g, ' ')
      .replace(/\\/g, ' '),
  );
}

function splitSentences(text) {
  const clean = stripLatex(text);
  if (!clean) return [];
  return clean.split(/(?<=[.!?])\s+/).map((sentence) => normalizeSpaces(sentence)).filter(Boolean);
}

function usefulDefinitionSentence(sentence) {
  const clean = normalizeSpaces(sentence);
  if (clean.length < 28) return false;
  if (clean.length > 190) return false;
  if (!/^[A-Z][A-Za-z0-9("' ]/.test(clean)) return false;
  if (/^[a-z]/.test(clean)) return false;
  if (BAD_CONCEPT_PHRASE.test(clean)) return false;
  if (/\bholds for all possible values of\b/i.test(clean)) return false;
  if (/\bappears in the literature\b/i.test(clean)) return false;
  if (/\bWright's \(\d{4}/i.test(clean)) return false;
  if (/[A-Z][A-Z\s,'-]{18,}$/.test(clean)) return false;
  if (/\b[A-Z]{3,}(?:'S)?\b.*\b[A-Z]{3,}(?:'S)?\b/.test(clean)) return false;
  if (/\b(first|second|third)\s+term\b/i.test(clean)) return false;
  if ((clean.match(/\b[A-Za-z]\b/g) || []).length > 12) return false;
  return true;
}

function titleCase(value) {
  const stop = new Set(['a', 'an', 'and', 'as', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
  return normalizeSpaces(value)
    .split(' ')
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && stop.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function baseSymbol(symbol) {
  let value = String(symbol || '').trim();
  value = value.replace(/\\overline\{([^{}]+)\}/g, '$1');
  value = value.replace(/\\bar\{([^{}]+)\}/g, '$1');
  value = value.replace(/\\widehat\{([^{}]+)\}/g, '$1');
  value = value.replace(/\\hat\{([^{}]+)\}/g, '$1');
  value = value.replace(/_\{[^{}]+\}/g, '');
  value = value.replace(/\^\{[^{}]+\}/g, '');
  value = value.replace(/[{}]/g, '');
  value = value.replace(/^\\/, '');
  return value;
}

function readableSymbol(symbol) {
  let value = String(symbol || '').trim();
  value = value.replace(/\\widehat\{\\boldsymbol\{([^{}]+)\}\}/g, '$1 estimator vector');
  value = value.replace(/\\boldsymbol\{([^{}]+)\}/g, '$1 vector');
  value = value.replace(/\\mathbf\{([^{}]+)\}/g, '$1 matrix');
  value = value.replace(/\\overline\{([^{}]+)\}/g, '$1-bar');
  value = value.replace(/\\bar\{([^{}]+)\}/g, '$1-bar');
  value = value.replace(/\\widehat\{([^{}]+)\}/g, '$1-hat');
  value = value.replace(/\\hat\{([^{}]+)\}/g, '$1-hat');
  value = value.replace(/\\Delta/g, 'Change');
  value = value.replace(/\\delta/g, 'delta');
  value = value.replace(/\\epsilon|\\varepsilon/g, 'epsilon');
  value = value.replace(/\\alpha/g, 'alpha');
  value = value.replace(/\\beta/g, 'beta');
  value = value.replace(/\\gamma/g, 'gamma');
  value = value.replace(/\\sigma/g, 'sigma');
  value = value.replace(/\\mu/g, 'mu');
  value = value.replace(/_\{([^{}]+)\}/g, ' sub $1');
  value = value.replace(/\^\{\\prime\}/g, ' prime');
  value = value.replace(/\^\{([^{}]+)\}/g, ' power $1');
  value = value.replace(/[{}]/g, '');
  value = value.replace(/\\/g, '');
  return titleCase(value);
}

function isMkTestContext(context) {
  return /MK test|McDonald|Kreitman|replacement substitutions|substitutions that are adaptive|silent sites|silent-site|neutrality index|NI_\{?[A-Z]+\}?|polymorphism.*divergence|direction of selection|DPRS|adaptive replacement|adaptive evolution/i.test(context || '');
}

function symbolSpecificConcept(symbol, context = '') {
  const compact = String(symbol || '').replace(/\s+/g, '');
  if (/\\widehat\{\\overline\{\\alpha\}\}(?:_\{?[A-Za-z]+\}?)?$/.test(compact) && isMkTestContext(context)) {
    return { name: 'Estimated Fraction of Adaptive Substitutions', type: 'quantity_concept' };
  }
  if (/^\\widehat\{\\alpha\}$/.test(compact) && isMkTestContext(context)) {
    return { name: 'Estimated Fraction of Adaptive Replacement Substitutions', type: 'quantity_concept' };
  }
  for (const rule of SUBSCRIPT_SYMBOL_NAMES) {
    if (rule.pattern.test(compact)) return rule;
  }
  return null;
}

function primaryFormulaSymbol(symbol) {
  const clean = normalizeSpaces(symbol);
  if (!clean) return '';
  if (/\([^)]*(?:\\mid\b|\\midx\b|=)/.test(clean)) {
    return clean.split('(')[0]?.trim() || clean;
  }
  const withoutCondition = clean.split(/\\mid\b/)[0]?.trim();
  const withoutCompactCondition = withoutCondition.split(/\\midx\b/)[0]?.trim();
  return withoutCompactCondition || withoutCondition || clean;
}

function uniqueFormulaSymbols(symbols) {
  const unique = [];
  const seen = new Set();
  for (const symbol of symbols || []) {
    const normalized = primaryFormulaSymbol(symbol);
    if (!normalized || isIgnoredSymbol(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function isIgnoredSymbol(symbol) {
  const compact = String(symbol || '').replace(/\s+/g, '');
  return IGNORED_SYMBOLS.has(compact);
}

function nearbyPromptMap(chapterId) {
  return readFile(resolve(PROMPT_DIR, `${chapterId}.jsonl`), 'utf8')
    .then((text) => {
      const map = new Map();
      text.split(/\r?\n/).forEach((line) => {
        if (!line.trim()) return;
        try {
          const record = JSON.parse(line);
          if (record.formula_id) map.set(record.formula_id, record);
        } catch {
          // Keep generation resilient; malformed prompt rows simply don't enrich concepts.
        }
      });
      return map;
    })
    .catch(() => new Map());
}

function formulaReferencesInBlock(content) {
  const references = new Set();
  const text = String(content || '');
  for (const match of text.matchAll(/\[\[SEE_FORMULA:([^\]]+)\]\]/g)) {
    if (match[1]) references.add(normalizeSpaces(match[1]));
  }
  return [...references];
}

async function structuredBlocksForChapter(chapterId) {
  return readdir(STRUCTURED_DIR)
    .then(async (files) => {
      const chapterFiles = files
        .filter((file) => file.startsWith(`${chapterId}_`) && file.endsWith('.json'))
        .sort();
      const blocks = [];
      for (const file of chapterFiles) {
        try {
          const doc = JSON.parse(await readFile(resolve(STRUCTURED_DIR, file), 'utf8'));
          const metadata = doc.metadata || {};
          (doc.blocks || []).forEach((block, index) => {
            if (!STRUCTURED_BLOCK_PRIORITY.has(block.type)) return;
            const content = normalizeSpaces(block.content);
            if (!content) return;
            const blockFormulaReferences = formulaReferencesInBlock(content);
            blocks.push({
              chunk_id: doc.id || file.replace(/\.json$/i, ''),
              block_index: index,
              block_type: block.type,
              content,
              clean_content: stripLatex(content).toLowerCase(),
              block_formula_references: blockFormulaReferences,
              formula_references: metadata.formula_references || [],
              section: metadata.section_level_1 || metadata.section || '',
              subsection: metadata.section_level_2 || metadata.display_heading || '',
              priority: STRUCTURED_BLOCK_PRIORITY.get(block.type) || 1,
            });
          });
        } catch {
          // Structured extraction can be partial; skip malformed chunks without blocking the whole book.
        }
      }
      return blocks;
    })
    .catch(() => []);
}

function blockMatchesFormula(block, formula) {
  const number = formulaNumber(formula);
  if (!number) return false;
  if (block.block_formula_references?.length) return block.block_formula_references.includes(number);
  if ((block.formula_references || []).length === 1) return block.formula_references.includes(number);
  return block.block_type === 'definition' && (block.formula_references || []).includes(number);
}

function symbolSearchTerms(symbol, conceptName) {
  const terms = new Set();
  [symbol, baseSymbol(symbol), readableSymbol(symbol), conceptName].forEach((value) => {
    const clean = stripLatex(value).toLowerCase();
    if (clean && clean.length > 1) terms.add(clean);
  });
  return [...terms];
}

function textContainsTerm(text, term) {
  if (!term) return false;
  const escaped = escapeRegExp(term);
  if (/^[a-z0-9]+$/i.test(term)) {
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  }
  return text.includes(term);
}

function bestStructuredEvidence(formula, symbol, conceptName, structuredBlocks) {
  const formulaBlocks = structuredBlocks.filter((block) => blockMatchesFormula(block, formula));
  if (!formulaBlocks.length) return null;
  const terms = symbolSearchTerms(symbol, conceptName);
  let best = null;
  for (const block of formulaBlocks) {
    const sentences = splitSentences(block.content);
    const fallbackSentence = sentences.find(usefulDefinitionSentence) || sentences[0] || '';
    const hit = sentences.find((sentence) => {
      const clean = stripLatex(sentence).toLowerCase();
      return terms.some((term) => textContainsTerm(clean, term));
    });
    if (!hit && block.block_type !== 'definition') continue;
    const sentence = hit || fallbackSentence;
    if (!sentence || !usefulDefinitionSentence(sentence)) continue;
    const score = block.priority
      + (hit ? 2 : 0)
      + (block.formula_references?.includes(formulaNumber(formula)) ? 1.5 : 0)
      + (block.block_type === 'definition' ? 1 : 0);
    if (!best || score > best.score) {
      best = {
        score,
        sentence,
        evidence: {
          chunk_id: block.chunk_id,
          block_index: block.block_index,
          block_type: block.block_type,
        },
      };
    }
  }
  return best;
}

function sentenceWindow(text, symbol) {
  const clean = stripLatex(text);
  if (!clean) return '';
  const base = baseSymbol(symbol);
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  const hit = sentences.find((sentence) => sentence.includes(base) || sentence.toLowerCase().includes(readableSymbol(symbol).toLowerCase()));
  return cleanDefinition(hit || sentences.find((sentence) => usefulDefinitionSentence(sentence)) || sentences[0] || clean, '').slice(0, 260);
}

function phraseBeforeFormula(text, symbol) {
  const clean = stripLatex(text);
  const base = escapeRegExp(baseSymbol(symbol));
  const patterns = [
    new RegExp(`(?:the|called|denote|denotes|defined as|is the|is called)\\s+([A-Za-z][A-Za-z\\s,'-]{3,64})\\s+(?:${base}|is|as|by|equals)`, 'i'),
    new RegExp(`([A-Za-z][A-Za-z\\s,'-]{3,64})\\s+(?:is|are)\\s+(?:defined|given|computed|calculated)`, 'i'),
    new RegExp(`([A-Za-z][A-Za-z\\s,'-]{3,64})\\s+is\\s+\\$?`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match?.[1]) {
      const phrase = normalizeSpaces(match[1].replace(/\b(the|this|that|where|and|or)$/i, ''));
      if (
        phrase.split(' ').length <= 5
        && !BAD_CONCEPT_PHRASE.test(phrase)
        && !BAD_CONCEPT_NAME.test(phrase)
        && !/^(a|an|the|if|for|when|while|thus|similarly|likewise|hence)\b/i.test(phrase)
      ) return titleCase(phrase);
    }
  }
  return '';
}

function inferConceptName(symbol, formula, promptRecord, role) {
  const context = formulaContext(formula, promptRecord);
  const specific = symbolSpecificConcept(symbol, context);
  if (specific) return specific.name;

  const base = baseSymbol(symbol);
  if (COMMON_SYMBOL_NAMES.has(symbol)) return COMMON_SYMBOL_NAMES.get(symbol);
  if (COMMON_SYMBOL_NAMES.has(base)) {
    const name = COMMON_SYMBOL_NAMES.get(base);
    if (/\\overline|\\bar/.test(symbol)) return `Mean ${name}`;
    if (/\\Delta/.test(symbol)) return `Change in ${name}`;
    if (/prime/.test(symbol) || /\\prime/.test(symbol)) return `Updated ${name}`;
    return name;
  }
  if (GREEK_NAMES.has(base)) return GREEK_NAMES.get(base);
  if (OPERATOR_SYMBOLS.has(symbol) || OPERATOR_SYMBOLS.has(base)) return COMMON_SYMBOL_NAMES.get(base) || readableSymbol(symbol);
  const phrase = role === 'defined' ? phraseBeforeFormula(context, symbol) : '';
  if (phrase && !/^Let$/i.test(phrase) && !BAD_CONCEPT_NAME.test(phrase)) return phrase;
  return readableSymbol(symbol);
}

function conceptTypeFor(symbol, role, context = '') {
  const specific = symbolSpecificConcept(symbol, context);
  if (specific?.type) return specific.type;
  const base = baseSymbol(symbol);
  if (OPERATOR_SYMBOLS.has(symbol) || OPERATOR_SYMBOLS.has(base)) return 'operator_or_function';
  if (['Cov', 'Var', 'E', 'Pr'].includes(base)) return 'math_concept';
  if (role === 'defined') return 'quantity_concept';
  if (['w', 'W', 'z', 'p', 'q'].includes(base)) return 'quantity_concept';
  return 'domain_concept';
}

function confidenceFor(symbol, formula, promptRecord, role, structuredEvidence) {
  let score = role === 'defined' ? 0.82 : 0.68;
  const context = formulaContext(formula, promptRecord);
  if (symbolSpecificConcept(symbol, context)) score += 0.08;
  if (usefulDefinitionSentence(sentenceWindow(context, symbol))) score += 0.08;
  if (structuredEvidence) score += 0.04;
  if (COMMON_SYMBOL_NAMES.has(symbol) || COMMON_SYMBOL_NAMES.has(baseSymbol(symbol))) score += 0.05;
  if (role === 'defined' && formula.symbols_defined?.includes(symbol)) score += 0.05;
  return Math.min(0.95, Number(score.toFixed(2)));
}

function conceptId(chapterId, formulaId, symbol, role) {
  return `concept_${chapterId}_${slug(formulaId)}_${role}_${slug(symbol)}`;
}

function withUniqueConceptId(concept, idCounts, takenIds) {
  const baseId = concept.concept_id;
  let nextCount = idCounts.get(baseId) || 0;
  let candidate = baseId;
  do {
    nextCount += 1;
    candidate = nextCount === 1 ? baseId : `${baseId}_${nextCount}`;
  } while (takenIds.has(candidate));
  idCounts.set(baseId, nextCount);
  takenIds.add(candidate);
  if (candidate === baseId) return concept;
  return {
    ...concept,
    concept_id: candidate,
  };
}

function evidenceFor(formula, promptRecord, structuredEvidence) {
  const teachingMove = conceptTeachingMoveFromContext(formulaContext(formula, promptRecord));
  const fallback = {
    chunk_id: promptRecord?.formula_id || formula.id,
    block_index: formula.position ?? 0,
    block_type: formula.context_text ? 'derivation' : 'formula',
    sentence: teachingMove?.source_sentence,
    teaching_move: teachingMove?.teaching_move,
    teaching_move_zh: teachingMove?.teaching_move_zh,
  };
  if (!structuredEvidence?.evidence) return [fallback];
  const key = `${structuredEvidence.evidence.chunk_id}:${structuredEvidence.evidence.block_index}:${structuredEvidence.evidence.block_type}`;
  const fallbackKey = `${fallback.chunk_id}:${fallback.block_index}:${fallback.block_type}`;
  const structured = {
    ...structuredEvidence.evidence,
    sentence: structuredEvidence.sentence,
    teaching_move: teachingMove?.teaching_move,
    teaching_move_zh: teachingMove?.teaching_move_zh,
  };
  return key === fallbackKey ? [fallback] : [structured, fallback];
}

function makeSymbolConcept(chapterId, formula, symbol, role, promptRecord, structuredBlocks) {
  const context = formulaContext(formula, promptRecord);
  const name = inferConceptName(symbol, formula, promptRecord, role);
  const structuredEvidence = bestStructuredEvidence(formula, symbol, name, structuredBlocks);
  const definitionSource = structuredEvidence?.sentence || sentenceWindow(context, symbol);
  const stableDefinition = CONCEPT_DEFINITIONS.get(name.toLowerCase());
  const fallback = stableDefinition || (role === 'defined'
    ? `${name} is a local mathematical quantity introduced by the supporting formula.`
    : `${name} is a background quantity used in the local formula context.`);
  const definition = cleanDefinition(stableDefinition ? '' : usefulDefinitionSentence(definitionSource) ? definitionSource : '', fallback);
  const conceptType = conceptTypeFor(symbol, role, context);
  const confidence = confidenceFor(symbol, formula, promptRecord, role, structuredEvidence);
  const teachingMove = conceptTeachingMoveFromContext(context);
  return {
    chapter_id: chapterId,
    formula_id: formula.id,
    formula_label: formula.label,
    symbol,
    role,
    concept_id: conceptId(chapterId, formula.id, symbol, role),
    concept_name: name,
    concept_type: conceptType,
    definition,
    definition_zh: conceptDefinitionZh(name, role, conceptType),
    teaching_move: teachingMove?.teaching_move,
    teaching_move_zh: teachingMove?.teaching_move_zh,
    source_sentence: teachingMove?.source_sentence,
    aliases: Array.from(new Set([symbol, readableSymbol(symbol), name])).filter(Boolean),
    evidence: evidenceFor(formula, promptRecord, structuredEvidence),
    confidence,
    review_status: 'unreviewed',
    review_flags: confidence < 0.72 ? ['needs_review'] : [],
    extraction_model: 'deterministic_formula_structured_context_v2',
  };
}

function conceptDedupKey(concept) {
  const name = normalizeSpaces(concept.name || concept.concept_name || '').toLowerCase();
  const symbol = baseSymbol(concept.symbol || concept.via_symbol || '').toLowerCase();
  return `${name}:${symbol}`;
}

function mergeConceptReference(existing, incoming) {
  return {
    ...existing,
    definition: existing.definition || incoming.definition,
    definition_zh: existing.definition_zh || incoming.definition_zh,
    teaching_move: existing.teaching_move || incoming.teaching_move,
    teaching_move_zh: existing.teaching_move_zh || incoming.teaching_move_zh,
    source_sentence: existing.source_sentence || incoming.source_sentence,
    confidence: Math.max(existing.confidence || 0, incoming.confidence || 0),
    review_flags: Array.from(new Set([...(existing.review_flags || []), ...(incoming.review_flags || [])])),
  };
}

function dedupeConceptReferences(references) {
  const byKey = new Map();
  for (const reference of references) {
    const key = conceptDedupKey(reference);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeConceptReference(existing, reference) : reference);
  }
  return [...byKey.values()];
}

function acceptedFormulaPrerequisites(dependency) {
  return (dependency?.prerequisites || []).filter(
    (item) => item.type === 'formula'
      && item.target_id
      && !item.cross_chapter
      && (item.edge_status || 'accepted') === 'accepted',
  ).filter(
    (item) => item.relation !== 'compound_group',
  );
}

function lhsFunctionArguments(latex) {
  const lhs = String(latex || '').split('=')[0] || '';
  const match = lhs.match(/^\s*[\\A-Za-z][\\A-Za-z0-9_{}^]*\s*\(([^)]*)\)/);
  if (!match) return new Set();
  return new Set(match[1].split(',').map((item) => normalizeSpaces(item)).filter(Boolean));
}

function lhsNamedStatistic(latex) {
  const lhs = String(latex || '')
    .replace(/\\begin\{[^{}]+\}/g, '')
    .replace(/\\end\{[^{}]+\}/g, '')
    .split('=')[0] || '';
  const match = lhs.match(/^\s*([A-Za-z][A-Za-z0-9]{1,8})\s*$/);
  return match?.[1] || '';
}

function lhsPrimarySymbol(latex) {
  const lhs = String(latex || '')
    .replace(/\\begin\{[^{}]+\}/g, '')
    .replace(/\\end\{[^{}]+\}/g, '')
    .split('=')[0] || '';
  const normalized = normalizeSpaces(lhs);
  if (!normalized || /[+\-*/(),]/.test(stripLatex(normalized))) return '';
  if (!/^[\\A-Za-z]/.test(normalized)) return '';
  if (/(?:\\sum|\\prod|\\int|\\frac|\\sqrt|\\left|\\right)/.test(normalized)) return '';
  return normalized;
}

function symbolKey(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/_\{([^{}])\}/g, '_$1')
    .replace(/\^\{([^{}])\}/g, '^$1');
}

function isSplitFromWholeSymbol(symbol, whole) {
  const symbolValue = symbolKey(symbol);
  const wholeValue = symbolKey(whole);
  return Boolean(/^[A-Z]$/.test(symbolValue) && wholeValue && wholeValue.includes(symbolValue));
}

function isRedundantWithDefinedSymbol(symbol, definedSymbols) {
  const key = symbolKey(symbol);
  if (!key) return false;
  return definedSymbols.some((defined) => {
    const definedKey = symbolKey(defined);
    if (!definedKey || definedKey === key) return false;
    if (/^[A-Z]$/.test(key) && definedKey.includes(key)) return true;
    if (/^\\(?:overline|bar)\{?\\alpha\}?$/.test(key) && /\\widehat.*\\alpha/.test(definedKey)) return true;
    if (/^\\widehat\{?\\overline\{?\\alpha\}?\}?$/.test(key) && /\\widehat.*\\alpha/.test(definedKey)) return true;
    return false;
  });
}

function formulaSymbols(formula) {
  const functionArguments = lhsFunctionArguments(formula.latex);
  const argumentSymbols = uniqueFormulaSymbols([...functionArguments]);
  const argumentSet = new Set(argumentSymbols);
  const lhsPrimary = lhsPrimarySymbol(formula.latex);
  let defined = uniqueFormulaSymbols(formula.symbols_defined || [])
    .filter((symbol) => !argumentSet.has(symbol))
    .filter((symbol) => !lhsPrimary || !isSplitFromWholeSymbol(symbol, lhsPrimary));
  if (lhsPrimary && (lhsPrimary.includes('_') || /\\(?:widehat|hat|overline|bar)/.test(lhsPrimary))) {
    defined = [lhsPrimary];
  }
  const lhsSymbol = lhsNamedStatistic(formula.latex);
  if (!lhsPrimary && lhsSymbol && COMMON_SYMBOL_NAMES.has(lhsSymbol)) {
    defined = [lhsSymbol];
  }
  const definedSet = new Set(defined);
  const definedLetters = lhsSymbol ? new Set(lhsSymbol.split('')) : null;
  let used = uniqueFormulaSymbols([...(formula.symbols_used || []), ...argumentSymbols]).filter((symbol) => {
    if (definedSet.has(symbol)) return false;
    if (lhsPrimary && isSplitFromWholeSymbol(symbol, lhsPrimary)) return false;
    if (isRedundantWithDefinedSymbol(symbol, defined)) return false;
    if (lhsSymbol && definedLetters?.has(symbol)) return false;
    return true;
  });
  if (/NI_\{?TG\}?/.test(String(formula.latex || ''))) {
    used = used.filter((symbol) => symbol !== 'N' && symbol !== 'I' && !/^I_\{?[A-Za-z]+\}?$/.test(symbol) && symbol !== 'G' && symbol !== 'T');
    if (!definedSet.has('NI_{TG}')) used.push('NI_{TG}');
  } else if (/\bN\s*I\b/.test(String(formula.latex || '')) && COMMON_SYMBOL_NAMES.has('NI')) {
    used = used.filter((symbol) => symbol !== 'N' && symbol !== 'I');
    if (!definedSet.has('NI')) used.push('NI');
  }
  return { defined, used };
}

function buildChapterConceptGraph(chapterDoc, promptMap, structuredBlocks) {
  const chapterId = chapterDoc.chapter_id;
  const formulaById = new Map((chapterDoc.formulas || []).map((formula) => [formula.id, formula]));
  const dependencyById = new Map((chapterDoc.dependencies || []).map((dependency) => [dependency.dependent_id, dependency]));
  const symbolConcepts = [];
  const definedByFormula = new Map();
  const symbolConceptByFormulaSymbolRole = new Map();
  const conceptIdCounts = new Map();
  const takenConceptIds = new Set();
  const registerConcept = (concept) => {
    const uniqueConcept = withUniqueConceptId(concept, conceptIdCounts, takenConceptIds);
    symbolConcepts.push(uniqueConcept);
    return uniqueConcept;
  };

  for (const formula of chapterDoc.formulas || []) {
    const promptRecord = promptMap.get(formula.id);
    const formulaSymbolSet = formulaSymbols(formula);
    const symbols = [
      ...formulaSymbolSet.defined.map((symbol) => ({ symbol, role: 'defined' })),
      ...formulaSymbolSet.used.map((symbol) => ({ symbol, role: 'used' })),
    ];
    const seen = new Set();
    for (const item of symbols) {
      const key = `${item.role}:${item.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const concept = registerConcept(makeSymbolConcept(chapterId, formula, item.symbol, item.role, promptRecord, structuredBlocks));
      symbolConceptByFormulaSymbolRole.set(`${formula.id}:${item.symbol}:${item.role}`, concept);
      if (item.role === 'defined') {
        const list = definedByFormula.get(formula.id) || [];
        list.push(concept);
        definedByFormula.set(formula.id, list);
      }
    }
  }

  const conceptViews = [];
  for (const formula of chapterDoc.formulas || []) {
    let currentConcepts = definedByFormula.get(formula.id) || [];
    if (!currentConcepts.length) {
      const promptRecord = promptMap.get(formula.id);
      const structuredEvidence = bestStructuredEvidence(formula, formula.label, formula.label, structuredBlocks);
      const teachingMove = conceptTeachingMoveFromContext(formulaContext(formula, promptRecord));
      currentConcepts = [registerConcept({
        chapter_id: chapterId,
        formula_id: formula.id,
        formula_label: formula.label,
        symbol: formula.label,
        role: 'defined',
        concept_id: `concept_${chapterId}_${slug(formula.id)}_statement`,
        concept_name: `${formula.label} Result`,
        concept_type: 'theorem_or_principle',
        definition: cleanDefinition(
          structuredEvidence?.sentence || sentenceWindow(`${promptRecord?.nearby_text || ''} ${formula.context_text || ''}`, formula.label),
          `${formula.label} statement.`,
        ),
        definition_zh: `${formula.label} 对应的公式结论，用来支撑当前概念视图。`,
        teaching_move: teachingMove?.teaching_move,
        teaching_move_zh: teachingMove?.teaching_move_zh,
        source_sentence: teachingMove?.source_sentence,
        aliases: [formula.label],
        evidence: evidenceFor(formula, promptRecord, structuredEvidence),
        confidence: structuredEvidence ? 0.68 : 0.62,
        review_status: 'unreviewed',
        review_flags: ['derived_from_formula_without_defined_symbol'],
        extraction_model: 'deterministic_formula_context_v1',
      })];
      definedByFormula.set(formula.id, currentConcepts);
    }

    const dependency = dependencyById.get(formula.id);
    const prereqFormulaEdges = acceptedFormulaPrerequisites(dependency);
    const prereqFormulaIds = new Set(prereqFormulaEdges.map((item) => item.target_id));
    const prerequisiteConcepts = [];
    for (const prereq of prereqFormulaEdges) {
      const prereqFormula = formulaById.get(prereq.target_id);
      const concepts = definedByFormula.get(prereq.target_id) || [];
      for (const concept of concepts) {
        prerequisiteConcepts.push({
          concept_id: concept.concept_id,
          name: concept.concept_name,
          defined_by_formula_id: concept.formula_id,
          from_formula_id: prereq.target_id,
          formula_label: prereqFormula?.label || prereq.target_id,
          symbol: concept.symbol,
          via_symbol: prereq.via_symbol || concept.symbol,
          clickable: true,
          confidence: prereq.confidence || concept.confidence || 0.76,
          relation: prereq.relation || 'formula_prerequisite',
          concept_type: concept.concept_type,
          definition: concept.definition,
          definition_zh: concept.definition_zh,
          teaching_move: concept.teaching_move,
          teaching_move_zh: concept.teaching_move_zh,
          source_sentence: concept.source_sentence,
          review_flags: concept.review_flags,
        });
      }
    }

    const prereqDefinedSymbols = new Set(
      [...prereqFormulaIds]
        .flatMap((formulaId) => formulaSymbols(formulaById.get(formulaId) || {}).defined),
    );
    const formulaSymbolSet = formulaSymbols(formula);
    const introducedConcepts = [];
    for (const symbol of formulaSymbolSet.used) {
      if (formulaSymbolSet.defined.includes(symbol)) continue;
      if (prereqDefinedSymbols.has(symbol)) continue;
      const concept = symbolConceptByFormulaSymbolRole.get(`${formula.id}:${symbol}:used`);
      if (!concept) continue;
      introducedConcepts.push({
        concept_id: concept.concept_id,
        name: concept.concept_name,
        symbol,
        defined_by_formula_id: null,
        formula_label: formula.label,
        clickable: false,
        confidence: concept.confidence,
        concept_type: concept.concept_type,
        definition: concept.definition,
        definition_zh: concept.definition_zh,
        teaching_move: concept.teaching_move,
        teaching_move_zh: concept.teaching_move_zh,
        source_sentence: concept.source_sentence,
        review_flags: concept.review_flags,
      });
    }

    const uniquePrerequisiteConcepts = dedupeConceptReferences(prerequisiteConcepts);
    const uniqueIntroducedConcepts = dedupeConceptReferences(introducedConcepts);

    for (const current of currentConcepts) {
      const prereqEdges = uniquePrerequisiteConcepts.map((concept) => ({
        from: concept.concept_id,
        to: current.concept_id,
        relation: 'prerequisite_for',
        derived_from_formula_edge: {
          from: concept.from_formula_id,
          to: formula.id,
          via_symbol: concept.via_symbol,
        },
        clickable: true,
        confidence: concept.confidence,
      }));
      const introducedEdges = uniqueIntroducedConcepts.map((concept) => ({
        from: concept.concept_id,
        to: current.concept_id,
        relation: 'introduced_for',
        symbol: concept.symbol,
        clickable: false,
        confidence: concept.confidence,
      }));
      conceptViews.push({
        chapter_id: chapterId,
        concept_id: current.concept_id,
        name: current.concept_name,
        definition: current.definition,
        definition_zh: current.definition_zh,
        teaching_move: current.teaching_move,
        teaching_move_zh: current.teaching_move_zh,
        source_sentence: current.source_sentence,
        concept_type: current.concept_type,
        defined_by_formula_id: formula.id,
        defined_symbol: current.symbol,
        supporting_formula_label: formula.label,
        supporting_formula_latex: formula.latex,
        formula_position: formula.position,
        formula_section: formula.section,
        formula_subsection: formula.subsection,
        evidence: current.evidence,
        confidence: current.confidence,
        review_status: current.review_status,
        review_flags: current.review_flags,
        prerequisite_concepts: uniquePrerequisiteConcepts,
        introduced_concepts: uniqueIntroducedConcepts.slice(0, 10),
        edges: [...prereqEdges, ...introducedEdges],
      });
    }
  }

  const summary = {
    chapter_id: chapterId,
    formulas_processed: chapterDoc.formulas?.length || 0,
    symbol_concept_entries: symbolConcepts.length,
    unique_concepts: new Set(symbolConcepts.map((item) => item.concept_id)).size,
    concept_views: conceptViews.length,
    prerequisite_edges: conceptViews.reduce((sum, view) => sum + view.prerequisite_concepts.length, 0),
    introduced_edges: conceptViews.reduce((sum, view) => sum + view.introduced_concepts.length, 0),
    low_confidence_entries: symbolConcepts.filter((item) => item.confidence < 0.72).length,
    formula_edges_used: conceptViews.reduce((sum, view) => sum + view.prerequisite_concepts.length, 0),
  };

  return {
    chapter_id: chapterId,
    version: 1,
    generated_at: new Date().toISOString(),
    source: {
      formula_dependency_graph: `data/frontend/dependency/${chapterId}_dependencies.json`,
      symbol_sense_prompts: `data/frontend/symbol_sense/prompts/${chapterId}.jsonl`,
      structured_blocks: `data/structured/${chapterId}_*.json`,
      method: 'deterministic concept views from formula dependencies, formula-symbol maps, and structured block evidence',
    },
    summary,
    symbol_concepts: symbolConcepts,
    views: conceptViews,
  };
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const dependencyFiles = (await readdir(DEPENDENCY_DIR)).filter((file) => file.endsWith('_dependencies.json')).sort();
  const index = {
    version: 1,
    generated_at: new Date().toISOString(),
    chapters: [],
  };

  for (const file of dependencyFiles) {
    const chapterDoc = JSON.parse(await readFile(resolve(DEPENDENCY_DIR, file), 'utf8'));
    const promptMap = await nearbyPromptMap(chapterDoc.chapter_id);
    const structuredBlocks = await structuredBlocksForChapter(chapterDoc.chapter_id);
    const conceptGraph = buildChapterConceptGraph(chapterDoc, promptMap, structuredBlocks);
    await writeFile(resolve(OUTPUT_DIR, `${chapterDoc.chapter_id}_concept_graph.json`), `${JSON.stringify(conceptGraph, null, 2)}\n`, 'utf8');
    index.chapters.push({
      chapter_id: chapterDoc.chapter_id,
      file: `${chapterDoc.chapter_id}_concept_graph.json`,
      ...conceptGraph.summary,
    });
  }

  index.summary = {
    chapters: index.chapters.length,
    formulas_processed: index.chapters.reduce((sum, item) => sum + item.formulas_processed, 0),
    symbol_concept_entries: index.chapters.reduce((sum, item) => sum + item.symbol_concept_entries, 0),
    concept_views: index.chapters.reduce((sum, item) => sum + item.concept_views, 0),
    prerequisite_edges: index.chapters.reduce((sum, item) => sum + item.prerequisite_edges, 0),
    introduced_edges: index.chapters.reduce((sum, item) => sum + item.introduced_edges, 0),
  };
  await writeFile(resolve(OUTPUT_DIR, 'concept_graph_index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  console.log(`Generated concept graphs for ${index.chapters.length} chapters in ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
