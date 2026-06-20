/**
 * 批量生成公式 "一眼看懂" takeaway（两句中文：算什么 + 为什么重要）
 * 调用 DeepSeek API，写入 public/data/takeaway_cache.json
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SEARCH_INDEX = resolve(ROOT, 'data/frontend/formula_search_index.json');
const DEP_DIR = resolve(ROOT, 'data/frontend/dependency');
const CACHE_PATH = resolve(ROOT, 'public/data/takeaway_cache.json');
const MIRROR_PATH = resolve(ROOT, 'data/frontend/takeaway_cache.json');

const API_URL = 'https://api.deepseek.com/chat/completions';
const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const MODEL = 'deepseek-chat';
const CONCURRENCY = 3;
const TIMEOUT_MS = 30000;

// ── Prompt ──────────────────────────────────────────────────
const SYSTEM = `你是一名严谨的理工科教材助教。你需要为每个公式写两句中文解释（50-100字），格式为：

第一句：这条公式在算什么（描述数学对象、输入输出、核心关系）
第二句：它为什么重要——历史背景、理论意义、或它连接了什么

写作要求：
- 不用"先别被……吓住""这条公式很重要""Formula X.Y 要回答的是"这类空话
- 直接、具体、像给同行解释一样平等地说话
- 从章节名和上下文推断学科背景，不确定的历史细节不编造
- 专有名词保留英文（如 Wright-Fisher、Kimura、Price 方程）

返回 JSON：{"takeaway": "两句解释"}`;

function buildPrompt(f) {
  return JSON.stringify({
    task: 'formula_takeaway',
    formula: {
      id: f.id,
      latex: (f.latex || f.latex_preview || '').slice(0, 200),
      section: f.section || '',
      chapter: f.chapter_id || `chapter${f.chapter || ''}`,
      context: (f.context || '').slice(0, 400),
    },
    output_schema: { takeaway: '两句中文解释（50-100字）' },
  });
}

// ── API ─────────────────────────────────────────────────────
async function callLLM(prompt) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL, temperature: 0.35,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: prompt },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    const c = d?.choices?.[0]?.message?.content;
    const parsed = JSON.parse(c);
    return parsed.takeaway || '';
  } catch (err) {
    throw err;
  } finally { clearTimeout(t); }
}

// ── Batch ───────────────────────────────────────────────────
async function run(limit = Infinity, offset = 0) {
  if (!API_KEY) { console.error('DEEPSEEK_API_KEY not set'); process.exit(1); }

  // Load existing cache
  let cache = {};
  try { cache = JSON.parse(await readFile(CACHE_PATH, 'utf8')); } catch {}
  const startCount = Object.keys(cache).length;

  // Load formulas from search index
  const index = JSON.parse(await readFile(SEARCH_INDEX, 'utf8'));
  const formulas = index.slice(offset, offset + limit);
  console.log(`Total: ${index.length}, processing ${formulas.length} (offset ${offset})`);
  console.log(`Existing cache: ${startCount} entries\n`);

  // Process in batches
  let done = 0;
  const todo = formulas.filter(f => !cache[f.id]);

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (f) => {
        const prompt = buildPrompt(f);
        const takeaway = await callLLM(prompt);
        return { id: f.id, takeaway };
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        cache[r.value.id] = r.value.takeaway;
        done++;
      } else {
        console.error(`  ✗ ${r.reason?.message?.slice(0, 80)}`);
      }
    }

    if (i % 30 === 0 && done > 0) {
      process.stdout.write(`\r  ${done}/${todo.length} (${Math.round(done/todo.length*100)}%)`);
    }
  }

  console.log(`\r  ${done}/${todo.length} done`);

  // Write
  const json = JSON.stringify(cache, null, 2);
  await mkdir(resolve(ROOT, 'public/data'), { recursive: true });
  await writeFile(CACHE_PATH, json, 'utf8');
  await mkdir(resolve(ROOT, 'data/frontend'), { recursive: true });
  await writeFile(MIRROR_PATH, json, 'utf8');
  console.log(`\nWritten: ${CACHE_PATH} (${Object.keys(cache).length} entries)`);
}

const args = process.argv.slice(2);
const limit = args[0] ? parseInt(args[0]) : Infinity;
const offset = args[1] ? parseInt(args[1]) : 0;
run(limit, offset).catch(err => { console.error(err); process.exitCode = 1; });
