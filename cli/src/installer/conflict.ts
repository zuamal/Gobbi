import { select, isCancel } from '@clack/prompts'
import { readFile } from 'node:fs/promises'
import { extname, basename } from 'node:path'

export type ConflictChoice = 'overwrite' | 'merge' | 'skip'

export async function resolveConflict(
  targetPath: string,
  incomingContent: string,
): Promise<ConflictChoice> {
  const ext = extname(targetPath).toLowerCase()
  const canMerge = ext === '.md' || ext === '.json'
  const fileName = basename(targetPath)

  while (true) {
    process.stdout.write(`\n  Conflict: ${fileName} already exists\n\n`)

    const options: Array<{ value: string; label: string }> = [
      { value: 'd', label: '[d] Show diff' },
      { value: 'o', label: '[o] Overwrite with harness version' },
      ...(canMerge
        ? [{ value: 'm', label: '[m] Merge (append harness content below existing)' }]
        : []),
      { value: 's', label: '[s] Skip this file' },
    ]

    const result = await select({ message: 'Choice', options })

    if (isCancel(result)) {
      process.exit(0)
      return 'skip'
    }

    if (result === 'd') {
      const existing = await readFile(targetPath, 'utf-8')
      process.stdout.write('\n  --- Existing file ---\n')
      process.stdout.write(existing)
      process.stdout.write('\n  --- Incoming file ---\n')
      process.stdout.write(incomingContent)
      process.stdout.write('\n\n')
      continue
    }

    if (result === 'o') return 'overwrite'
    if (result === 'm') return 'merge'
    return 'skip'
  }
}
