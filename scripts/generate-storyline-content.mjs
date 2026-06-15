/**
 * 通用故事线生成器（Book-Agnostic Storyline Generator）
 *
 * 零人工：把一本书的公式数据扔进去，LLM 自动发现故事线并生成叙事内容。
 *
 * ── 两种模式 ──────────────────────────────────────────
 *   DISCOVER:  node scripts/generate-storyline-content.mjs --discover
 *              LLM 扫描全书公式，自动发现跨章节的"故事线候选"，
 *              输出到 data/storyline_blueprints/<id>.json
 *
 *   GENERATE:  node scripts/generate-storyline-content.mjs
 *              node scripts/generate-storyline-content.mjs --id allele-frequency
 *              对已有 blueprint 生成完整叙事内容，合并到 storylines.json
 *
 *   DRY-RUN:   加 --dry-run 只输出 prompt 不调 LLM
 *
 * ── 完整自动流程（任意一本新书）────────────────────────
 *   1. OCR + 依赖图 pipeline → formula 数据就绪
 *   2. node scripts/generate-storyline-content.mjs --discover
 *      → LLM 分析全书，自动写 blueprint
 *   3. node scripts/generate-storyline-content.mjs
 *      → LLM 为每条 blueprint 写故事
 *   4. 前端渲染（无需改代码）
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BLUEPRINT_DIR = resolve(ROOT, 'data/storyline_blueprints');
const DEPENDENCY_DIR = resolve(ROOT, 'data/frontend/dependency');
const STORYLINES_PATH = resolve(ROOT, 'data/frontend/storylines.json');
const PUBLIC_STORYLINES_PATH = resolve(ROOT, 'public/data/storylines.json');
const LLM_ENDPOINT = process.env.LLM_ENDPOINT || 'http://127.0.0.1:5173/api/llm';
const LLM_MODEL = 'deepseek-chat';
const LLM_TIMEOUT_MS = 120000;  // discover mode needs more time

// ── helpers ──────────────────────────────────────────────────

async function readJson(p) { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } }
function fid(f) { return String(f?.label || f?.id || '').replace(/^formula[_\s-]*/i, '').trim(); }

async function loadAllFormulas() {
  const all = [];
  try {
    const files = (await readdir(DEPENDENCY_DIR)).filter((f) => f.endsWith('_dependencies.json'));
    for (const file of files.sort()) {
      const dep = await readJson(resolve(DEPENDENCY_DIR, file));
      for (const f of dep?.formulas || []) all.push(f);
    }
  } catch {}
  return all;
}

// ── LLM call ─────────────────────────────────────────────────

async function callLLM(systemPrompt, userPrompt) {
  const body = JSON.stringify({
    model: LLM_MODEL, temperature: 0.55,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(LLM_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctrl.signal });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const d = await res.json();
    const c = d?.choices?.[0]?.message?.content;
    if (!c) throw new Error('Empty LLM response');
    return JSON.parse(c);
  } finally { clearTimeout(t); }
}

// ══════════════════════════════════════════════════════════════
//  MODE 1: DISCOVER — LLM 扫描全书，自动发现故事线
// ══════════════════════════════════════════════════════════════

const DISCOVER_SYSTEM = `你是一位教材内容架构师。你的任务是从一本理工科教材的公式数据中，
自动发现有教学价值的"故事线"——跨章节、追踪一个核心量演化的公式序列。

一条好的故事线应该满足：
1. **符号贯穿性**：追踪同一个符号/量（如 p, w, N_e, z）在 3+ 个不同章节中的演化
2. **逻辑递进**：每站引入新的假设或工具，自然引出下一站
3. **叙事吸引力**：背后有可讲的历史故事或科学推理链

你需要基于公式数据的 section/subsection/context_text，推断学科领域和可能的叙事线索。
如果公式上下文明确提到了研究者名字（Hardy, Wright, Fisher 等），优先沿着这些历史线索组织故事线。

每本书建议发现 6-12 条故事线，覆盖不同的核心符号。
每条故事线 4-7 站（不要超过 7 站）。`;

