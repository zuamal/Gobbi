import { Command } from 'commander'
import { multiselect, select, isCancel } from '@clack/prompts'
import { readFile, writeFile, mkdir, stat as statAsync } from 'node:fs/promises'
import { join, dirname, extname, relative } from 'node:path'
import { loadManifests } from '../registry.js'
import * as logger from '../logger.js'
import { LockFileSchema, type LockFile, type LockFileEntry } from '../schema.js'
import { resolveConflict } from '../installer/conflict.js'
import { mergeMd, mergeJson } from '../installer/merge.js'
import { computeStringChecksum } from '../installer/checksum.js'
import type { Manifest } from '../schema.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await statAsync(dir)
    .then(() => import('node:fs/promises').then(m => m.readdir(dir, { withFileTypes: true })))
    .catch(() => null)

  if (!entries) return []

  const files: string[] = []
  for (const entry of entries) {
    const fullPath = join(dir, String(entry.name))
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(fullPath)))
    } else {
      files.push(fullPath)
    }
  }
  return files
}

async function enumerateComponentFiles(
  harnessDir: string,
  componentRelPath: string,
): Promise<Array<{ src: string; targetRelPath: string }>> {
  const srcPath = join(harnessDir, componentRelPath)
  const stat = await statAsync(srcPath).catch(() => null)
  if (!stat) return []

  if (stat.isFile()) {
    return [{ src: srcPath, targetRelPath: relative(harnessDir, srcPath) }]
  }

  if (stat.isDirectory()) {
    const allFiles = await listFilesRecursive(srcPath)
    return allFiles.map(file => ({ src: file, targetRelPath: relative(harnessDir, file) }))
  }

  return []
}

interface ComponentOption {
  key: string
  label: string
}

