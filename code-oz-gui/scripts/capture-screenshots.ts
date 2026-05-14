import { access, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Locator, type Page } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = join(process.cwd(), 'docs', 'screenshots');
const PLAYWRIGHT_CACHE_DIR = join(process.env.HOME ?? '', 'Library', 'Caches', 'ms-playwright');

type ScreenshotName = 'hero' | 'decisions-task' | 'events-errors' | 'workspace-form';

async function saveScreenshot(page: Page, name: ScreenshotName): Promise<void> {
  await page.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`) });
}

async function fileSize(name: ScreenshotName): Promise<number> {
  return (await stat(join(SCREENSHOT_DIR, `${name}.png`))).size;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function cachedChromiumExecutables(): Promise<readonly string[]> {
  const entries = await readdir(PLAYWRIGHT_CACHE_DIR, { withFileTypes: true }).catch(() => []);
  const candidates: Array<{ readonly path: string; readonly mtimeMs: number }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('chromium-')) {
      continue;
    }

    const paths = [
      join(PLAYWRIGHT_CACHE_DIR, `chromium_headless_shell-${entry.name.slice('chromium-'.length)}`, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
      join(PLAYWRIGHT_CACHE_DIR, `chromium_headless_shell-${entry.name.slice('chromium-'.length)}`, 'chrome-mac', 'headless_shell'),
      join(PLAYWRIGHT_CACHE_DIR, entry.name, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      join(PLAYWRIGHT_CACHE_DIR, entry.name, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ];

    for (const executablePath of paths) {
      if (await pathExists(executablePath)) {
        candidates.push({ path: executablePath, mtimeMs: (await stat(executablePath)).mtimeMs });
      }
    }
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates.map((candidate) => candidate.path);
}

async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (error) {
    let lastError: unknown = error;
    const executablePaths = await cachedChromiumExecutables();

    if (executablePaths.length === 0) {
      throw error;
    }

    for (const executablePath of executablePaths) {
      try {
        console.warn(`using cached Chromium fallback: ${executablePath}`);
        return await chromium.launch({ executablePath });
      } catch (fallbackError) {
        lastError = fallbackError;
      }
    }

    throw lastError;
  }
}

async function closeDrawer(page: Page): Promise<void> {
  const closeButtons = page.getByLabel('Close drawer');
  await closeButtons.last().click();
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 5000 });
}

async function waitForAny(locatorA: Locator, locatorB: Locator, timeout: number): Promise<'answer' | 'error'> {
  const answer = locatorA.waitFor({ state: 'visible', timeout }).then(() => 'answer' as const);
  const error = locatorB.waitFor({ state: 'visible', timeout }).then(() => 'error' as const);
  return Promise.race([answer, error]);
}

async function captureHero(page: Page): Promise<'answer' | 'error'> {
  await page.getByRole('button', { name: /Audit the Safari iOS checkout failure/i }).click();
  await page.getByText(/AUDIT\.md · sha:/i).waitFor({ state: 'visible', timeout: 15000 });

  await page.getByRole('button', { name: /^Ask$/i }).click();
  await page.getByRole('button', { name: 'Explain this in plain English' }).click();
  await page.getByLabel('Send question').click();

  const result = await waitForAny(
    page.getByText(/Approving|checkout/i),
    page.getByText(/Set GEMINI_API_KEY|Gemini helper is not configured|helper is unavailable|Helper unavailable/i),
    30000,
  ).catch(() => 'error' as const);

  // If GEMINI_API_KEY is unset or rejected, the README hero intentionally
  // captures the helper's visible error state rather than failing the run.
  await saveScreenshot(page, 'hero');
  return result;
}

async function captureDecisionsAndEvents(page: Page): Promise<void> {
  await closeDrawer(page);
  await page.getByRole('button', { name: /Write failing RED test for the Safari iOS bug/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  await dialog.getByRole('tab', { name: 'Decisions' }).click();
  await page.getByText(/CROSS-FAMILY REVIEW · fix-first/i).waitFor({ state: 'visible', timeout: 10000 });
  await saveScreenshot(page, 'decisions-task');

  await dialog.getByRole('tab', { name: 'Events' }).click();
  await dialog.getByRole('button', { name: 'Errors only' }).click();
  await page.getByText('budget_warning').waitFor({ state: 'visible', timeout: 10000 });
  await page.getByText('intervention').first().waitFor({ state: 'visible', timeout: 10000 });
  await saveScreenshot(page, 'events-errors');
}

async function captureWorkspaceForm(page: Page): Promise<void> {
  await closeDrawer(page);
  await page.getByRole('button', { name: 'Switch' }).click();
  await page.getByPlaceholder('/absolute/path/to/your/repo').waitFor({ state: 'visible', timeout: 10000 });
  await page.getByRole('button', { name: 'Cost-free demo' }).waitFor({ state: 'visible', timeout: 10000 });
  await saveScreenshot(page, 'workspace-form');
}

async function main(): Promise<void> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let heroResult: 'answer' | 'error' = 'error';

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'UNDERSTAND' }).waitFor({ state: 'visible', timeout: 15000 });
    heroResult = await captureHero(page);
    await captureDecisionsAndEvents(page);
    await captureWorkspaceForm(page);
  } finally {
    await browser.close();
  }

  for (const name of ['hero', 'decisions-task', 'events-errors', 'workspace-form'] as const) {
    console.log(`${name}.png ${await fileSize(name)} bytes`);
  }
  console.log(`hero helper state: ${heroResult}`);
}

await main();