function buildDiscoverPrompt(formulas) {
  // Compact representation: group by chapter, key info per formula
  const byChapter = new Map();
  for (const f of formulas) {
    const ch = f.chapter_id || 'unknown';
    if (!byChapter.has(ch)) byChapter.set(ch, []);
    byChapter.get(ch).push({
      id: f.id,
      latex: (f.latex || '').slice(0, 120),
      section: [f.section, f.subsection].filter(Boolean).join(' > ').slice(0, 100),
      context: (f.context_text || '').slice(0, 200),
    });
  }

  const chapterSummaries = [];
  for (const [ch, fs] of byChapter) {
    chapterSummaries.push({
      chapter: ch,
      formula_count: fs.length,
      samples: fs.slice(0, 15),  // First 15 formulas per chapter
    });
  }

  return JSON.stringify({
    task: 'discover_storylines',
    output_schema: {
      storylines: [
        {
          id: 'kebab-case-unique-id',
          symbol: '核心追踪符号（LaTeX 格式，如 p, N_e, \\mathbf{x}）',
          title_zh: '中文标题（有吸引力，像科普标题）',
          title_en: 'English title',
          intro_zh: '一句话介绍这条线的主题和跨度',
          intro_en: 'One-line English intro',
          backbone_zh: '简洁的逻辑链，如 A → B → C → D',
          backbone_en: 'English chain',
          entity_keys: ['相关的符号族，用于前端匹配'],
          formula_ids: ['formula_X.Y', ...],  // 4-7个，按章节递进排列
        },
      ],
    },
    rules: [
      '每条故事线的 formula_ids 必须按章节顺序递进（不能倒回前面的章）',
      '覆盖不同的核心符号，不要所有人都追踪同一个符号',
      '优先选择在 3+ 个不同章节中出现的符号',
      '总数建议 6-12 条',
    ],
    book: {
      total_formulas: formulas.length,
      chapter_count: byChapter.size,
      chapters: chapterSummaries,
    },
  }, null, 2);
}

// ══════════════════════════════════════════════════════════════
//  MODE 2: GENERATE — 对 blueprint 生成完整叙事
// ══════════════════════════════════════════════════════════════

const GENERATE_SYSTEM = `你是一位科学作家，负责为理工科教材编写"故事线"学习内容。
读者是本科生和自学者——对这个领域有兴趣但不一定有深厚数学背景。

每条"故事线"追踪一个核心符号在教材各章中的演化轨迹。
它不是公式罗列，而是一个连贯的科学发现故事。

对每一站，你需要写：
1. **display_name_zh**：站名，6-14字，像科普杂志标题一样抓人
2. **story_zh**：历史叙事，200-350字。回答三个问题——
   这个公式在什么背景下被引入？解决了什么问题？揭示了什么意外或深刻的结论？
   需要数学直觉（不需要推导）和历史场景感。
3. **bridge_zh**：过渡钩子，1-2句。前几站是"上一站→下一站"的悬念过渡，
   最后一站是全旅程的回顾总结。

写作风格：
- 流畅生动，像《科学美国人》而不是教科书
- 从 section/subsection/context_text 中推断学科背景，不要编造你无法确认的历史细节
- 如果上下文明确提到了人名，自然融入；否则用"研究者们发现……"等表述

只返回 JSON，不要 Markdown。`;

function buildGeneratePrompt(blueprint, formulas) {
  const steps = formulas.map((f, i) => ({
    index: i + 1,
    formula_id: f.id,
    latex: f.latex || '',
    section: [f.section, f.subsection].filter(Boolean).join(' > '),
    context: (f.context_text || '').slice(0, 600),
  }));

  return JSON.stringify({
    task: 'generate_storyline_content',
    output_schema: {
      display_names_zh: `Array of ${formulas.length} strings — 站名`,
      stories_zh: `Array of ${formulas.length} strings — 叙事（200-350字）`,
      bridges_zh: `Array of ${formulas.length} strings — 过渡钩子`,
    },
    storyline: {
      id: blueprint.id,
      symbol: blueprint.symbol,
      title_zh: blueprint.title_zh,
      intro_zh: blueprint.intro_zh,
      backbone_zh: blueprint.backbone_zh || '',
    },
    steps,
  }, null, 2);
}

