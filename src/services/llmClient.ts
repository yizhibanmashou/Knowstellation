import type { FormulaPrerequisite, SearchFormula, StorylineEntry, StorylineStep } from '../types/formula';
import type { LanguageCode } from '../types/learning';
import { compressTextToShortLabel } from '../utils/symbolAnnotation.ts';

const LLM_ENDPOINT = '/api/llm';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_TIMEOUT_MS = 12000;
const STATIC_CACHE_URL = '/data/llm_cache.json';
const STATIC_ONLY = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_LLM_STATIC_ONLY === 'true';
const PERSISTED_CACHE_PREFIX = 'litgraph:llm:v1:';
const PERSISTED_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const requestCache = new Map<string, Promise<unknown>>();
let staticCachePromise: Promise<StaticLlmCache | null> | null = null;

interface PersistedCacheEnvelope<T> {
  storedAt: number;
  value: T;
}

export interface StaticLlmCache {
  version: number;
  generated_at: string;
  source?: string;
  model?: string;
  entries: Record<string, unknown>;
}

export interface FormulaNoteRequest {
  formulaId: string;
  latex: string;
  context: string;
  section?: string;
  prerequisites?: FormulaPrerequisite[];
  language: LanguageCode;
}

export interface FormulaNoteResponse {
  plainMeaning: string;
  inThisChapter: string;
}

export interface VariableDetailRequest {
  formulaId: string;
  latex: string;
  context?: string;
  symbol: string;
  prerequisite?: FormulaPrerequisite;
  language: LanguageCode;
}

export interface VariableDetailResponse {
  shortLabel: string;
  text: string;
}

export interface VariableDetailsBatchRequest {
  formulaId: string;
  latex: string;
  context?: string;
  symbols: Array<{
    symbol: string;
    kind?: 'symbol' | 'compound' | 'formula';
    prerequisite?: FormulaPrerequisite;
  }>;
  language: LanguageCode;
}

export interface VariableDetailsBatchItem extends VariableDetailResponse {
  symbol: string;
}

export interface VariableDetailsBatchResponse {
  items: VariableDetailsBatchItem[];
}

export interface StorylineNarrativeRequest {
  storyline: StorylineEntry;
  selectedStep: StorylineStep;
  previousStep?: StorylineStep | null;
  nextStep?: StorylineStep | null;
  formula: {
    id: string;
    latex: string;
    context: string;
    section?: string;
    label?: string;
  };
  formulaCopy?: FormulaNoteResponse | null;
  language: LanguageCode;
}

export interface StorylineNarrativeResponse {
  role: string;
  transition: string;
  next: string;
}

export interface ChapterOverviewRequest {
  chapterId: string;
  chapterTitle: string;
  chapterDescription?: string;
  formulas: Array<
    Pick<SearchFormula, 'id' | 'label' | 'section' | 'latex_preview' | 'context'> & {
      role: 'backbone' | 'representative' | 'support';
    }
  >;
  language: LanguageCode;
}

export interface ChapterOverviewResponse {
  overview: string;
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  response_format: { type: 'json_object' };
}

function prerequisiteSummary(prerequisites: FormulaPrerequisite[] = []): string {
  return prerequisites
    .slice(0, 12)
    .map((item) =>
      [
        item.type,
        item.target_id ? `target=${item.target_id}` : '',
        item.symbol ? `symbol=${item.symbol}` : '',
        item.via_symbol ? `via=${item.via_symbol}` : '',
        item.edge_evidence ? `evidence=${item.edge_evidence}` : '',
        item.meaning || item.definition || item.reason || item.source_excerpt || '',
      ]
        .filter(Boolean)
        .join('; '),
    )
    .join('\n');
}

