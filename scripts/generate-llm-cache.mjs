import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  __llmClientTestUtils,
  buildChapterOverviewChatRequest,
  buildFormulaNotesChatRequest,
  buildStorylineNarrativeChatRequest,
  buildVariableDetailsBatchChatRequest,
  buildVariableDetailsChatRequest,
  chapterOverviewCacheKey,
  formulaNotesCacheKey,
  storylineNarrativeCacheKey,
  variableDetailsBatchCacheKey,
  variableDetailsCacheKey,
} from '../src/services/llmClient.ts';
import { buildCompoundFocusAnnotations } from '../src/utils/focusAnnotations.ts';
import {
  buildFormulaSymbolPrerequisites,
  buildReadableFormulaCopy,
} from '../src/utils/formulaInfo.ts';
import { formatChapterLabel } from '../src/utils/uiCopy.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'public', 'data', 'llm_cache.json');
const MIRROR_OUTPUT = path.join(ROOT, 'data', 'frontend', 'llm_cache.json');
const MODEL = 'deepseek-chat';
const API_URL = 'https://api.deepseek.com/chat/completions';
const CACHE_VERSION = 1;
const DEFAULT_RETRIES = 2;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_REQUEST_TIMEOUT_MS = 45000;
const DEFAULT_LANGUAGES = ['zh', 'en'];
const VARIABLE_LANGUAGES = ['zh'];
const STORYLINE_LANGUAGES = ['zh'];
const CATEGORIES = ['formula-notes', 'chapter-overviews', 'variables', 'storylines'];
const NON_TEACHING_SYMBOLS = new Set(['\\pi', '\\infty']);

const validators = __llmClientTestUtils;

function parseArgs(argv) {
  const options = {
    only: new Set(CATEGORIES),
    output: DEFAULT_OUTPUT,
    force: false,
    dryRun: false,
    limit: Number.POSITIVE_INFINITY,
    concurrency: DEFAULT_CONCURRENCY,
    retries: DEFAULT_RETRIES,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--force') options.force = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--only') options.only = new Set(String(argv[++index] || '').split(',').filter(Boolean));
    else if (arg === '--limit') options.limit = Number(argv[++index]);
    else if (arg === '--concurrency') options.concurrency = Math.max(1, Number(argv[++index]) || DEFAULT_CONCURRENCY);
    else if (arg === '--retries') options.retries = Math.max(0, Number(argv[++index]) || DEFAULT_RETRIES);
    else if (arg === '--output') options.output = path.resolve(ROOT, argv[++index]);
  }
  return options;
}

function loadEnvFile(filename) {
  const filePath = path.join(ROOT, filename);
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

async function writeJsonWithRetry(filePath, value) {
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      writeJson(filePath, value);
      return;
    } catch (error) {
      lastError = error;
      await sleep(250 * (attempt + 1));
    }
  }
  throw lastError;
}

function makeEmptyCache() {
  return {
    version: CACHE_VERSION,
    generated_at: new Date().toISOString(),
    source: 'deepseek-offline-generation',
    model: MODEL,
    entries: {},
  };
}

function loadCache(outputPath) {
  const existing = readJson(outputPath, null);
  if (existing && existing.entries && typeof existing.entries === 'object') {
    return {
      ...existing,
      version: CACHE_VERSION,
      generated_at: existing.generated_at || new Date().toISOString(),
      source: existing.source || 'deepseek-offline-generation',
      model: existing.model || MODEL,
      entries: existing.entries,
    };
  }
  return makeEmptyCache();
}

function allNavigatorChapters(navigator) {
  return (navigator.groups || []).flatMap((group) => group.chapters || []);
}

function languageTitle(chapter, language) {
  return language === 'zh' ? chapter.title_zh || chapter.title_en : chapter.title_en || chapter.title_zh;
}

function languageDescription(chapter, language) {
  return language === 'zh'
    ? chapter.description_zh || chapter.description_en || ''
    : chapter.description_en || chapter.description_zh || '';
}

function isTeachingVariableSymbol(symbol) {
  return Boolean(symbol) && !NON_TEACHING_SYMBOLS.has(String(symbol));
}

function shouldRenderVariablePrerequisite(prereq) {
  return prereq.type === 'variable_definition' && (prereq.edge_status ?? 'accepted') === 'accepted' && isTeachingVariableSymbol(prereq.symbol);
}