// ── validation ───────────────────────────────────────────────

const BAD = [/这个公式很重要/, /承上启下/, /符号.*外形/, /承担了?新的?任务/, /值得.*学习/, /为后续.*铺垫/];

function validateResult(payload, n) {
  const { display_names_zh, stories_zh, bridges_zh } = payload || {};
  if (!Array.isArray(display_names_zh) || display_names_zh.length !== n) throw new Error(`display_names_zh: expected ${n}`);
  if (!Array.isArray(stories_zh) || stories_zh.length !== n) throw new Error(`stories_zh: expected ${n}`);
  if (!Array.isArray(bridges_zh) || bridges_zh.length !== n) throw new Error(`bridges_zh: expected ${n}`);
  for (let i = 0; i < n; i++) {
    if (!stories_zh[i] || stories_zh[i].length < 80) console.warn(`  ⚠ Step ${i + 1} story_zh short`);
    if (!bridges_zh[i] || bridges_zh[i].length < 15) console.warn(`  ⚠ Step ${i + 1} bridge_zh short`);
    for (const p of BAD) if (p.test(stories_zh[i] || '') || p.test(bridges_zh[i] || '')) console.warn(`  ⚠ Step ${i + 1}: template phrase`);
  }
  return true;
}

// ── merge ────────────────────────────────────────────────────

function mergeIntoStorylines(existing, blueprint, formulas, result) {
  const { display_names_zh, stories_zh, bridges_zh } = result;
  const steps = formulas.map((f, i) => ({
    formula_id: f.id, title: f.label || f.id,
    display_name_zh: display_names_zh[i], display_name_en: '',
    transition_en: '', transition_zh: '',
    story_zh: stories_zh[i], story_en: '',
    bridge_zh: bridges_zh[i], bridge_en: '',
    support_formula_ids: i > 0 ? [formulas[i - 1].id] : [],
  }));
  const entry = {
    id: blueprint.id, symbol: blueprint.symbol,
    title_en: blueprint.title_en || '', title_zh: blueprint.title_zh,
    intro_en: blueprint.intro_en || '', intro_zh: blueprint.intro_zh,
    backbone_en: blueprint.backbone_en || '', backbone_zh: blueprint.backbone_zh || '',
    entity_keys: blueprint.entity_keys || [],
    steps,
  };
  const items = existing.items || [];
  const idx = items.findIndex((it) => it.id === blueprint.id);
  if (idx >= 0) { items[idx] = entry; console.log(`  Updated: ${blueprint.id}`); }
  else { items.push(entry); console.log(`  Added: ${blueprint.id}`); }
  return { version: existing.version || 2, items };
}

// ══════════════════════════════════════════════════════════════
//  main
// ══════════════════════════════════════════════════════════════

