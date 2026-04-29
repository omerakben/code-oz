import baPath from './defaults/ba.md' with { type: 'file' }
import leadPath from './defaults/lead.md' with { type: 'file' }
import builderPath from './defaults/builder.md' with { type: 'file' }
import verifierPath from './defaults/verifier.md' with { type: 'file' }
import reviewerPath from './defaults/reviewer.md' with { type: 'file' }
import type { SourceFile } from './loader.ts'

interface BundledEntry {
  readonly file: string
  readonly path: string
}

const BUNDLED: readonly BundledEntry[] = [
  { file: 'src/agents/defaults/ba.md', path: baPath },
  { file: 'src/agents/defaults/lead.md', path: leadPath },
  { file: 'src/agents/defaults/builder.md', path: builderPath },
  { file: 'src/agents/defaults/verifier.md', path: verifierPath },
  { file: 'src/agents/defaults/reviewer.md', path: reviewerPath },
]

export async function loadBundledDefaults(): Promise<readonly SourceFile[]> {
  return Promise.all(
    BUNDLED.map(async (entry) => ({
      file: entry.file,
      content: await Bun.file(entry.path).text(),
    })),
  )
}
