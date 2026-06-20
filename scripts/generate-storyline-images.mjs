/**
 * 故事线配图生成器 — 使用 Gemini 2.0 Flash Image Generation
 *
 * 对每条故事线的每个 step，从 story_zh 提取视觉场景，
 * 调用 Gemini 生成科学插画，原图存入 data/storyline-image-sources/，
 * 随后生成 public/images/storylines/ 的 WebP 发布图，
 * 更新 storylines.json 的 step.image / step.image_caption。
 *
 * 用法：
 *   node scripts/generate-storyline-images.mjs                    # 全部 step
 *   node scripts/generate-storyline-images.mjs --id allele-frequency  # 单条
 *   node scripts/generate-storyline-images.mjs --id allele-frequency --step 0  # 单站
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { optimizeStorylineImages, STORYLINE_IMAGE_SOURCE_DIR } from './optimize-storyline-images.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const STORYLINES_PATH = resolve(ROOT, 'data/frontend/storylines.json');
const PUBLIC_STORYLINES_PATH = resolve(ROOT, 'public/data/storylines.json');
const IMAGE_DIR = STORYLINE_IMAGE_SOURCE_DIR;

// Read config from .env.local
async function getConfig() {
  const cfg = { apiKey: '', baseUrl: '', model: 'gemini-3.1-flash-image' };
  try {
    const envPath = resolve(ROOT, '.env.local');
    const env = await readFile(envPath, 'utf8');
    const apiMatch = env.match(/GEMINI_API_KEY=(.+)/);
    const urlMatch = env.match(/GOOGLE_GEMINI_BASE_URL=(.+)/);
    const modelMatch = env.match(/GEMINI_MODEL=(.+)/);
    if (apiMatch) cfg.apiKey = apiMatch[1].trim();
    if (urlMatch) cfg.baseUrl = urlMatch[1].trim();
    if (modelMatch) cfg.model = modelMatch[1].trim();
  } catch {}
  if (!cfg.apiKey || cfg.apiKey.includes('你的')) {
    console.error('GEMINI_API_KEY not set in .env.local.');
    process.exit(1);
  }
  return cfg;
}

// ── Prompt builder: story_zh → visual scene ──────────────────

function buildImagePrompt(step, storyline) {
  const story = step.story_zh || step.transition_zh || '';
  // Extract first 2-3 sentences as the core visual scene
  const sentences = story.split(/[。！？\n]/).filter(s => s.trim().length > 10);
  const coreScene = sentences.slice(0, Math.min(3, sentences.length)).join('。');

  return [
    'You are a scientific illustrator creating a beautiful, modern illustration for a STEM learning platform.',
    'Style: Clean vector illustration with warm, inviting colors. Modern editorial design.',
    'Think "Science magazine feature opener" — visually striking, conceptually clear, emotionally engaging.',
    'NO text, NO labels, NO equations. Pure visual storytelling.',
    '',
    `The illustration should capture this scene from the history of science:`,
    `"${coreScene}"`,
    '',
    `Context: The storyline tracks the symbol "${storyline.symbol}" — "${storyline.title_zh}".`,
    `This step is: "${step.display_name_zh || ''}".`,
    '',
    'Key visual requirements:',
    '- Show the SCIENTIFIC CONCEPT as a visual metaphor (not abstract shapes)',
    '- Include subtle period-appropriate visual cues (lab equipment, notebooks, natural specimens)',
    '- Color palette: deep blue + warm gold + soft cream background',
    '- Aspect ratio: 3:2 landscape, suitable for a content card',
  ].join('\n');
}

// ── Gemini API call ──────────────────────────────────────────

async function generateImage(prompt, cfg) {
  const model = cfg.model;
  const useKeyParam = !cfg.baseUrl || cfg.baseUrl.includes('googleapis');
  const url = `${cfg.baseUrl || 'https://generativelanguage.googleapis.com'}/v1beta/models/${model}:generateContent`;

  const body = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT'],
      imageConfig: {
        aspectRatio: '3:2',
      },
    },
  };

  const headers = { 'Content-Type': 'application/json' };
  const finalUrl = useKeyParam ? `${url}?key=${cfg.apiKey}` : url;
  if (!useKeyParam) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

  const res = await fetch(finalUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  // Extract image from response
  for (const part of data?.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData?.data) {
      return {
        mimeType: part.inlineData.mimeType || 'image/png',
        data: part.inlineData.data,
      };
    }
  }
  // If no inline image, return text for debugging
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n');
  throw new Error(`No image in response. Text: ${(text || '').slice(0, 200)}`);
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    options: {
      id: { type: 'string' },
      step: { type: 'string' },
    },
  });

  const cfg = await getConfig();
  console.log(`Model: ${cfg.model}`);
  console.log(`Base: ${cfg.baseUrl || 'Google direct'}\n`);
  await mkdir(IMAGE_DIR, { recursive: true });

  const data = JSON.parse(await readFile(STORYLINES_PATH, 'utf8'));
  let generated = 0;

  for (const storyline of data.items || []) {
    if (values.id && storyline.id !== values.id) continue;

    console.log(`\n${storyline.id} (${storyline.symbol}):`);

    for (let i = 0; i < (storyline.steps || []).length; i++) {
      const step = storyline.steps[i];
      if (values.step !== undefined && String(i) !== values.step) continue;

      const name = step.display_name_zh || step.title || `Step ${i + 1}`;
      const prompt = buildImagePrompt(step, storyline);

      // Skip if already has image
      if (step.image && !values.step) {
        console.log(`  [${i + 1}] ${name} — already has image, skip`);
        continue;
      }

      console.log(`  [${i + 1}] ${name} — generating...`);
      try {
        const result = await generateImage(prompt, cfg);
        const ext = result.mimeType.includes('jpeg') ? 'jpg' : 'png';
        const filename = `${storyline.id}_step${i + 1}.${ext}`;
        const filepath = resolve(IMAGE_DIR, filename);
        await writeFile(filepath, Buffer.from(result.data, 'base64'));

        step.image = `/images/storylines/${filename}`;
        step.image_caption = step.display_name_zh || name;
        console.log(`    ✓ ${filename}`);
        generated++;
      } catch (err) {
        console.error(`    ✗ ${err.message}`);
      }
    }
  }

  const json = JSON.stringify(data, null, 2) + '\n';
  await writeFile(STORYLINES_PATH, json, 'utf8');
  await writeFile(PUBLIC_STORYLINES_PATH, json, 'utf8');
  if (generated > 0) {
    const optimized = await optimizeStorylineImages();
    console.log(`Optimized storyline images: ${(optimized.sourceBytes / 1024 / 1024).toFixed(2)} MB -> ${(optimized.outputBytes / 1024 / 1024).toFixed(2)} MB.`);
  }
  console.log(`\nDone. ${generated} images generated.`);
  if (generated === 0 && !values.step) {
    console.log('All steps already have images. Use --step N to regenerate a specific one.');
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
