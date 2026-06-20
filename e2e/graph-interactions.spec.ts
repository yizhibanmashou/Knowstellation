import { expect, test, type Page } from '@playwright/test';

async function findInteractiveStarPoint(page: Page) {
  const canvas = page.locator('.starfield-root canvas').first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Starfield canvas has no bounding box');
  const points = [
    { x: box.x + box.width * 0.5, y: box.y + box.height * 0.48 },
    { x: box.x + box.width * 0.43, y: box.y + box.height * 0.42 },
    { x: box.x + box.width * 0.58, y: box.y + box.height * 0.38 },
    { x: box.x + box.width * 0.47, y: box.y + box.height * 0.58 },
    { x: box.x + box.width * 0.62, y: box.y + box.height * 0.55 },
    { x: box.x + box.width * 0.36, y: box.y + box.height * 0.52 },
    { x: box.x + box.width * 0.68, y: box.y + box.height * 0.46 },
  ];

  for (const point of points) {
    await page.mouse.move(point.x, point.y);
    if (await page.locator('.star-node-hover-tooltip').isVisible({ timeout: 700 }).catch(() => false)) return point;
  }
  throw new Error('No interactive star point found');
}

test('minimap click selects the matching chapter formula node', async ({ page }) => {
  await page.goto('/graph/chapter/chapter11?mode=formula', { waitUntil: 'domcontentloaded' });

  const atlasNodes = page.getByTestId('graph-atlas-node');
  await expect(atlasNodes.first()).toBeVisible();

  const target = page.getByTestId('graph-atlas-node').and(page.locator('[data-formula-id="formula_11.2"]'));
  await expect(target).toBeVisible();
  await target.click();

  await expect(page).toHaveURL(/selected=formula_11\.2/);
  await expect(target).toHaveClass(/graph-atlas-map__node--active/);
  await expect(page.getByTestId('formula-node').and(page.locator('[data-formula-id="formula_11.2"]'))).toHaveClass(/selected/);
});

test('guided formula hover shows a symbol explanation callout', async ({ page }) => {
  await page.goto('/graph/formula_11.7b?chapterId=chapter11&mode=formula', { waitUntil: 'domcontentloaded' });

  const annotation = page.locator('[data-note][data-symbol]').first();
  await expect(annotation).toBeVisible();
  const note = await annotation.getAttribute('data-note');

  await annotation.hover();

  const callout = page.locator('.formula-node__callout');
  await expect(callout).toBeVisible();
  await expect(callout).toContainText(note || '');
});

test('formula symbol callout does not cover the original formula', async ({ page }) => {
  await page.goto('/graph/formula_9.26d?chapterId=chapter9&mode=formula', { waitUntil: 'domcontentloaded' });

  const annotation = page.locator('[data-note][data-symbol]').first();
  await expect(annotation).toBeVisible();
  await annotation.hover();
  await expect(page.locator('.formula-node__callout')).toBeVisible();

  const overlapArea = await page.evaluate(() => {
    const callout = document.querySelector('.formula-node__callout')?.getBoundingClientRect();
    const formula = document.querySelector('.formula-node__math .katex')?.getBoundingClientRect();
    if (!callout || !formula) return Number.POSITIVE_INFINITY;
    const xOverlap = Math.max(0, Math.min(callout.right, formula.right) - Math.max(callout.left, formula.left));
    const yOverlap = Math.max(0, Math.min(callout.bottom, formula.bottom) - Math.max(callout.top, formula.top));
    return xOverlap * yOverlap;
  });
  expect(overlapArea).toBe(0);
});

test('formula 9.34a renders haplotype diversity without prose definition in math', async ({ page }) => {
  await page.goto('/graph/formula_9.34a?chapterId=chapter9&mode=formula', { waitUntil: 'domcontentloaded' });

  const formulaNode = page.getByTestId('formula-node').and(page.locator('[data-formula-id="formula_9.34a"]'));
  await expect(formulaNode).toBeVisible();

  const mathText = ((await formulaNode.locator('.formula-node__math').textContent()) || '').replace(/\s+/g, '');
  expect(mathText).not.toMatch(/frequencyoftheithhaplotype/i);
  expect(mathText).not.toMatch(/p_i=frequency/i);
});