export function buildFormulaNotesChatRequest(input: FormulaNoteRequest): ChatCompletionRequest {
  const zh = input.language === 'zh';
  return {
    model: DEFAULT_MODEL,
    temperature: 0.25,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          zh
            ? '你是一名严谨、具体、会带本科生读教材的科学助教。只返回 JSON，不要 Markdown。解释必须紧扣给定公式、章节、上下文和依赖关系；不要写“这个公式很重要”一类空话，不要编造教材外事实。'
            : 'You are a rigorous science teaching assistant. Return JSON only, no Markdown. Ground the explanation in the given formula, section, context, and accepted prerequisites; avoid generic filler and do not invent facts outside the evidence.',
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            task: 'formula_notes',
            language: input.language,
            output_schema: {
              plainMeaning: zh
                ? '用中文解释这个公式具体在计算/连接什么量，1-2 句；必须点名公式中的关键符号。'
                : 'Explain what the formula specifically computes or connects in 1-2 sentences; name the key symbols.',
              inThisChapter: zh
                ? '结合章节上下文说明它为什么出现在这里、为后续推导铺垫什么，1-2 句。'
                : 'Explain why it appears in this section and what later argument it supports in 1-2 sentences.',
            },
            formula_id: input.formulaId,
            latex: input.latex,
            section: input.section || '',
            context: input.context || '',
            accepted_prerequisites: prerequisiteSummary(input.prerequisites),
          },
          null,
          2,
        ),
      },
    ],
  };
}

export function buildVariableDetailsChatRequest(input: VariableDetailRequest): ChatCompletionRequest {
  const zh = input.language === 'zh';
  return {
    model: DEFAULT_MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          zh
            ? '你解释数学公式里的变量和符号。只返回 JSON，不要 Markdown。解释必须贴合当前公式和给定上下文，说明这个符号在本式中承担什么角色；不要把同形符号强行说成同一个含义。'
            : 'Explain symbols in mathematical formulas. Return JSON only, no Markdown. Ground the explanation in this formula and context, and state the symbol role in this formula.',
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            task: 'variable_details',
            language: input.language,
            output_schema: {
              shortLabel: zh
                ? '4-16 字名词短语，用于公式旁指引框；只写符号在本式中的角色，不要句子、不要复述符号本身。'
                : 'A 4-16 word noun phrase for the in-formula callout; state the symbol role in this formula only.',
              text: zh
                ? '解释这个符号在当前公式中的含义和作用，1-2 句；不要只复述符号名。'
                : 'Explain the symbol meaning and role in this formula in 1-2 sentences; do not merely restate the symbol name.',
            },
            formula_id: input.formulaId,
            latex: input.latex,
            context: input.context || '',
            symbol: input.symbol,
            prerequisite: input.prerequisite || null,
          },
          null,
          2,
        ),
      },
    ],
  };
}

export function buildVariableDetailsBatchChatRequest(input: VariableDetailsBatchRequest): ChatCompletionRequest {
  const zh = input.language === 'zh';
  return {
    model: DEFAULT_MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          zh
            ? '你解释数学公式里的符号和组合表达式。只返回 JSON，不要 Markdown。必须贴合当前公式和上下文；单个符号解释其角色，组合表达式解释整个组合的意义，不要只解释组合里的某一个字母。'
            : 'Explain symbols and compound expressions in mathematical formulas. Return JSON only, no Markdown. Ground every explanation in this formula and context; for compounds explain the whole expression, not just one letter inside it.',
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            task: 'variable_details_batch',
            language: input.language,
            output_schema: {
              items: [
                {
                  symbol: zh ? '必须原样返回输入中的 symbol' : 'Return the input symbol exactly.',
                  shortLabel: zh
                    ? '4-16 字名词短语，用于公式旁指引框；组合项要写整体含义。'
                    : 'A 4-16 word noun phrase for the in-formula callout; compounds must name the whole expression role.',
                  text: zh
                    ? '解释这个符号或组合表达式在当前公式中的含义和作用，1-2 句；不要只复述符号名。'
                    : 'Explain this symbol or compound expression in this formula in 1-2 sentences; do not merely restate it.',
                },
              ],
            },
            formula_id: input.formulaId,
            latex: input.latex,
            context: input.context || '',
            symbols: input.symbols.map((item) => ({
              symbol: item.symbol,
              kind: item.kind || 'symbol',
              prerequisite: item.prerequisite || null,
            })),
          },
          null,
          2,
        ),
      },
    ],
  };
}

