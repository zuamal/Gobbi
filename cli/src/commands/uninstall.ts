import { Command } from 'commander'
import { confirm, isCancel } from '@clack/prompts'
import { readFile, writeFile, unlink, readdir, rmdir } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import * as logger from '../logger.js'
import { LockFileSchema, type LockFile } from '../schema.js'
import { computeFileChecksum } from '../installer/checksum.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function isDirEmpty(dirPath: string): Promise<boolean> {
  try {
    const entries = await readdir(dirPath)
    return entries.length === 0
  } catch {
    return false
  }
}

async function removeIfEmpty(dirPath: string, cwd: string): Promise<void> {
  if (dirPath === cwd) return
  if (await isDirEmpty(dirPath)) {
    await rmdir(dirPath).catch(() => undefined)
  }
}

// ── Command ───────────────────────────────────────────────────────────────────

export async function runUninstall(
  harnessName: string,
  projectDir?: string,
): Promise<void> {
  const cwd = projectDir ?? process.cwd()
  const lockPath = join(cwd, '.gobbi-lock.json')

  // 1. Read lock file
  let lockRaw: string
  try {
    lockRaw = await readFile(lockPath, 'utf-8')
  } catch {
    logger.error('No lock file found. Is a harness installed?')
    process.exit(1)
    return
  }

  // 2. Parse lock file
  let lock: LockFile
  try {
    const parsed: unknown = JSON.parse(lockRaw)
    lock = LockFileSchema.parse(parsed)
  } catch {
    logger.error(`Failed to parse lock file: ${lockPath}`)
    process.exit(1)
    return
  }

  // 3. Verify harness name
  if (lock.harness !== harnessName) {
    logger.error(`Lock file is for harness ${lock.harness}, not ${harnessName}.`)
    process.exit(1)
    return
  }

  // 4. Process each file entry
  const deletedPaths: string[] = []

  for (const entry of lock.files) {
    const absPath = join(cwd, entry.path)

    if (entry.strategy === 'overwrite') {
      let currentChecksum: string
      try {
        currentChecksum = await computeFileChecksum(absPath)
      } catch {
        logger.warn(`File not found, skipping: ${entry.path}`)
        continue
      }

      if (currentChecksum === entry.checksum) {
        await unlink(absPath)
        deletedPaths.push(absPath)
      } else {
        const fileName = basename(entry.path)
        process.stdout.write(`\n  Warning: ${fileName} has been modified since installation.\n`)

        const result = await confirm({
          message: 'Delete anyway?',
          initialValue: false,
        })

        if (!isCancel(result) && result === true) {
          await unlink(absPath)
          deletedPaths.push(absPath)
        }
      }
    }

    if (entry.strategy === 'merge') {
      let currentChecksum: string
      try {
        currentChecksum = await computeFileChecksum(absPath)
      } catch {
        logger.warn(`File not found, skipping: ${entry.path}`)
        continue
      }

      const backupAbsPath = join(cwd, entry.backup_path)
      let backupContent: string | null = null
      try {
        backupContent = await readFile(backupAbsPath, 'utf-8')
      } catch {
        // backup missing
      }

      if (backupContent === null) {
        logger.warn(`Backup not found, skipping: ${entry.path}. Manual cleanup required.`)
        continue
      }

      if (currentChecksum === entry.checksum) {
        await writeFile(absPath, backupContent, 'utf-8')
        await unlink(backupAbsPath)
      } else {
        logger.warn(`File modified. Manual cleanup required for: ${entry.path}.`)
      }
    }
  }

  // 5. Delete lock file (always)
  await unlink(lockPath).catch(() => undefined)

  // 6. Clean up .gobbi/backups/ if empty
  const backupsDir = join(cwd, '.gobbi', 'backups')
  if (await isDirEmpty(backupsDir)) {
    await rmdir(backupsDir).catch(() => undefined)
  }

  // 7. Clean up empty parent directories (1 level only, no recursion)
  const checkedDirs = new Set<string>()
  for (const absPath of deletedPaths) {
    const parentDir = dirname(absPath)
    if (checkedDirs.has(parentDir)) continue
    checkedDirs.add(parentDir)
    await removeIfEmpty(parentDir, cwd)
  }
}

export function createUninstallCommand(): Command {
  return new Command('uninstall')
    .description('Uninstall a harness from your project')
    .argument('<harness-name>', 'name of the harness to uninstall')
    .action(async (harnessName: string) => {
      await runUninstall(harnessName)
    })
}
