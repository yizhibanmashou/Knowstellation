import type { StorylineStep } from '../types/formula';
import { rawFormulaNumber } from './constants.ts';

export interface StorylineStepReadingCopy {
  question: string;
  answer: string;
  readCue: string;
  role: string;
  bridge: string;
  next: string;
}

interface StorylineCopyInput {
  storylineId: string;
  steps: StorylineStep[];
  selected: StorylineStep;
  symbol: string;
  plainMeaning?: string;
  chapterLabel?: string;
  formulaLabel?: string;
  context?: string;
  transition?: string;
  previousTitle?: string;
  nextTitle?: string;
}

const ALLELE_FREQUENCY_COPY: Record<string, StorylineStepReadingCopy> = {
  'formula_2.8': {
    question: 'p 从 p0 出发后，会在 t 代后落到哪里？',
    answer: '先把它读成一张路线图：起点是 p0，时间是 t，终点附近是 pt。',
    readCue: '第一眼只看左边的 φ(pt|p0)，它在问“从起点走到终点的可能性”。',
    role:
      '这一幕先把主角 p 从一个静态频率，推成一条会在时间里移动的轨迹。Formula 2.8 不要求你马上手算长求和；它先给 p 画出概率地图，让你知道从 p0 出发以后，t 代后可能散落到哪些位置。',
    bridge:
      '故事开场时，p 还只是群体中某个等位基因的频率。可是一代代随机抽样之后，p 不会乖乖待在原地；Formula 2.8 就是在回答第一个悬念：我们能不能看见它在许多代后的整张去向图？',
    next:
      '有了这张去向图，下一步自然会问：如果今天已经看到某个频率 p，这条路线到底走了多久？于是故事进入 Formula 2.12。',
  },
  'formula_2.12': {
    question: '看到今天的频率 p，它大概已经走了多久？',
    answer: '它把“现在在哪里”翻译成“已经存在了多久”。',
    readCue: '先把 E(t) 读作平均年龄，再看 p 越大时年龄为什么会变长。',
    role:
      '这一幕开始追问 p 的来历。前一站给了 p 的概率地图，Formula 2.12 则反过来问：如果我们今天看到一个频率 p，它背后那条中性漂变路线大概已经走了多久？',
    bridge:
      '上一站让我们看见 p 会走向哪里，但地图还没有告诉我们这条路已经走了多长。Formula 2.12 接住这个时间问题，把当前位置 p 翻译成中性等位基因的大致年龄。',
    next:
      '一旦时间尺度出现，故事就可以把镜头拉远：许多群体各自漂变同样长的时间，会被拉开多宽？这就接到 Formula 2.14a。',
  },
  'formula_2.14a': {
    question: '许多群体一起漂变时，p 会散开多宽？',
    answer: '它用方差记录群体之间的分散程度。',
    readCue: '先看 σp²(t) 是“散开宽度”，再看 t 和 2N 控制散开的速度。',
    role:
      '这一幕把镜头从一个群体拉远到许多群体。同样从 p0 出发，每个群体都会被随机漂变推向不同位置；Formula 2.14a 用方差记录这种分散，让 p 的旅程有了宽度。',
    bridge:
      '当我们知道单个等位基因可能已经走了多久，故事就不只盯着一条轨迹了。Formula 2.14a 把许多重复群体放在一起看：漂变会让它们的 p 越走越分散，而方差就是这份分散的尺子。',
    next:
      '知道会散开以后，下一步要确认这份散开有没有方向。Formula 2.15 给出中性答案：平均来说，p 不偏离起点。',
  },
  'formula_2.15': {
    question: '中性漂变会不会把 p 往某个方向推？',
    answer: '不会。单个群体会晃动，平均起来仍守在 p0。',
    readCue: '把 E(pt)=p0 当作中性基线：有波动，但没有平均方向。',
    role:
      '这一幕立住中性漂变的参照线。p 在每个群体里都会随机摇晃，但许多重复群体平均起来仍等于起点 p0；这个基线会帮助你判断后面出现的方向性变化来自哪里。',
    bridge:
      '上一站已经说明 p 会在群体之间散开，可散开不等于有方向。Formula 2.15 把这个界限讲清楚：中性漂变制造差异，却不在平均意义上偏向某个方向。',
    next:
      '于是新的角色可以登场了：如果观察到系统性的上升或下降，就需要选择来解释。故事顺势进入 Formula 5.6e。',
  },
  'formula_5.6e': {
    question: '选择出现后，pi 会往哪个方向变？',
    answer: '选择把频率变化变成有方向的增量。',
    readCue: '先看 Δpi，再找谁在给它方向：频率、效应和适合度地形。',
    role:
      '这一幕让选择正式进场。前面中性基线说 p 没有平均方向；Formula 5.6e 开始说明，当适合度差异存在时，pi 会被推向更有利的位置。',
    bridge:
      '中性漂变的故事告诉我们：没有方向性力量时，p 只是在随机摇晃。Formula 5.6e 改变了舞台规则，选择开始给频率变化一个方向，于是 p 不再只是漂移，而是在适合度地形上移动。',
    next:
      '频率已经会被选择推动，下一步就要问：频率变了，等位基因带来的效应会不会也一起变？这会把故事带进 Formula 6.15b。',
  },
  'formula_6.15b': {
    question: '频率变化能和效应变化一起记账吗？',
    answer: '可以。频率 pj 和效应 bj 都被写成“旧值加变化”。',
    readCue: '把 pj 和 bj 当成一对状态量：一个说谁更多，一个说带来什么效应。',
    role:
      '这一幕把 p 放进更大的 Price 方程视角。故事不再只问某个等位基因多了还是少了，还要一起追踪它带来的平均效应有没有改变。',
    bridge:
      '选择已经让频率变化有了方向，但频率不是故事的全部。Formula 6.15b 把 pj 和 bj 并排更新：一个记录等位基因占比怎么变，另一个记录这个等位基因带来的效应怎么变。',
    next:
      '到这里，p 的这一段旅程暂时收束：它从随机漂变的位置图，走到选择和效应变化的联合记账。接下来可以打开图谱，检查这一步周围的前置公式。',
  },
};

