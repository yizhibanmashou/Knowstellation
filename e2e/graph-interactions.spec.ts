import { expect, test } from '@playwright/test';

test('minimap click selects the matching chapter formula node', async ({ page }) => {
  await page.goto('/graph/chapter/chapter11?mode=guided', { waitUntil: 'domcontentloaded' });

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
  await page.goto('/graph/formula_11.7b?chapterId=chapter11&mode=guided', { waitUntil: 'domcontentloaded' });

  const annotation = page.locator('[data-note][data-symbol]').first();
  await expect(annotation).toBeVisible();
  const note = await annotation.getAttribute('data-note');

  await annotation.hover();

  const callout = page.locator('.formula-node__callout');
  await expect(callout).toBeVisible();
  await expect(callout).toContainText(note || '');
});

test('guided landscape hint stays outside the formula card', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/graph/formula_11.7b?chapterId=chapter11&mode=guided', { waitUntil: 'domcontentloaded' });

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
