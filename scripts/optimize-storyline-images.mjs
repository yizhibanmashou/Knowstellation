import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, parse, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const STORYLINES_PATH = resolve(ROOT, 'data/frontend/storylines.json');
const PUBLIC_STORYLINES_PATH = resolve(ROOT, 'public/data/storylines.json');

export const STORYLINE_IMAGE_SOURCE_DIR = resolve(ROOT, 'data/storyline-image-sources');
export const STORYLINE_IMAGE_OUTPUT_DIR = resolve(ROOT, 'public/images/storylines');

const PUBLIC_IMAGE_PREFIX = '/images/storylines/';
const DEFAULT_MAX_WIDTH = 1280;
const DEFAULT_QUALITY = 72;
const DEFAULT_EFFORT = 5;
const SOURCE_EXTENSION_ORDER = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isWithin(parent, child) {
  const normalizedParent = resolve(parent);
  const normalizedChild = resolve(child);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}\\`) || normalizedChild.startsWith(`${normalizedParent}/`);
}

function assertSafePaths({ sourceDir, outputDir }) {
  if (!isWithin(ROOT, sourceDir) || !isWithin(ROOT, outputDir)) {
    throw new Error('Storyline image paths must stay inside the project root.');
  }
  if (resolve(sourceDir) === resolve(outputDir)) {
    throw new Error('Source and output directories must be different.');
  }
  if (!isWithin(resolve(ROOT, 'public'), outputDir)) {
    throw new Error('Output directory must stay inside public/.');
  }
}

function collectImageRefs(storylines) {
  const refs = new Map();
  for (const storyline of storylines.items || []) {
    for (const step of storyline.steps || []) {
      if (!step.image) continue;
      const imageName = basename(step.image);
      const baseName = parse(imageName).name;
      const outputName = `${baseName}.webp`;
      refs.set(baseName, {
        baseName,
        originalName: imageName,
        outputName,
        publicPath: `${PUBLIC_IMAGE_PREFIX}${outputName}`,
      });
      step.image = `${PUBLIC_IMAGE_PREFIX}${outputName}`;
    }
  }
  return [...refs.values()];
}

async function buildSourceLookup(sourceDir) {
  let entries = [];
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return new Map();
  }
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  return new Map(files.map((name) => [name.toLowerCase(), name]));
}

function resolveSourceFile(ref, sourceDir, sourceLookup) {
  const currentExt = extname(ref.originalName);
  const candidates = unique([
    ref.originalName,
    ...SOURCE_EXTENSION_ORDER.map((extension) => `${ref.baseName}${extension}`),
    currentExt ? null : `${ref.baseName}.jpg`,
  ]);

  for (const candidate of candidates) {
    const matchedName = sourceLookup.get(candidate.toLowerCase());
    if (matchedName) return resolve(sourceDir, matchedName);
  }

  throw new Error(`Missing source image for ${ref.originalName} in ${sourceDir}`);
}

async function bytes(path) {
  return (await stat(path)).size;
}

async function existingOutputBytes(refs, outputDir) {
  let total = 0;
  const missing = [];
  for (const ref of refs) {
    const outputPath = resolve(outputDir, ref.outputName);
    try {
      total += await bytes(outputPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      missing.push(ref.outputName);
    }
  }
  return { total, missing };
}

async function writeStorylineJson(storylines) {
  const json = `${JSON.stringify(storylines, null, 2)}\n`;
  await writeFile(STORYLINES_PATH, json, 'utf8');
  await writeFile(PUBLIC_STORYLINES_PATH, json, 'utf8');
}

export async function optimizeStorylineImages(options = {}) {
  const sourceDir = resolve(options.sourceDir || STORYLINE_IMAGE_SOURCE_DIR);
  const outputDir = resolve(options.outputDir || STORYLINE_IMAGE_OUTPUT_DIR);
  const maxWidth = Number(options.maxWidth || DEFAULT_MAX_WIDTH);
  const quality = Number(options.quality || DEFAULT_QUALITY);
  const effort = Number(options.effort || DEFAULT_EFFORT);
  const updateJson = options.updateJson !== false;

  assertSafePaths({ sourceDir, outputDir });

  const storylines = JSON.parse(await readFile(STORYLINES_PATH, 'utf8'));
  const refs = collectImageRefs(storylines);
  if (refs.length === 0) {
    throw new Error('No storyline image references found.');
  }

  const sourceLookup = await buildSourceLookup(sourceDir);
  if (sourceLookup.size === 0) {
    const existing = await existingOutputBytes(refs, outputDir);
    if (existing.missing.length) {
      throw new Error(`No source images found in ${sourceDir}, and missing optimized outputs: ${existing.missing.join(', ')}`);
    }
    if (updateJson) await writeStorylineJson(storylines);
    console.log(`No source images found in ${sourceDir}; keeping ${refs.length} existing optimized storyline images.`);
    return {
      count: 0,
      sourceBytes: 0,
      outputBytes: existing.total,
      sourceDir,
      outputDir,
      skipped: true,
    };
  }

  const jobs = refs.map((ref) => ({
    ...ref,
    sourcePath: resolveSourceFile(ref, sourceDir, sourceLookup),
    outputPath: resolve(outputDir, ref.outputName),
  }));

  if (updateJson) await writeStorylineJson(storylines);

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  let sourceBytes = 0;
  let outputBytes = 0;

  for (const job of jobs) {
    const inputBytes = await bytes(job.sourcePath);
    sourceBytes += inputBytes;
    await sharp(job.sourcePath)
      .rotate()
      .resize({ width: maxWidth, withoutEnlargement: true })
      .webp({ quality, effort })
      .toFile(job.outputPath);
    const resultBytes = await bytes(job.outputPath);
    outputBytes += resultBytes;
    const saved = inputBytes ? Math.round((1 - resultBytes / inputBytes) * 100) : 0;
    console.log(`${job.outputName}: ${(inputBytes / 1024).toFixed(0)} KB -> ${(resultBytes / 1024).toFixed(0)} KB (${saved}% saved)`);
  }

  return {
    count: jobs.length,
    sourceBytes,
    outputBytes,
    sourceDir,
    outputDir,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      'source-dir': { type: 'string' },
      'output-dir': { type: 'string' },
      width: { type: 'string' },
      quality: { type: 'string' },
      effort: { type: 'string' },
      'no-json': { type: 'boolean', default: false },
    },
  });

  const result = await optimizeStorylineImages({
    sourceDir: values['source-dir'],
    outputDir: values['output-dir'],
    maxWidth: values.width,
    quality: values.quality,
    effort: values.effort,
    updateJson: !values['no-json'],
  });

  console.log(
    `Optimized ${result.count} storyline images: ${(result.sourceBytes / 1024 / 1024).toFixed(2)} MB -> ${(result.outputBytes / 1024 / 1024).toFixed(2)} MB.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
