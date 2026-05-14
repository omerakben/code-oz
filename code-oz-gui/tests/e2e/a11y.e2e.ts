import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';

const axePath = join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js');

type AxeViolation = {
  readonly id: string;
  readonly impact: 'minor' | 'moderate' | 'serious' | 'critical' | null;
  readonly help: string;
  readonly nodes: readonly { readonly target: readonly string[] }[];
};

async function seriousOrCriticalViolations(page: Page, selector: string): Promise<readonly AxeViolation[]> {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async (rootSelector) => {
    const root = document.querySelector(rootSelector);
    if (!root) {
      throw new Error(`missing axe root ${rootSelector}`);
    }
    const axe = (window as typeof window & {
      axe: {
        run: (root: Element, options: unknown) => Promise<{ violations: AxeViolation[] }>;
      };
    }).axe;
    const result = await axe.run(root, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      },
    });
    return result.violations.filter((violation) => (
      violation.impact === 'serious' || violation.impact === 'critical'
    ));
  }, selector);
}

async function expectA11yClean(page: Page, selector: string): Promise<void> {
  const violations = await seriousOrCriticalViolations(page, selector);
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

test.describe('code-oz-gui a11y baseline', () => {
  test('Board, Drawer, and focused Composer have zero serious or critical axe violations', async ({ page }) => {
    await page.goto('/');

    await expectA11yClean(page, '[data-a11y="composer"]');
    await expectA11yClean(page, '[data-a11y="board"]');

    await page.getByLabel('Describe the repo task').focus();
    await expectA11yClean(page, '[data-a11y="composer"]');

    await page.getByRole('button', { name: /Audit the Safari iOS checkout failure/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectA11yClean(page, '[role="dialog"]');
  });

  test('Drawer focus trap includes textareas and restores the opener on Escape', async ({ page }) => {
    await page.goto('/');

    const opener = page.getByRole('button', { name: /Audit the Safari iOS checkout failure/ });
    await opener.focus();
    await expect(opener).toBeFocused();
    await opener.click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Ask', exact: true }).click();

    const helperInput = page.getByPlaceholder('Ask anything about this view...');
    await helperInput.focus();
    await expect(helperInput).toBeFocused();

    const closeDrawer = page.getByRole('dialog').getByLabel('Close drawer');
    await page.keyboard.press('Tab');
    await expect(closeDrawer).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(opener).toBeFocused();
  });
});