test('formula 9.2d fraction hover uses semantic Waples statistic text', async ({ page }) => {
  await page.goto('/graph/formula_9.2d?chapterId=chapter9&mode=formula', { waitUntil: 'domcontentloaded' });

  const annotations = page.locator('[data-note][data-symbol]');
  await expect(annotations.first()).toBeVisible();
  const fractionIndex = await annotations.evaluateAll((nodes) =>
    nodes.findIndex((node) => {
      const symbol = (node as HTMLElement).dataset.symbol || '';
      const note = (node as HTMLElement).dataset.note || '';
      return symbol.includes('\\frac') && /Waples|检验统计量|标准化平方偏离量/.test(note);
    }),
  );
  expect(fractionIndex).toBeGreaterThanOrEqual(0);

  const fraction = annotations.nth(fractionIndex);
  const semanticText = [await fraction.getAttribute('data-note'), await fraction.getAttribute('data-text')].filter(Boolean).join(' ');
  expect(semanticText).toMatch(/Waples|检验统计量|标准化平方偏离量/);
  expect(semanticText).not.toMatch(/分式比值|分子这一项|归一化结果/);

  const fractionLine = fraction.locator('.frac-line').first();
  if (await fractionLine.isVisible().catch(() => false)) {
    await fractionLine.hover();
  } else {
    await fraction.hover();
  }
  const callout = page.locator('.formula-node__callout');
  await expect(callout).toBeVisible();
  const text = (await callout.textContent()) || '';

  expect(text).not.toMatch(/分式比值|分子这一项|归一化结果/);
});

test('formula successor buttons expand in place without resetting the graph', async ({ page }) => {
  await page.goto('/graph/formula_18.3?study=chapter&layer=full&mode=formula&chapterId=chapter18&selected=formula_18.3', { waitUntil: 'domcontentloaded' });

  const formulaNode = (formulaId: string) => page.getByTestId('formula-node').and(page.locator(`[data-formula-id="${formulaId}"]`));
  const sideButton = (formulaId: string, side: 'left' | 'right') => formulaNode(formulaId).locator(`.formula-node__side-trigger--${side}`);

  await expect(page.getByTestId('formula-node')).toHaveCount(1);
  await expect(sideButton('formula_18.3', 'left')).toBeDisabled();
  await expect(sideButton('formula_18.3', 'left')).toHaveAttribute('title', '暂无前置公式');
  await expect(sideButton('formula_18.3', 'right')).toBeEnabled();

  const startUrl = page.url();
  await sideButton('formula_18.3', 'right').click();

  await expect(formulaNode('formula_18.7')).toBeVisible();
  await expect(formulaNode('formula_18.8')).toBeVisible();
  await expect(page.getByTestId('formula-node')).toHaveCount(3);
  await expect(sideButton('formula_18.7', 'left')).toBeEnabled();
  await expect(sideButton('formula_18.7', 'right')).toBeDisabled();
  await expect(sideButton('formula_18.7', 'right')).toHaveAttribute('title', '暂无后续公式');
  await expect(page.locator('.edge-label').filter({ hasText: '依赖' }).first()).toBeVisible();
  expect(page.url()).toBe(startUrl);

  await sideButton('formula_18.8', 'right').click();

  await expect(formulaNode('formula_18.3')).toBeVisible();
  await expect(formulaNode('formula_18.7')).toBeVisible();
  await expect(formulaNode('formula_18.8')).toBeVisible();
  await expect(formulaNode('formula_18.9')).toBeVisible();
  await expect(formulaNode('formula_18.15c')).toBeVisible();
  await expect(page.locator('.edge-label').filter({ hasText: 'Equation 18.8' }).first()).toBeVisible();
  expect(await page.locator('.react-flow__edge').count()).toBeGreaterThanOrEqual(4);
  expect(page.url()).toBe(startUrl);
});

test('formula toolbar navigates previous and next study formulas', async ({ page }) => {
  await page.goto('/graph/formula_18.3?study=chapter&layer=full&mode=formula&chapterId=chapter18&selected=formula_18.3', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('button', { name: /上一个公式/ })).toBeVisible();
  await page.getByRole('button', { name: /下一个公式/ }).click();
  await expect(page).toHaveURL(/\/graph\/formula_18\.4\?/);
  await expect(page).toHaveURL(/mode=formula/);
  await expect(page).toHaveURL(/layer=full/);
  await expect(page).toHaveURL(/selected=formula_18\.4/);

  await page.getByRole('button', { name: /上一个公式/ }).click();
  await expect(page).toHaveURL(/\/graph\/formula_18\.3\?/);
  await expect(page).toHaveURL(/selected=formula_18\.3/);
});

