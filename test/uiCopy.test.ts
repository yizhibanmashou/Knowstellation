import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_LANGUAGE,
  formatChapterDescription,
  formatChapterLabel,
  formatChapterTitle,
  formatSectionLabel,
  getUiCopy,
  joinMeta,
} from '../src/shared/utils/uiCopy.ts';
import fs from 'node:fs';

test('ui copy defaults to Chinese learner-facing labels', () => {
  const copy = getUiCopy(DEFAULT_LANGUAGE);

  assert.equal(copy.app.searchPlaceholder, '搜索公式、章节或主题');
  assert.equal(copy.graph.home, 'Home');
  assert.equal(copy.graph.modes.guided.label, 'Guided');
  assert.equal(copy.chapter.entryPoints, '章节入口');
  assert.equal(copy.storyline.localNarrative, '正在使用本地叙事');
});

test('formatChapterLabel localizes chapter and appendix ids', () => {
  assert.equal(formatChapterLabel('chapter2'), '第 2 章');
  assert.equal(formatChapterLabel('appendix3'), '附录 3');
  assert.equal(formatChapterLabel('chapter2', 2, 'en'), 'Chapter 2');
});

test('formatChapterTitle replaces generated navigator placeholders with localized labels', () => {
  assert.equal(formatChapterTitle({ chapterId: 'chapter10', chapter: 10, titleZh: 'Chapter 10 公式导航' }), '第 10 章');
  assert.equal(formatChapterTitle({ chapterId: 'appendix3', titleEn: 'Appendix 3 Formula Navigator' }), '附录 3');
  assert.equal(formatChapterTitle({ chapterId: 'chapter8', titleZh: '分子进化中的连锁位点' }), '分子进化中的连锁位点');
});

test('joinMeta removes empty values and uses dot separators', () => {
  assert.equal(joinMeta(['2.1', '', undefined, '第 2 章']), '2.1 · 第 2 章');
});

test('formatSectionLabel shortens common textbook section names for Chinese UI', () => {
  assert.equal(formatSectionLabel('Neutral Evolution in One- and Two-Locus Systems: Introduction'), '中性演化导论');
  assert.equal(formatSectionLabel('THE WRIGHT-FISHER MODEL'), 'Wright-Fisher 模型');
  assert.equal(formatSectionLabel('BRIEF OVERVIEW OF DIVERGENCE-BASED TESTS'), '基于分化检验概览');
  assert.equal(formatSectionLabel('Short-term Changes in the Mean: 3. Permanent Versus Transient Response: Introduction'), '永久响应与暂态响应');
  assert.equal(formatSectionLabel('A very long English section title that should not dominate compact formula cards'), 'A very long English section title...');
});

test('formatChapterDescription rewrites generated chapter guidance around concepts and formulas', () => {
  assert.equal(
    formatChapterDescription({
      chapterId: 'chapter10',
      chapter: 10,
      descriptionZh: 'Chapter 10 包含 67 个公式。建议先看高亮起始公式，再逐步展开章内依赖图谱。',
      formulaCount: 67,
      sectionHint: 'BRIEF OVERVIEW OF DIVERGENCE-BASED TESTS',
    }),
    '本章主要围绕「基于分化检验概览」展开，包含 67 个公式。建议先浏览概念路径，再进入公式入口展开依赖图谱。',
  );
  assert.equal(
    formatChapterDescription({
      chapterId: 'chapter15',
      chapter: 15,
      descriptionZh: 'Chapter 15 包含 76 个公式。建议先看高亮起始公式，再逐步展开章内依赖图谱。',
      formulaCount: 76,
      sectionHint: 'Short-term Changes in the Mean',
    }),
    '本章主要围绕「性状均值的短期变化」展开，包含 76 个公式。建议先浏览概念路径，再进入公式入口展开依赖图谱。',
  );
});

test('all chapter section hints localize to non-English topics', () => {
  const nav = JSON.parse(fs.readFileSync('data/frontend/chapter_navigator.json', 'utf8'));
  for (const group of nav.groups || []) {
    for (const chapter of group.chapters || []) {
      const topic = formatSectionLabel(chapter.section_hint, 'zh');
      const description = formatChapterDescription({
        chapterId: chapter.chapter_id,
        chapter: chapter.chapter,
        descriptionZh: chapter.description_zh,
        descriptionEn: chapter.description_en,
        formulaCount: chapter.full_formula_ids.length,
        sectionHint: chapter.section_hint,
        language: 'zh',
      });
      assert.match(topic, /[^\x00-\x7F]/, `${chapter.chapter_id} still looks English: ${topic}`);
      assert.ok(!description.includes(chapter.section_hint.split(':')[0].trim()), `${chapter.chapter_id} description leaked raw topic: ${description}`);
    }
  }
});