function dedupeFocusAnnotations(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.kind || 'symbol'}:${item.symbol || item.via_symbol || item.meaning || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildFocusSymbolPrerequisites(formula, dependency) {
  const variablePrerequisites = (dependency?.prerequisites || []).filter(shouldRenderVariablePrerequisite);
  const symbolPrerequisites = [...variablePrerequisites, ...buildFormulaSymbolPrerequisites(formula || undefined)].map((item) => ({
    ...item,
    kind: 'symbol',
  }));
  return dedupeFocusAnnotations([
    ...buildCompoundFocusAnnotations(formula),
    ...symbolPrerequisites,
  ]);
}

function addSeedFormulaNotes(cache, formulaLearningCopy, force) {
  const items = formulaLearningCopy?.items || {};
  for (const [formulaId, entry] of Object.entries(items)) {
    for (const language of DEFAULT_LANGUAGES) {
      if (!entry?.[language]) continue;
      const key = formulaNotesCacheKey(formulaId, language);
      if (!force && cache.entries[key]) continue;
      cache.entries[key] = entry[language];
    }
  }
}

function buildChapterOverviewFormulas(chapter, searchLookup) {
  const backboneIds = chapter.backbone_formula_ids || [];
  const representativeIds = chapter.representative_formula_ids || [];
  const fullIds = chapter.full_formula_ids || [];
  const formulaIds = [
    ...backboneIds,
    ...representativeIds.filter((id) => !backboneIds.includes(id)),
    ...fullIds.filter((id) => !backboneIds.includes(id) && !representativeIds.includes(id)).slice(0, 10),
  ];
  return formulaIds
    .map((id) => {
      const formula = searchLookup.get(id);
      if (!formula) return null;
      const role = backboneIds.includes(id) ? 'backbone' : representativeIds.includes(id) ? 'representative' : 'support';
      return {
        id: formula.id,
        label: formula.label,
        section: formula.section,
        latex_preview: formula.latex_preview,
        context: formula.context,
        role,
      };
    })
    .filter(Boolean);
}

function buildTasks({ cache, force, searchIndex, formulaLearningCopy, navigator, dependencyChapters, storylines }) {
  const searchLookup = new Map(searchIndex.map((item) => [item.id, item]));
  const chapterByFormula = new Map();
  const dependencyByFormula = new Map();
  for (const chapter of dependencyChapters) {
    for (const formula of chapter.formulas || []) chapterByFormula.set(formula.id, { chapter, formula });
    for (const dependency of chapter.dependencies || []) dependencyByFormula.set(dependency.dependent_id, dependency);
  }

  const tasks = [];
  for (const formula of searchIndex) {
    for (const language of DEFAULT_LANGUAGES) {
      const key = formulaNotesCacheKey(formula.id, language);
      if (!force && cache.entries[key]) continue;
      tasks.push({
        category: 'formula-notes',
        key,
        makeRequest: () =>
          buildFormulaNotesChatRequest({
            formulaId: formula.id,
            latex: formula.latex_preview,
            context: formula.context,
            section: formula.section,
            prerequisites: dependencyByFormula.get(formula.id)?.prerequisites || [],
            language,
          }),
        validate: (value) => validators.validateFormulaNotes(value, language),
      });
    }
  }

  for (const chapter of allNavigatorChapters(navigator)) {
    for (const language of DEFAULT_LANGUAGES) {
      const key = chapterOverviewCacheKey(chapter.chapter_id, language);
      if (!force && cache.entries[key]) continue;
      tasks.push({
        category: 'chapter-overviews',
        key,
        makeRequest: () =>
          buildChapterOverviewChatRequest({
            chapterId: chapter.chapter_id,
            chapterTitle: languageTitle(chapter, language) || formatChapterLabel(chapter.chapter_id, chapter.chapter, language),
            chapterDescription: languageDescription(chapter, language),
            formulas: buildChapterOverviewFormulas(chapter, searchLookup),
            language,
          }),
        validate: (value) => validators.validateChapterOverview(value, language),
      });
    }
  }

  for (const { formula } of chapterByFormula.values()) {
    const dependency = dependencyByFormula.get(formula.id) || null;
    const notes = buildFocusSymbolPrerequisites(formula, dependency);
    if (!notes.length) continue;
    for (const language of VARIABLE_LANGUAGES) {
      const symbols = notes.map((prereq) => ({
        symbol: prereq.symbol || prereq.via_symbol || 'symbol',
        kind: prereq.kind || 'symbol',
        prerequisite: prereq,
      }));
      const batchKey = variableDetailsBatchCacheKey(formula.id, language, symbols);
      if (force || !cache.entries[batchKey]) {
        tasks.push({
          category: 'variables',
          key: batchKey,
          makeRequest: () =>
            buildVariableDetailsBatchChatRequest({
              formulaId: formula.id,
              latex: formula.latex || '',
              context: formula.context_text || '',
              symbols,
              language,
            }),
          validate: validators.validateVariableDetailsBatch,
          afterStore: (value, targetCache) => {
            for (const item of value.items || []) {
              targetCache.entries[variableDetailsCacheKey(formula.id, item.symbol, language)] = {
                shortLabel: item.shortLabel,
                text: item.text,
              };
            }
          },
        });
      }
    }
  }

  for (const storyline of storylines.items || []) {
    for (const [index, selectedStep] of (storyline.steps || []).entries()) {
      for (const language of STORYLINE_LANGUAGES) {
        const key = storylineNarrativeCacheKey(storyline.id, selectedStep.formula_id, language);
        if (!force && cache.entries[key]) continue;
        const selectedSearch = searchLookup.get(selectedStep.formula_id);
        const chapterRecord = chapterByFormula.get(selectedStep.formula_id);
        const formula = chapterRecord?.formula;
        const formulaNote = cache.entries[formulaNotesCacheKey(selectedStep.formula_id, language)] || formulaLearningCopy?.items?.[selectedStep.formula_id]?.[language] || null;
        const formulaCopy = buildReadableFormulaCopy({
          formulaId: selectedStep.formula_id,
          language,
          cache: formulaLearningCopy?.items || {},
          context: selectedSearch?.context || formula?.context_text,
          latex: formula?.latex || selectedSearch?.latex_preview,
          chapterTitle: selectedSearch?.chapter_id ? formatChapterLabel(selectedSearch.chapter_id, selectedSearch.chapter, language) : selectedSearch?.section,
          formulaLabel: selectedSearch?.label || selectedStep.title,
          formulaNumber: selectedSearch?.number,
          section: selectedSearch?.section,
        });
        tasks.push({
          category: 'storylines',
          key,
          makeRequest: () =>
            buildStorylineNarrativeChatRequest({
              storyline,
              selectedStep,
              previousStep: index > 0 ? storyline.steps[index - 1] : null,
              nextStep: storyline.steps[index + 1] || null,
              formula: {
                id: selectedStep.formula_id,
                latex: formula?.latex || selectedSearch?.latex_preview || '',
                context: selectedSearch?.context || formula?.context_text || '',
                section: selectedSearch?.section || formula?.section,
                label: selectedSearch?.label || selectedStep.title,
              },
              formulaCopy: formulaNote || formulaCopy,
              language,
            }),
        validate: (value) => validators.validateStorylineNarrative(value, language),
      });
      }
    }
  }

  return tasks;
}

async function requestDeepSeek(chatRequest, apiKey, retries) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chatRequest),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`DeepSeek ${response.status}: ${text.slice(0, 240)}`);
      }
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('DeepSeek response missing message content.');
      return parseJsonObject(content);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        const waitMs = 1200 * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function parseJsonObject(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('DeepSeek response did not contain JSON.');
    try {
      return JSON.parse(match[0]);
    } catch {
      return JSON.parse(repairJsonStringEscapes(match[0]));
    }
  }
}