export function buildStorylineNarrativeChatRequest(input: StorylineNarrativeRequest): ChatCompletionRequest {
  const zh = input.language === 'zh';
  return {
    model: DEFAULT_MODEL,
    temperature: 0.45,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          zh
            ? '你是一名会把教材公式串成学习线索的科学写作者。只返回 JSON，不要 Markdown。写法要像连续故事：上一站留下悬念，当前公式接住悬念，下一站自然出现。必须围绕公式、符号、前后步骤和教材上下文展开；避免“符号外形延续”“承担新任务”这类空泛模板句，不要编造教材外剧情。'
            : 'You write formula-grounded scientific learning narratives. Return JSON only, no Markdown. Ground the narrative in formulas, symbols, neighboring steps, and textbook context; avoid generic template phrases and do not invent facts.',
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            task: 'storyline_narrative',
            language: input.language,
            output_schema: {
              role: zh
                ? '当前公式在这条故事线里的具体角色，2-3 句；写成“这一站/这一幕”在推进什么，必须结合公式本身和故事线符号。'
                : 'The selected formula role in this storyline, 2-3 sentences; ground it in the formula and storyline symbol.',
              transition: zh
                ? '从上一个公式到当前公式，上一站留下了什么问题，当前公式如何接住；数学对象、模型语境或问题焦点发生了什么具体变化，2-3 句。'
                : 'Describe the concrete change in mathematical object, model context, or question focus from the previous step, 2-3 sentences.',
              next: zh
                ? '下一步为什么自然发生，1-2 句；要点名下一公式或下一问题，并用“因此/所以/接下来”形成衔接。'
                : 'Explain why the next step follows naturally in 1-2 sentences; name the next formula or question.',
            },
            story_bridge_rules: zh
              ? [
                  'transition 和 next 会在界面合并为“故事串联”，因此两段必须前后连贯。',
                  'transition 必须说明上一公式留下什么问题，以及当前公式如何接住这个问题。',
                  'next 必须说明下一公式或下一问题为什么自然出现。',
                  '不要写“符号外形延续”“承担新任务”等模板句。',
                ]
              : [
                  'transition and next are displayed together as one story bridge, so they must read coherently.',
                  'transition must state what question the previous formula left and how the current formula takes it up.',
                  'next must explain why the next formula or next question naturally appears.',
                  'Avoid template phrases such as visual identity or new job.',
                ],
            storyline: {
              id: input.storyline.id,
              title: input.storyline.title_zh || input.storyline.title_en,
              symbol: input.storyline.symbol,
              intro: input.storyline.intro_zh || input.storyline.intro_en,
            },
            selected_step: input.selectedStep,
            previous_step: input.previousStep || null,
            next_step: input.nextStep || null,
            formula: input.formula,
            formula_copy: input.formulaCopy || null,
          },
          null,
          2,
        ),
      },
    ],
  };
}

export function buildChapterOverviewChatRequest(input: ChapterOverviewRequest): ChatCompletionRequest {
  const zh = input.language === 'zh';
  const formulaSamples = input.formulas.slice(0, 18).map((formula) => ({
    id: formula.id,
    label: formula.label,
    role: formula.role,
    section: formula.section,
    latex: formula.latex_preview,
    context: formula.context,
  }));
  return {
    model: DEFAULT_MODEL,
    temperature: 0.35,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: zh
          ? '你是一名严谨、具体、会带本科生读教材的科学助教。只返回 JSON，不要 Markdown。你要为图谱侧栏写章节导读，必须紧扣章节标题、简介和公式样本；不要编造教材外事实，不要罗列公式清单，不要写空泛学习鸡汤。'
          : 'You are a rigorous science teaching assistant. Return JSON only, no Markdown. Write a chapter overview for a graph sidebar, grounded in the chapter title, description, and formula samples; do not invent external facts or list formulas mechanically.',
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            task: 'chapter_overview',
            language: input.language,
            output_schema: {
              overview: zh
                ? '中文章节概括介绍，约 520-680 字，分 4 段；写满侧栏导读区域。说明本章研究的问题、图谱里公式如何展开、读者应先抓住哪些主线，以及读完整章后能带走什么。必须自然提到 2-4 个代表公式编号或关键量。'
                : 'A 260-360 word chapter overview in 4 paragraphs for the sidebar. Explain the central problem, how the formula graph unfolds, what routes to read first, and what the reader should take away. Naturally mention 2-4 representative formulas or quantities.',
            },
            chapter: {
              id: input.chapterId,
              title: input.chapterTitle,
              description: input.chapterDescription || '',
            },
            formula_samples: formulaSamples,
          },
          null,
          2,
        ),
      },
    ],
  };
}