export function getCuratedStorylineCopy(storylineId: string, formulaId: string): StorylineStepReadingCopy | null {
  if (storylineId === 'allele-frequency') return ALLELE_FREQUENCY_COPY[formulaId] || null;
  return null;
}

export function buildStoryStepQuestion(storylineId: string, step: StorylineStep, fallback = ''): string {
  return getCuratedStorylineCopy(storylineId, step.formula_id)?.question || fallback.replace(/[。.!?！？]$/, '') || `${step.title} 想回答什么问题？`;
}

export function buildStoryStepAnswer(storylineId: string, step: StorylineStep, fallback = ''): string {
  return getCuratedStorylineCopy(storylineId, step.formula_id)?.answer || fallback.replace(/[。.!?！？]$/, '') || '先抓住这一步回答的问题，再回头看公式细节。';
}

export function buildStoryStepReadCue(storylineId: string, step: StorylineStep, fallback = ''): string {
  return getCuratedStorylineCopy(storylineId, step.formula_id)?.readCue || fallback || '先读左边要计算的量，再看右边由哪些条件决定。';
}

export function buildStorylineRoleText(input: StorylineCopyInput): string {
  const curated = getCuratedStorylineCopy(input.storylineId, input.selected.formula_id);
  if (curated) return curated.role;

  const index = input.steps.findIndex((step) => step.formula_id === input.selected.formula_id);
  const symbolText = input.symbol.replace(/\\/g, '');
  const formulaLabel = input.formulaLabel || input.selected.title;
  const chapterLabel = input.chapterLabel || '当前章节';
  const plainMeaning = input.plainMeaning || summarizeStoryContext(input.context || '');

  if (index <= 0) {
    return `故事从 ${formulaLabel} 开场：它先把 ${symbolText} 放进 ${chapterLabel} 的具体模型里，让读者知道这条线到底在追踪什么量。${plainMeaning || '先把本式里的符号和概率对象读清楚，再看后面的模型如何改写它。'}`;
  }
  if (index === input.steps.length - 1) {
    return `${formulaLabel} 像这一幕的收束镜头：前面几站已经交代了 ${symbolText} 的语境，现在它可以回答一个更完整的问题。${plainMeaning}`.trim();
  }
  return `${formulaLabel} 是中途的转折点：它没有另起炉灶，而是把 ${symbolText} 放回 ${chapterLabel} 的新问题里，改变读者追问的角度。${plainMeaning}`.trim();
}