function repairJsonStringEscapes(value) {
  return value.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
}

async function runWithConcurrency(tasks, concurrency, worker) {
  let nextIndex = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (nextIndex < tasks.length) {
      const task = tasks[nextIndex];
      nextIndex += 1;
      await worker(task);
    }
  });
  await Promise.all(workers);
}

async function main() {
  loadEnvFile('.env.local');
  loadEnvFile('.env');
  const options = parseArgs(process.argv.slice(2));
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey && !options.dryRun) {
    throw new Error('DEEPSEEK_API_KEY is missing. Add it to .env.local or the shell environment.');
  }

  const cache = loadCache(options.output);
  const formulaLearningCopy = readJson(path.join(ROOT, 'public', 'data', 'formula_learning_copy.json'), { items: {} });
  addSeedFormulaNotes(cache, formulaLearningCopy, options.force);
  const searchIndex = readJson(path.join(ROOT, 'public', 'data', 'formula_search_index.json'), []);
  const navigator = readJson(path.join(ROOT, 'public', 'data', 'chapter_navigator.json'), { groups: [] });
  const storylines = readJson(path.join(ROOT, 'public', 'data', 'storylines.json'), { items: [] });
  const dependencyDir = path.join(ROOT, 'public', 'data', 'dependency');
  const dependencyChapters = fs
    .readdirSync(dependencyDir)
    .filter((file) => file.endsWith('_dependencies.json'))
    .map((file) => readJson(path.join(dependencyDir, file)))
    .filter(Boolean);
  const allTasks = buildTasks({ cache, force: options.force, searchIndex, formulaLearningCopy, navigator, dependencyChapters, storylines })
    .filter((task) => options.only.has(task.category));
  const tasks = Number.isFinite(options.limit) ? allTasks.slice(0, options.limit) : allTasks;
  const summary = tasks.reduce((acc, task) => {
    acc[task.category] = (acc[task.category] || 0) + 1;
    return acc;
  }, {});
  console.log(`LLM cache entries already present: ${Object.keys(cache.entries).length}`);
  console.log(`Pending tasks: ${tasks.length}`, summary);
  if (options.dryRun) return;

  let completed = 0;
  let failed = 0;
  const startedAt = Date.now();
  const flush = async () => {
    cache.generated_at = new Date().toISOString();
    await writeJsonWithRetry(options.output, cache);
    if (path.resolve(options.output) === path.resolve(DEFAULT_OUTPUT)) await writeJsonWithRetry(MIRROR_OUTPUT, cache);
  };

  await runWithConcurrency(tasks, options.concurrency, async (task) => {
    try {
      const value = task.validate(await requestDeepSeek(task.makeRequest(), apiKey, options.retries));
      cache.entries[task.key] = value;
      task.afterStore?.(value, cache);
      completed += 1;
      if (completed % 25 === 0) await flush();
      console.log(`[${completed}/${tasks.length}] ${task.category} ${task.key}`);
    } catch (error) {
      failed += 1;
      console.error(`[failed] ${task.category} ${task.key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  await flush();
  const minutes = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(`Done. completed=${completed}, failed=${failed}, minutes=${minutes}, entries=${Object.keys(cache.entries).length}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