async function main() {
  const { values } = parseArgs({
    options: {
      discover: { type: 'boolean', default: false },
      id: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  await mkdir(BLUEPRINT_DIR, { recursive: true });

  // ═══ DISCOVER MODE ═══
  if (values.discover) {
    console.log('Discover mode: LLM will scan all formulas and propose storylines.\n');
    const formulas = await loadAllFormulas();
    if (!formulas.length) { console.error('No formula data found.'); process.exit(1); }
    console.log(`Loaded ${formulas.length} formulas from ${new Set(formulas.map((f) => f.chapter_id)).size} chapters.`);

    if (values['dry-run']) {
      const prompt = { system: DISCOVER_SYSTEM, user: JSON.parse(buildDiscoverPrompt(formulas)) };
      await writeFile(resolve(ROOT, 'tmp/storyline_discover_prompt.json'), JSON.stringify(prompt, null, 2), 'utf8');
      console.log('Dry-run: prompt written to tmp/storyline_discover_prompt.json');
      return;
    }

    console.log(`Calling LLM (${LLM_MODEL}) to discover storylines...`);
    const result = await callLLM(DISCOVER_SYSTEM, buildDiscoverPrompt(formulas));
    if (!result.storylines?.length) { console.error('LLM returned no storylines.'); process.exit(1); }

    console.log(`\nDiscovered ${result.storylines.length} storyline(s):`);
    let written = 0;
    for (const sl of result.storylines) {
      if (!sl.id || !sl.formula_ids?.length) continue;
      const path = resolve(BLUEPRINT_DIR, `${sl.id}.json`);
      await writeFile(path, JSON.stringify(sl, null, 2), 'utf8');
      console.log(`  ${sl.id}: ${sl.symbol} — "${sl.title_zh}" (${sl.formula_ids.length} steps)`);
      written++;
    }
    console.log(`\nWrote ${written} blueprints to ${BLUEPRINT_DIR}/`);
    console.log('Next: node scripts/generate-storyline-content.mjs');
    return;
  }

  // ═══ GENERATE MODE ═══
  const [storylinesData, formulaMap] = await Promise.all([
    readJson(STORYLINES_PATH).then((d) => d || { version: 2, items: [] }),
    loadAllFormulas().then((fs) => new Map(fs.map((f) => [f.id, f]))),
  ]);

  // Load blueprints
  let blueprints = [];
  try {
    const files = (await readdir(BLUEPRINT_DIR)).filter((f) => f.endsWith('.json'));
    blueprints = (await Promise.all(files.map((f) => readJson(resolve(BLUEPRINT_DIR, f))))).filter(Boolean);
  } catch {}

  if (values.id) {
    blueprints = blueprints.filter((b) => b.id === values.id);
    if (!blueprints.length) {
      const bp = await readJson(resolve(BLUEPRINT_DIR, `${values.id}.json`));
      if (bp) blueprints = [bp];
    }
    if (!blueprints.length) { console.error(`Blueprint not found: ${values.id}`); process.exit(1); }
  }

  if (!blueprints.length) {
    console.log('No blueprints found. Run with --discover first to auto-generate blueprints.');
    return;
  }

  console.log(`Generate mode: ${blueprints.length} storyline(s)\n`);

  let updated = storylinesData;
  for (const bp of blueprints) {
    const formulas = (bp.formula_ids || []).map((fid) => formulaMap.get(fid) || { id: fid, latex: '', label: fid });
    if (formulas.length < 3) { console.warn(`  Skip ${bp.id}: need >= 3, got ${formulas.length}`); continue; }
    console.log(`  ${bp.id}: ${formulas.map(fid).join(' → ')}`);

    if (values['dry-run']) {
      const prompt = { system: GENERATE_SYSTEM, user: JSON.parse(buildGeneratePrompt(bp, formulas)) };
      await writeFile(resolve(ROOT, 'tmp', `storyline_prompt_${bp.id}.json`), JSON.stringify(prompt, null, 2), 'utf8');
      console.log(`  Dry-run → tmp/storyline_prompt_${bp.id}.json`);
      continue;
    }

    console.log(`  Calling LLM...`);
    try {
      const result = await callLLM(GENERATE_SYSTEM, buildGeneratePrompt(bp, formulas));
      validateResult(result, formulas.length);
      updated = mergeIntoStorylines(updated, bp, formulas, result);
      console.log(`  ✓ Done\n`);
    } catch (err) { console.error(`  ✗ Failed: ${err.message}\n`); }
  }

  const json = JSON.stringify(updated, null, 2) + '\n';
  await writeFile(STORYLINES_PATH, json, 'utf8');
  await writeFile(PUBLIC_STORYLINES_PATH, json, 'utf8');
  console.log(`Written: ${STORYLINES_PATH}`);
  console.log(`Synced:  ${PUBLIC_STORYLINES_PATH}`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