export function buildStorylineTransitionText(input: StorylineCopyInput): string {
  const curated = getCuratedStorylineCopy(input.storylineId, input.selected.formula_id);
  if (curated) return curated.bridge;

  const index = input.steps.findIndex((step) => step.formula_id === input.selected.formula_id);
  const transition = input.transition || '';
  const templateLikeTransition = !transition || /符号的外形延续下来|new job|visual identity/i.test(transition);
  const contextHint = summarizeStoryContext(input.context || '');

  if (index <= 0) {
    return `${templateLikeTransition ? '开场这一式先建立可追踪的数学对象：读者知道要盯住谁、它由哪些条件决定。' : transition} ${contextHint || '后续步骤会沿着这个对象继续追问它如何随模型假设改变。'}`;
  }

  const bridge = input.previousTitle
    ? `上一站 ${input.previousTitle} 留下了一个未完成的问题：只知道当前关系还不够，还要看它在新的模型条件下会怎样推进。当前公式接住这个问题，把读者的注意力转向下一层机制。`
    : '到这里，本章语境很重要：公式不是被简单复用，而是在新的问题里被重新解释。';
  return `${templateLikeTransition ? bridge : transition} ${input.plainMeaning || contextHint}`.trim();
}

export function buildStorylineNextStepText(input: StorylineCopyInput): string {
  const curated = getCuratedStorylineCopy(input.storylineId, input.selected.formula_id);
  if (curated) return curated.next;

  const index = input.steps.findIndex((step) => step.formula_id === input.selected.formula_id);
  const next = input.steps[index + 1];
  if (!next) return '因此这条路线到这里暂时收束：主角已经完成了这一轮解释任务。想检查局部数学关系，可以打开图谱查看它周围的公式邻域。';
  const nextLabel = input.nextTitle || `Formula ${rawFormulaNumber(next.formula_id)}`;
  return `所以下一步自然读 ${nextLabel}：它会接住当前公式留下的问题，继续检查同一条概念线在新的模型条件下如何改变。`;
}

export function buildNarrativeBridge(transition = '', next = ''): string {
  const first = transition.trim();
  const second = next.trim();
  if (!first) return second;
  if (!second) return first;
  return `${first}\n\n${second}`;
}

function summarizeStoryContext(context = ''): string {
  const cleaned = context
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const lower = cleaned.toLowerCase();
  if (lower.includes('probability density') || lower.includes('diffusion theory') || lower.includes('hypergeometric')) {
    return '教材附近在把等位基因频率的漂变过程从离散抽样推进到连续概率密度，重点是看 p 从初始值走到某个频率的可能性。';
  }
  if (lower.includes('expected age') || (lower.includes('allele') && lower.includes('older'))) {
    return '教材附近在追问中性等位基因已经在群体里停留多久，当前频率越高，通常意味着它经历的时间越长。';
  }
  if (lower.includes('heterozygosity') || lower.includes('among-population variance')) {
    return '教材附近在把漂变造成的群体间差异和杂合度变化联系起来，重点是看方差如何随时间累积。';
  }
  if (lower.includes('no directional forces') || lower.includes('neutrality')) {
    return '教材附近强调中性条件下没有方向性力量，所以频率的期望值会围绕初始频率保持不偏。';
  }
  if (lower.includes('wright-fisher') || lower.includes('binomial')) {
    return '教材附近在用 Wright-Fisher 抽样说明一代到下一代的随机转移，重点是把拷贝数变化写成概率规则。';
  }
  return '教材附近正在补充这条公式的模型语境；先抓住它要计算的量，再看下一站如何继续追问。';
}