async function buildComponentOptions(
  harnessDir: string,
  files: NonNullable<Manifest['files']>,
): Promise<ComponentOption[]> {
  const options: ComponentOption[] = []

  for (const [key, filePath] of Object.entries(files)) {
    if (!filePath) continue
    const srcPath = join(harnessDir, filePath)
    const stat = await statAsync(srcPath).catch(() => null)
    if (!stat) continue

    let label: string
    if (stat.isDirectory()) {
      const allFiles = await listFilesRecursive(srcPath)
      const dirName = filePath.replace(/^\.\//, '').replace(/\/$/, '')
      label = `${dirName}/ (${allFiles.length} files)`
    } else {
      const fileName = filePath.replace(/^\.\//, '')
      label = fileName
    }

    options.push({ key, label })
  }

  return options
}

async function readLockFile(lockPath: string): Promise<LockFile | null> {
  try {
    const content = await readFile(lockPath, 'utf-8')
    const raw: unknown = JSON.parse(content)
    return LockFileSchema.parse(raw)
  } catch {
    return null
  }
}

// ── Command ───────────────────────────────────────────────────────────────────

export interface InstallOptions {
  only?: string
  all?: boolean
}

export async function runInstall(
  harnessName: string,
  opts: InstallOptions,
  registryRoot?: string,
  projectDir?: string,
): Promise<void> {
  // 1. Validate --only and --all mutual exclusion
  if (opts.only !== undefined && opts.all) {
    logger.error('Cannot use --only and --all together.')
    process.exit(1)
    return
  }

  const cwd = projectDir ?? process.cwd()
  const resolvedRoot =
    registryRoot ?? process.env['GOBBI_REGISTRY'] ?? join(cwd, 'registry')

  // 2. Load registry, find harness
  let manifests
  try {
    manifests = await loadManifests(resolvedRoot)
  } catch {
    logger.error('Registry not found. Run gobbi from your project root.')
    process.exit(1)
    return
  }

  const manifest = manifests.find(m => m.name === harnessName)
  if (!manifest) {
    logger.error(`Harness "${harnessName}" not found in registry.`)
    process.exit(1)
    return
  }

  // 3. Check existing lock file
  const lockPath = join(cwd, '.gobbi-lock.json')
  const existingLock = await readLockFile(lockPath)
  if (existingLock !== null && existingLock.harness !== harnessName) {
    logger.error(
      `Harness ${existingLock.harness} is already installed. Run \`gobbi uninstall ${existingLock.harness}\` first.`,
    )
    process.exit(1)
    return
  }

  // 4. Determine available components
  const manifestFiles = manifest.files ?? {}
  const availableKeys = Object.keys(manifestFiles).filter(
    k => manifestFiles[k as keyof typeof manifestFiles] !== undefined,
  )
  const harnessDir = join(resolvedRoot, manifest.agent, harnessName)

  // 5. Validate --only keys
  if (opts.only !== undefined) {
    const onlyKeys = opts.only.split(',').map(k => k.trim())
    const invalidKeys = onlyKeys.filter(k => !availableKeys.includes(k))
    if (invalidKeys.length > 0) {
      logger.error(
        `Invalid component key(s): ${invalidKeys.join(', ')}. Valid: ${availableKeys.join(', ')}`,
      )
      process.exit(1)
      return
    }
  }

  // 6. Determine selected component keys
  let selectedKeys: string[]

  if (opts.all) {
    selectedKeys = availableKeys
  } else if (opts.only !== undefined) {
    selectedKeys = opts.only.split(',').map(k => k.trim())
  } else {
    // Interactive checklist
    const componentOpts = await buildComponentOptions(harnessDir, manifestFiles)
    if (componentOpts.length === 0) {
      process.stdout.write('No installable components found.\n')
      process.exit(0)
      return
    }

    const result = await multiselect({
      message: 'Components found:',
      options: componentOpts.map(o => ({ value: o.key, label: o.label })),
      initialValues: componentOpts.map(o => o.key),
      required: false,
    })

    if (isCancel(result)) {
      process.exit(0)
      return
    }

    const selected = result as string[]
    if (selected.length === 0) {
      process.stdout.write('Nothing selected. Aborting.\n')
      process.exit(0)
      return
    }

    selectedKeys = selected
  }

  // 7. Install files
  const lockEntries: LockFileEntry[] = []

  for (const componentKey of selectedKeys) {
    const componentRelPath = manifestFiles[componentKey as keyof typeof manifestFiles]
    if (!componentRelPath) continue

    const componentFiles = await enumerateComponentFiles(harnessDir, componentRelPath)

    for (const { src, targetRelPath } of componentFiles) {
      const targetPath = join(cwd, targetRelPath)

      let incomingContent: string
      try {
        incomingContent = await readFile(src, 'utf-8')
      } catch {
        logger.error(`Failed to read source file: ${src}`)
        process.exit(1)
        return
      }

      const targetExists = await statAsync(targetPath)
        .then(() => true)
        .catch(() => false)

      if (!targetExists) {
        // Direct install
        try {
          await mkdir(dirname(targetPath), { recursive: true })
          await writeFile(targetPath, incomingContent, 'utf-8')
        } catch {
          logger.error(`Failed to write file: ${targetPath}`)
          process.exit(1)
          return
        }
        lockEntries.push({
          path: targetRelPath,
          checksum: computeStringChecksum(incomingContent),
          strategy: 'overwrite',
        })
      } else {
        // Conflict resolution
        const choice = await resolveConflict(targetPath, incomingContent)

        if (choice === 'skip') continue

        if (choice === 'overwrite') {
          try {
            await writeFile(targetPath, incomingContent, 'utf-8')
          } catch {
            logger.error(`Failed to write file: ${targetPath}`)
            process.exit(1)
            return
          }
          lockEntries.push({
            path: targetRelPath,
            checksum: computeStringChecksum(incomingContent),
            strategy: 'overwrite',
          })
        }

        if (choice === 'merge') {
          let existingContent: string
          try {
            existingContent = await readFile(targetPath, 'utf-8')
          } catch {
            logger.error(`Failed to read existing file: ${targetPath}`)
            process.exit(1)
            return
          }

          const originalChecksum = computeStringChecksum(existingContent)
          const backupRelPath = join('.gobbi', 'backups', targetRelPath)
          const backupAbsPath = join(cwd, backupRelPath)

          try {
            await mkdir(dirname(backupAbsPath), { recursive: true })
            await writeFile(backupAbsPath, existingContent, 'utf-8')
          } catch {
            logger.error(`Failed to create backup: ${backupAbsPath}`)
            process.exit(1)
            return
          }

          const ext = extname(targetPath).toLowerCase()
          let mergedContent: string

          if (ext === '.md') {
            mergedContent = mergeMd(existingContent, incomingContent, {
              harness: manifest.name,
              version: manifest.version,
            })
          } else if (ext === '.json') {
            mergedContent = await mergeJson(
              existingContent,
              incomingContent,
              async (key, existingVal, incomingVal) => {
                const conflictResult = await select({
                  message: `Key conflict in JSON: "${key}"`,
                  options: [
                    { value: 'keep', label: `Keep existing: ${JSON.stringify(existingVal)}` },
                    { value: 'overwrite', label: `Use incoming: ${JSON.stringify(incomingVal)}` },
                  ],
                })
                if (isCancel(conflictResult)) return 'keep'
                return conflictResult as 'keep' | 'overwrite'
              },
            )
          } else {
            mergedContent = incomingContent
          }

          try {
            await writeFile(targetPath, mergedContent, 'utf-8')
          } catch {
            logger.error(`Failed to write merged file: ${targetPath}`)
            process.exit(1)
            return
          }

          lockEntries.push({
            path: targetRelPath,
            checksum: computeStringChecksum(mergedContent),
            strategy: 'merge',
            original_checksum: originalChecksum,
            backup_path: backupRelPath,
          })
        }
      }
    }
  }

  // 8. Write lock file
  const lockFile: LockFile = {
    harness: manifest.name,
    agent: manifest.agent,
    version: manifest.version,
    installed_at: new Date().toISOString(),
    files: lockEntries,
  }

  try {
    await writeFile(lockPath, JSON.stringify(lockFile, null, 2), 'utf-8')
  } catch {
    logger.error(`Failed to write lock file: ${lockPath}`)
    process.exit(1)
    return
  }

  logger.info(`Installed ${manifest.name}@${manifest.version}`)
}

export function createInstallCommand(): Command {
  return new Command('install')
    .description('Install a harness into your project')
    .argument('<harness-name>', 'name of the harness to install')
    .option('--only <components>', 'install specific components (comma-separated manifest keys)')
    .option('--all', 'install all components without checklist')
    .action(async (harnessName: string, opts: InstallOptions) => {
      await runInstall(harnessName, opts)
    })
}
