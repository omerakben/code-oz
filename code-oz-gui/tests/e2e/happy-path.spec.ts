import { expect, test } from '@playwright/test';

test.describe('code-oz-gui happy path', () => {
  test('renders, opens drawer, switches tabs persistently, helper expand/collapse', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Workspace: ./fixtures/sample-run')).toBeVisible();

    for (const phase of ['UNDERSTAND', 'PLAN', 'BUILD', 'VERIFY', 'REVIEW', 'SHIP']) {
      await expect(page.getByRole('heading', { name: phase })).toBeVisible();
    }

    await expect(page.getByText(/demo mode/i)).toBeVisible();

    await page.getByRole('button', { name: /Audit the Safari iOS checkout failure/ }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Audit the Safari iOS checkout failure' })).toBeVisible();

    // Drawer tabs use role="tab" (a11y baseline, step 10g). Selected state asserted via aria-selected, not via Tailwind class.
    const artifactTab = dialog.getByRole('tab', { name: 'Artifact' });
    await expect(artifactTab).toHaveAttribute('aria-selected', 'true');

    // Regression guard for step 10i: object-identity loop in Drawer useEffect deps.
    await dialog.getByRole('tab', { name: 'Decisions' }).click();
    await expect(dialog.getByText(/DECISION · OPEN QUESTION · AWAITING ANSWER/i)).toBeVisible();
    await page.waitForTimeout(5_000);
    await expect(dialog.getByText(/DECISION · OPEN QUESTION · AWAITING ANSWER/i)).toBeVisible();

    await dialog.getByRole('tab', { name: 'Events' }).click();
    await expect(dialog.getByRole('button', { name: 'All events' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Phase only' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Errors only' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Errors only' }).click();
    await expect(dialog.locator('ol > li')).toHaveCount(3);

    await dialog.getByRole('button', { name: 'All events' }).click();
    await dialog.getByRole('tab', { name: 'Artifact' }).click();

    await dialog.getByRole('button', { name: 'Ask' }).click();
    await expect(dialog.getByText(/Ask about this/i)).toBeVisible();

    await dialog.getByRole('button', { name: 'Explain this in plain English' }).click();
    await expect(dialog.getByPlaceholder('Ask anything about this view...')).toHaveValue('Explain this in plain English');

    await dialog.getByLabel('Close AI helper').click();
    await expect(dialog.getByText(/Ask about this/i)).toBeHidden();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: 'UNDERSTAND' })).toBeVisible();
  });
});