function parseJsonObject(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('LLM response did not contain JSON.');
    return JSON.parse(match[0]);
  }
}

async function postChatCompletion<T>(
  request: ChatCompletionRequest,
  validate: (value: unknown) => T,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(LLM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new Error('LLM request timed out.');
    throw new Error('LLM request could not reach the proxy.');
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
  if (!response.ok) {
    let message = `LLM request failed with ${response.status}`;
    try {
      const errorPayload = await response.json();
      if (typeof errorPayload?.error === 'string') message = errorPayload.error;
    } catch {
      // Keep the status-based message when the proxy does not return JSON.
    }
    throw new Error(message);
  }
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('LLM response did not include message content.');
  return validate(parseJsonObject(content));
}

function requireStringField(value: unknown, field: string): string {
  if (!value || typeof value !== 'object') throw new Error('LLM JSON response was not an object.');
  const fieldValue = (value as Record<string, unknown>)[field];
  if (typeof fieldValue !== 'string' || !fieldValue.trim()) throw new Error(`LLM JSON response missing ${field}.`);
  return fieldValue.trim();
}

function hasRawEnglishLeak(value: string): boolean {
  const compact = value.replace(/\s+/g, ' ').trim();
  const latinWords = compact.match(/\b[A-Za-z][A-Za-z'-]{2,}\b/g) || [];
  const chineseChars = compact.match(/[\u3400-\u9fff]/g) || [];
  if (latinWords.length >= 14 && latinWords.length > Math.max(6, chineseChars.length * 0.45)) return true;
  if (chineseChars.length > 12) return false;
  return /(?:probability density|where\s+\$?F|\bEquation\s+\d)/i.test(compact);
}

function hasGenericStoryTemplate(value: string): boolean {
  return /符号(?:的)?外形(?:延续|相似)|承担新任务|new job|visual identity|公式很重要|起到承上启下的作用/i.test(value);
}

function assertLearnerFacingText(value: string, field: string, language: LanguageCode = 'zh') {
  if (language === 'zh' && hasRawEnglishLeak(value)) throw new Error(`LLM ${field} looks like raw textbook context.`);
  if (hasGenericStoryTemplate(value)) throw new Error(`LLM ${field} used a generic template phrase.`);
}

function validateFormulaNotes(value: unknown, language: LanguageCode = 'zh'): FormulaNoteResponse {
  const plainMeaning = requireStringField(value, 'plainMeaning');
  const inThisChapter = requireStringField(value, 'inThisChapter');
  assertLearnerFacingText(plainMeaning, 'plainMeaning', language);
  assertLearnerFacingText(inThisChapter, 'inThisChapter', language);
  return { plainMeaning, inThisChapter };
}

function validateVariableDetails(value: unknown): VariableDetailResponse {
  const text = requireStringField(value, 'text');
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const rawShortLabel = typeof record.shortLabel === 'string' ? record.shortLabel.trim() : '';
  const shortLabel = rawShortLabel || compressTextToShortLabel(text);
  if (!shortLabel) throw new Error('LLM JSON response missing shortLabel.');
  return { shortLabel, text };
}

function validateVariableDetailsBatch(value: unknown): VariableDetailsBatchResponse {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  if (!Array.isArray(record.items)) throw new Error('LLM JSON response missing items.');
  const items = record.items.map((item) => {
    const itemRecord = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const symbol = requireStringField(item, 'symbol');
    const text = requireStringField(item, 'text');
    const rawShortLabel = typeof itemRecord.shortLabel === 'string' ? itemRecord.shortLabel.trim() : '';
    const shortLabel = rawShortLabel || compressTextToShortLabel(text);
    if (!shortLabel) throw new Error('LLM JSON response missing shortLabel.');
    return { symbol, shortLabel, text };
  });
  return { items };
}

function validateStorylineNarrative(value: unknown, language: LanguageCode = 'zh'): StorylineNarrativeResponse {
  const role = requireStringField(value, 'role');
  const transition = requireStringField(value, 'transition');
  const next = requireStringField(value, 'next');
  assertLearnerFacingText(role, 'role', language);
  assertLearnerFacingText(transition, 'transition', language);
  assertLearnerFacingText(next, 'next', language);
  return { role, transition, next };
}

function validateChapterOverview(value: unknown, language: LanguageCode = 'zh'): ChapterOverviewResponse {
  const overview = requireStringField(value, 'overview');
  assertLearnerFacingText(overview, 'overview', language);
  return { overview };
}

function persistedCacheKey(key: string): string {
  return `${PERSISTED_CACHE_PREFIX}${encodeURIComponent(key)}`;
}

function readPersistedCache<T>(key: string): T | null {
  try {
    if (typeof globalThis.localStorage === 'undefined') return null;
    const raw = globalThis.localStorage.getItem(persistedCacheKey(key));
    if (!raw) return null;
    const payload = JSON.parse(raw) as PersistedCacheEnvelope<T>;
    if (!payload || typeof payload.storedAt !== 'number') return null;
    if (Date.now() - payload.storedAt > PERSISTED_CACHE_TTL_MS) {
      globalThis.localStorage.removeItem(persistedCacheKey(key));
      return null;
    }
    return payload.value;
  } catch {
    return null;
  }
}

function writePersistedCache<T>(key: string, value: T) {
  try {
    if (typeof globalThis.localStorage === 'undefined') return;
    const payload: PersistedCacheEnvelope<T> = {
      storedAt: Date.now(),
      value,
    };
    globalThis.localStorage.setItem(persistedCacheKey(key), JSON.stringify(payload));
  } catch {
    // Browser storage can be disabled or full; the in-memory request cache still protects the session.
  }
}

function isStaticLlmCache(value: unknown): value is StaticLlmCache {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return typeof record.version === 'number' && typeof record.entries === 'object' && record.entries !== null;
}

async function loadStaticCache(fetchImpl: typeof fetch = fetch): Promise<StaticLlmCache | null> {
  if (typeof fetchImpl !== 'function') return null;
  if (!staticCachePromise) {
    staticCachePromise = fetchImpl(STATIC_CACHE_URL)
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = await response.json();
        return isStaticLlmCache(payload) ? payload : null;
      })
      .catch(() => null);
  }
  return staticCachePromise;
}

function validateStaticCacheEntry<T>(key: string, value: unknown, validate: (value: unknown) => T): T | null {
  try {
    return validate(value);
  } catch {
    if (typeof console !== 'undefined') {
      console.warn(`Static LLM cache entry is invalid and will be ignored: ${key}`);
    }
    return null;
  }
}

export function formulaNotesCacheKey(formulaId: string, language: LanguageCode): string {
  return `formula-notes:${formulaId}:${language}`;
}

export function variableDetailsCacheKey(formulaId: string, symbol: string, language: LanguageCode): string {
  return `variable-details:${formulaId}:${symbol}:${language}`;
}

export function variableDetailsBatchCacheKey(
  formulaId: string,
  language: LanguageCode,
  symbols: VariableDetailsBatchRequest['symbols'],
): string {
  const symbolKey = symbols.map((item) => `${item.kind || 'symbol'}:${item.symbol}`).join('|');
  return `variable-details-batch:${formulaId}:${language}:${symbolKey}`;
}

export function storylineNarrativeCacheKey(storylineId: string, formulaId: string, language: LanguageCode): string {
  return `storyline:${storylineId}:${formulaId}:${language}`;
}

export function chapterOverviewCacheKey(chapterId: string, language: LanguageCode): string {
  return `chapter-overview:${chapterId}:${language}`;
}

export async function generateFormulaNotes(request: FormulaNoteRequest): Promise<FormulaNoteResponse> {
  return cachedStaticFirstRequest(
    formulaNotesCacheKey(request.formulaId, request.language),
    () => postChatCompletion(buildFormulaNotesChatRequest(request), (value) => validateFormulaNotes(value, request.language)),
    (value) => validateFormulaNotes(value, request.language),
  );
}

export async function generateVariableDetails(request: VariableDetailRequest): Promise<VariableDetailResponse> {
  return cachedStaticFirstRequest(
    variableDetailsCacheKey(request.formulaId, request.symbol, request.language),
    () => postChatCompletion(buildVariableDetailsChatRequest(request), validateVariableDetails),
    validateVariableDetails,
  );
}

export async function generateVariableDetailsBatch(request: VariableDetailsBatchRequest): Promise<VariableDetailsBatchResponse> {
  return cachedStaticFirstRequest(
    variableDetailsBatchCacheKey(request.formulaId, request.language, request.symbols),
    () => postChatCompletion(buildVariableDetailsBatchChatRequest(request), validateVariableDetailsBatch),
    validateVariableDetailsBatch,
  );
}

export async function generateStorylineNarrative(request: StorylineNarrativeRequest): Promise<StorylineNarrativeResponse> {
  return cachedStaticFirstRequest(
    storylineNarrativeCacheKey(request.storyline.id, request.selectedStep.formula_id, request.language),
    () => postChatCompletion(buildStorylineNarrativeChatRequest(request), (value) => validateStorylineNarrative(value, request.language)),
    (value) => validateStorylineNarrative(value, request.language),
  );
}

export async function generateChapterOverview(request: ChapterOverviewRequest): Promise<ChapterOverviewResponse> {
  return cachedStaticFirstRequest(
    chapterOverviewCacheKey(request.chapterId, request.language),
    () => postChatCompletion(buildChapterOverviewChatRequest(request), (value) => validateChapterOverview(value, request.language)),
    (value) => validateChapterOverview(value, request.language),
  );
}

function cachedRequest<T>(key: string, factory: () => Promise<T>, validate: (value: unknown) => T): Promise<T> {
  const existing = requestCache.get(key);
  if (existing) return existing as Promise<T>;
  const persisted = readPersistedCache<T>(key);
  if (persisted) {
    const persistedPromise = Promise.resolve(persisted);
    requestCache.set(key, persistedPromise);
    return persistedPromise;
  }
  const promise = factory()
    .then((value) => {
      writePersistedCache(key, value);
      return value;
    })
    .catch((error) => {
      requestCache.delete(key);
      throw error;
    });
  requestCache.set(key, promise);
  return promise;
}

async function cachedStaticFirstRequest<T>(key: string, factory: () => Promise<T>, validate: (value: unknown) => T): Promise<T> {
  const staticCache = await loadStaticCache();
  if (staticCache && Object.prototype.hasOwnProperty.call(staticCache.entries, key)) {
    const staticValue = validateStaticCacheEntry(key, staticCache.entries[key], validate);
    if (staticValue) return staticValue;
  }
  if (STATIC_ONLY) throw new Error(`Static LLM cache missing entry: ${key}`);
  return cachedRequest(key, factory, validate);
}

export const __llmClientTestUtils = {
  postChatCompletion,
  validateFormulaNotes,
  validateVariableDetails,
  validateVariableDetailsBatch,
  validateStorylineNarrative,
  validateChapterOverview,
  loadStaticCache,
  validateStaticCacheEntry,
  requestCache,
  resetStaticCache: () => {
    staticCachePromise = null;
  },
  setStaticCacheForTest: (cache: StaticLlmCache | null) => {
    staticCachePromise = Promise.resolve(cache);
  },
  DEFAULT_TIMEOUT_MS,
};
