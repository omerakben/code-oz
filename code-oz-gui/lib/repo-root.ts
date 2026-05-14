import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CODE_OZ_PACKAGE_NAME = '@tuel/code-oz';
let cachedRepoRoot: string | null = null;

export function findCodeOzRepoRoot(fromUrl: string = import.meta.url): string {
  if (cachedRepoRoot) {
    return cachedRepoRoot;
  }

  let current = dirname(fileURLToPath(fromUrl));

  while (true) {
    const packageJsonPath = join(current, 'package.json');

    try {
      const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { readonly name?: unknown };
      if (parsed.name === CODE_OZ_PACKAGE_NAME) {
        cachedRepoRoot = current;
        return current;
      }
    } catch {
      // Keep walking; most parent directories are not package roots.
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Unable to locate ${CODE_OZ_PACKAGE_NAME} from ${fromUrl}.`);
    }
    current = parent;
  }
}