test('storyline open graph enters formula mode for the selected formula', async ({ page }) => {
  await page.goto('/storyline/allele-frequency', { waitUntil: 'domcontentloaded' });

  await page.locator('.storyline-open-graph').click();
  await expect(page).toHaveURL(/\/graph\/formula_2\.8\?/);
  await expect(page).toHaveURL(/from=storyline/);
  await expect(page).toHaveURL(/storyline=allele-frequency/);
  await expect(page).toHaveURL(/mode=formula/);
  await expect(page).toHaveURL(/study=chapter/);
  await expect(page).toHaveURL(/selected=formula_2\.8/);
  await expect(page.getByTestId('formula-node').and(page.locator('[data-formula-id="formula_2.8"]'))).toBeVisible();
});

test('guided landscape hint stays outside the formula card', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/graph/formula_11.7b?chapterId=chapter11&mode=formula', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.formula-node--focus')).toBeVisible();
  const hint = page.locator('.graph-onboarding-hint').first();
  if (!(await hint.isVisible({ timeout: 2_000 }).catch(() => false))) return;

  const overlaps = await page.evaluate(() => {
    const hint = document.querySelector('.graph-onboarding-hint')?.getBoundingClientRect();
    const formula = document.querySelector('.formula-node--focus')?.getBoundingClientRect();
    if (!hint || !formula) return true;
    const xOverlap = Math.max(0, Math.min(hint.right, formula.right) - Math.max(hint.left, formula.left));
    const yOverlap = Math.max(0, Math.min(hint.bottom, formula.bottom) - Math.max(hint.top, formula.top));
    return xOverlap * yOverlap > 0;
  });

  expect(overlaps).toBe(false);
});

test('concept view restores formula evidence after returning from guided formula', async ({ page }) => {
  await page.goto('/graph/formula_13.11a?chapterId=chapter13', { waitUntil: 'domcontentloaded' });

  let focusNode = page.locator('[data-testid="concept-node"][data-concept-role="focus"]').first();
  await expect(focusNode).toContainText('Response');

  await expect(focusNode.getByRole('button', { name: /本式符号|收起符号|无符号/ })).toHaveCount(0);
  await focusNode.getByRole('button', { name: /公式证据/ }).click();
  await expect(focusNode).toContainText('公式证据');
  await expect(focusNode.locator('.concept-node__formula')).toBeVisible();

  await focusNode.getByRole('button', { name: '查看公式' }).click();
  await expect(page).toHaveURL(/mode=formula/);
  await page.getByRole('button', { name: /(?:返回|Back to).*Response/ }).click();

  focusNode = page.locator('[data-testid="concept-node"][data-concept-role="focus"]').first();
  await expect(page).not.toHaveURL(/mode=formula/);
  await expect(focusNode.getByRole('button', { name: /本式符号|收起符号|无符号/ })).toHaveCount(0);
  await expect(focusNode).toContainText('公式证据');
  await expect(focusNode.locator('.concept-node__formula')).toBeVisible();
});

test('concept view restores expanded state after browser back from guided formula', async ({ page }) => {
  await page.goto('/graph/formula_13.11a?chapterId=chapter13', { waitUntil: 'domcontentloaded' });

  let focusNode = page.locator('[data-testid="concept-node"][data-concept-role="focus"]').first();
  await expect(focusNode).toContainText('Response');

  await expect(focusNode.getByRole('button', { name: /本式符号|收起符号|无符号/ })).toHaveCount(0);
  await focusNode.getByRole('button', { name: /公式证据/ }).click();
  await expect(focusNode).toContainText('公式证据');
  await expect(focusNode.locator('.concept-node__formula')).toBeVisible();

  await focusNode.getByRole('button', { name: '查看公式' }).click();
  await expect(page).toHaveURL(/mode=formula/);
  await page.goBack();

  focusNode = page.locator('[data-testid="concept-node"][data-concept-role="focus"]').first();
  await expect(page).not.toHaveURL(/mode=formula/);
  await expect(focusNode.getByRole('button', { name: /本式符号|收起符号|无符号/ })).toHaveCount(0);
  await expect(focusNode).toContainText('公式证据');
  await expect(focusNode.locator('.concept-node__formula')).toBeVisible();
});

test('concept prerequisite edges show via-symbol labels', async ({ page }) => {
  await page.goto('/graph/formula_A1.6?chapterId=appendix1&conceptId=canonical_probability_density', { waitUntil: 'domcontentloaded' });

  const focusNode = page.locator('[data-testid="concept-node"][data-concept-role="focus"]').first();
  await expect(focusNode).toContainText('概率密度');
  await focusNode.getByRole('button', { name: /公式证据/ }).click();
  await expect(focusNode.locator('.concept-node__formula')).toBeVisible();

  await expect(page.locator('.edge-label').first()).toBeVisible();
  await expect(page.locator('.edge-label__math').first()).toBeVisible();
});

test('concept search groups repeated concept occurrences into one readable result', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('combobox').fill('heterozygosity');

  const firstExactConcept = page.locator('[role="option"]').filter({ hasText: /^Heterozygosity/ }).first();
  await expect(firstExactConcept).toBeVisible();
  await expect(firstExactConcept).toContainText('出现在');
  await expect(firstExactConcept).toContainText('代表公式');

  const exactConceptCount = await page.locator('[role="option"]').evaluateAll((options) =>
    options.filter((option) => {
      const text = option.textContent?.trim() || '';
      return text.startsWith('Heterozygosity') && !text.startsWith('Sweep-Linked Heterozygosity');
    }).length,
  );
  expect(exactConceptCount).toBe(1);
});

test('home starfield hover and click open a chapter card without stacking canvases', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.starfield-root canvas')).toHaveCount(1);

  const point = await findInteractiveStarPoint(page);
  await expect(page.locator('.star-node-hover-tooltip')).toBeVisible();
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('.star-node-card')).toBeVisible();
  await expect(page.locator('.starfield-root canvas')).toHaveCount(1);
  expect(consoleErrors.filter((text) => /webgl|three|react/i.test(text))).toEqual([]);
});

test('chapter concept entry cards hide formula chips and render symbol chips', async ({ page }) => {
  await page.goto('/chapter/chapter10', { waitUntil: 'domcontentloaded' });

  const conceptEntries = page.locator('.chapter-entry-panel--desktop .chapter-entry-panel__item--concept');
  await expect(conceptEntries.first()).toBeVisible();
  await expect(page.locator('.chapter-entry-panel--desktop .chapter-entry-panel__item--concept .chapter-entry-panel__source-chip')).toHaveCount(0);

  const tauHatEntry = conceptEntries.filter({ hasText: 'Tau-hat' });
  await expect(tauHatEntry).toHaveCount(1);
  await expect(tauHatEntry.locator('.chapter-entry-panel__symbol-chip .katex')).toBeVisible();
});

test('chapter concept entry cards supplement sparse root lists', async ({ page }) => {
  await page.goto('/chapter/chapter14', { waitUntil: 'domcontentloaded' });

  const conceptEntries = page.locator('.chapter-entry-panel--desktop .chapter-entry-panel__item--concept');
  await expect(conceptEntries.nth(3)).toBeVisible();
  expect(await conceptEntries.count()).toBeGreaterThanOrEqual(4);
});

test('chapter switching keeps one starfield canvas and updates the title', async ({ page }) => {
  await page.goto('/chapter/chapter11', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.starfield-root canvas')).toHaveCount(1);
  const initialTitle = (await page.locator('.chapter-title-nav h1').textContent())?.trim();

  await page.locator('.chapter-switch-button--next').click();
  await expect(page).toHaveURL(/\/chapter\/chapter12/);
  await expect(page.locator('.starfield-root canvas')).toHaveCount(1);
  await expect(page.locator('.chapter-title-nav h1')).not.toHaveText(initialTitle || '');

  await page.locator('.chapter-switch-button--previous').click();
  await expect(page).toHaveURL(/\/chapter\/chapter11/);
  await expect(page.locator('.starfield-root canvas')).toHaveCount(1);
});

test('chapter starfield remains clickable after drag inertia', async ({ page }) => {
  await page.goto('/chapter/chapter11', { waitUntil: 'domcontentloaded' });
  const canvas = page.locator('.starfield-root canvas').first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Starfield canvas has no bounding box');

  await page.mouse.move(box.x + box.width * 0.46, box.y + box.height * 0.48);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.42, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(350);

  const point = await findInteractiveStarPoint(page);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('.star-node-card')).toBeVisible();
  await expect(page.locator('.starfield-root canvas')).toHaveCount(1);
});
