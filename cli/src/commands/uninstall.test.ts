import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runUninstall } from './uninstall.js'
import { computeStringChecksum } from '../installer/checksum.js'

vi.mock('../logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('@clack/prompts', () => ({
  confirm: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
  return stat(p).then(() => true).catch(() => false)
}

async function writeLock(
  projectDir: string,
  lock: Record<string, unknown>,
): Promise<void> {
  await writeFile(join(projectDir, '.gobbi-lock.json'), JSON.stringify(lock))
}

function makeLock(files: unknown[] = []): Record<string, unknown> {
  return {
    harness: 'test-harness',
    agent: 'claude-code',
    version: '1.0.0',
    installed_at: '2026-04-01T00:00:00Z',
    files,
  }
}

// ── Test setup ────────────────────────────────────────────────────────────────

let projectDir: string

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'gobbi-uninstall-'))
  vi.spyOn(process.stdout, 'write').mockImplementation(
    ((_chunk: string | Uint8Array) => true) as typeof process.stdout.write,
  )
  vi.spyOn(process, 'exit').mockImplementation(
    ((_code?: string | number | null) => {
      throw new Error(`process.exit(${_code ?? 0})`)
    }) as typeof process.exit,
  )
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  await rm(projectDir, { recursive: true, force: true }).catch(() => undefined)
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runUninstall', () => {
  it('1. overwrite 체크섬 일치 → 파일 삭제됨', async () => {
    const content = '# CLAUDE.md content'
    await writeFile(join(projectDir, 'CLAUDE.md'), content)
    const checksum = computeStringChecksum(content)

    await writeLock(projectDir, makeLock([
      { path: 'CLAUDE.md', checksum, strategy: 'overwrite' },
    ]))

    await runUninstall('test-harness', projectDir)
    expect(await fileExists(join(projectDir, 'CLAUDE.md'))).toBe(false)
  })

  it('2. overwrite 체크섬 불일치, confirm y → 파일 삭제됨', async () => {
    const content = '# Modified content'
    await writeFile(join(projectDir, 'CLAUDE.md'), content)

    await writeLock(projectDir, makeLock([
      { path: 'CLAUDE.md', checksum: 'sha256:' + '0'.repeat(64), strategy: 'overwrite' },
    ]))

    const { confirm } = await import('@clack/prompts')
    vi.mocked(confirm).mockResolvedValueOnce(true)

    await runUninstall('test-harness', projectDir)
    expect(await fileExists(join(projectDir, 'CLAUDE.md'))).toBe(false)
  })

  it('3. overwrite 체크섬 불일치, confirm N → 파일 유지됨', async () => {
    const content = '# Modified content'
    await writeFile(join(projectDir, 'CLAUDE.md'), content)

    await writeLock(projectDir, makeLock([
      { path: 'CLAUDE.md', checksum: 'sha256:' + '0'.repeat(64), strategy: 'overwrite' },
    ]))

    const { confirm } = await import('@clack/prompts')
    vi.mocked(confirm).mockResolvedValueOnce(false)

    await runUninstall('test-harness', projectDir)
    expect(await fileExists(join(projectDir, 'CLAUDE.md'))).toBe(true)
  })

  it('4. overwrite 파일 없음 → warn 로그, 오류 없이 계속 진행', async () => {
    await writeLock(projectDir, makeLock([
      { path: 'nonexistent.md', checksum: 'sha256:' + '0'.repeat(64), strategy: 'overwrite' },
    ]))

    const { warn } = await import('../logger.js')

    await runUninstall('test-harness', projectDir)
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining('nonexistent.md'))
  })

  it('5. merge 체크섬 일치, 백업 있음 → 원본 내용으로 복원됨', async () => {
    const mergedContent = '# Original\n\n---\n<!-- gobbi -->\n\n# Incoming'
    const originalContent = '# Original'
    const checksum = computeStringChecksum(mergedContent)

    await writeFile(join(projectDir, 'CLAUDE.md'), mergedContent)
    await mkdir(join(projectDir, '.gobbi', 'backups'), { recursive: true })
    await writeFile(join(projectDir, '.gobbi', 'backups', 'CLAUDE.md'), originalContent)

    await writeLock(projectDir, makeLock([
      {
        path: 'CLAUDE.md',
        checksum,
        strategy: 'merge',
        original_checksum: computeStringChecksum(originalContent),
        backup_path: '.gobbi/backups/CLAUDE.md',
      },
    ]))

    await runUninstall('test-harness', projectDir)

    const restoredContent = await readFile(join(projectDir, 'CLAUDE.md'), 'utf-8')
    expect(restoredContent).toBe(originalContent)
  })

  it('6. merge 체크섬 일치, 백업 있음 → 복원 후 백업 파일 삭제됨', async () => {
    const mergedContent = '# Merged content'
    const originalContent = '# Original'
    const checksum = computeStringChecksum(mergedContent)

    await writeFile(join(projectDir, 'CLAUDE.md'), mergedContent)
    await mkdir(join(projectDir, '.gobbi', 'backups'), { recursive: true })
    await writeFile(join(projectDir, '.gobbi', 'backups', 'CLAUDE.md'), originalContent)

    await writeLock(projectDir, makeLock([
      {
        path: 'CLAUDE.md',
        checksum,
        strategy: 'merge',
        original_checksum: computeStringChecksum(originalContent),
        backup_path: '.gobbi/backups/CLAUDE.md',
      },
    ]))

    await runUninstall('test-harness', projectDir)

    expect(await fileExists(join(projectDir, '.gobbi', 'backups', 'CLAUDE.md'))).toBe(false)
  })

  it('7. merge 체크섬 불일치 → 파일 수정 안 됨, 백업 유지됨', async () => {
    const currentContent = '# Manually modified'
    const originalContent = '# Original'

    await writeFile(join(projectDir, 'CLAUDE.md'), currentContent)
    await mkdir(join(projectDir, '.gobbi', 'backups'), { recursive: true })
    await writeFile(join(projectDir, '.gobbi', 'backups', 'CLAUDE.md'), originalContent)

    // Lock checksum doesn't match current content → checksum mismatch
    await writeLock(projectDir, makeLock([
      {
        path: 'CLAUDE.md',
        checksum: 'sha256:' + '0'.repeat(64),  // different from current file
        strategy: 'merge',
        original_checksum: computeStringChecksum(originalContent),
        backup_path: '.gobbi/backups/CLAUDE.md',
      },
    ]))

    await runUninstall('test-harness', projectDir)

    expect(await readFile(join(projectDir, 'CLAUDE.md'), 'utf-8')).toBe(currentContent)
    expect(await fileExists(join(projectDir, '.gobbi', 'backups', 'CLAUDE.md'))).toBe(true)
  })

  it('8. merge 백업 파일 없음 → warn 로그, 대상 파일 수정 안 됨', async () => {
    const content = '# Merged content'
    const checksum = computeStringChecksum(content)

    await writeFile(join(projectDir, 'CLAUDE.md'), content)
    // No backup file created

    await writeLock(projectDir, makeLock([
      {
        path: 'CLAUDE.md',
        checksum,
        strategy: 'merge',
        original_checksum: 'sha256:' + '0'.repeat(64),
        backup_path: '.gobbi/backups/CLAUDE.md',
      },
    ]))

    const { warn } = await import('../logger.js')
    await runUninstall('test-harness', projectDir)

    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining('Backup not found'))
    expect(await readFile(join(projectDir, 'CLAUDE.md'), 'utf-8')).toBe(content)
  })

  it('9. 전체 처리 후 .gobbi-lock.json 삭제됨', async () => {
    const content = '# file'
    await writeFile(join(projectDir, 'CLAUDE.md'), content)
    const checksum = computeStringChecksum(content)

    await writeLock(projectDir, makeLock([
      { path: 'CLAUDE.md', checksum, strategy: 'overwrite' },
    ]))

    await runUninstall('test-harness', projectDir)
    expect(await fileExists(join(projectDir, '.gobbi-lock.json'))).toBe(false)
  })

  it('10. 일부 skip 포함해도 .gobbi-lock.json 삭제됨', async () => {
    const content = '# Modified'
    await writeFile(join(projectDir, 'CLAUDE.md'), content)

    // checksum mismatch → prompt
    await writeLock(projectDir, makeLock([
      { path: 'CLAUDE.md', checksum: 'sha256:' + '0'.repeat(64), strategy: 'overwrite' },
    ]))

    const { confirm } = await import('@clack/prompts')
    vi.mocked(confirm).mockResolvedValueOnce(false)  // N → skip

    await runUninstall('test-harness', projectDir)
    expect(await fileExists(join(projectDir, '.gobbi-lock.json'))).toBe(false)
    expect(await fileExists(join(projectDir, 'CLAUDE.md'))).toBe(true)  // file kept
  })

  it('11. .gobbi/backups/ 비어있으면 삭제됨', async () => {
    const mergedContent = '# Merged'
    const originalContent = '# Original'
    const checksum = computeStringChecksum(mergedContent)

    await writeFile(join(projectDir, 'CLAUDE.md'), mergedContent)
    await mkdir(join(projectDir, '.gobbi', 'backups'), { recursive: true })
    await writeFile(join(projectDir, '.gobbi', 'backups', 'CLAUDE.md'), originalContent)

    await writeLock(projectDir, makeLock([
      {
        path: 'CLAUDE.md',
        checksum,
        strategy: 'merge',
        original_checksum: computeStringChecksum(originalContent),
        backup_path: '.gobbi/backups/CLAUDE.md',
      },
    ]))

    await runUninstall('test-harness', projectDir)

    // Backup was consumed → backups dir now empty → should be deleted
    expect(await fileExists(join(projectDir, '.gobbi', 'backups'))).toBe(false)
  })

  it('12. .gobbi/backups/에 파일 남아있으면 유지됨', async () => {
    const content = '# Manually modified'

    await writeFile(join(projectDir, 'CLAUDE.md'), content)
    await mkdir(join(projectDir, '.gobbi', 'backups'), { recursive: true })
    await writeFile(join(projectDir, '.gobbi', 'backups', 'CLAUDE.md'), '# Original')

    // checksum mismatch → backup NOT consumed
    await writeLock(projectDir, makeLock([
      {
        path: 'CLAUDE.md',
        checksum: 'sha256:' + '0'.repeat(64),
        strategy: 'merge',
        original_checksum: 'sha256:' + '1'.repeat(64),
        backup_path: '.gobbi/backups/CLAUDE.md',
      },
    ]))

    await runUninstall('test-harness', projectDir)

    expect(await fileExists(join(projectDir, '.gobbi', 'backups', 'CLAUDE.md'))).toBe(true)
    expect(await fileExists(join(projectDir, '.gobbi', 'backups'))).toBe(true)
  })

  it('13. 삭제 후 부모 디렉토리 비어있으면 삭제됨', async () => {
    await mkdir(join(projectDir, 'skills'), { recursive: true })
    const content = '# Commit skill'
    await writeFile(join(projectDir, 'skills', 'commit.md'), content)
    const checksum = computeStringChecksum(content)

    await writeLock(projectDir, makeLock([
      { path: 'skills/commit.md', checksum, strategy: 'overwrite' },
    ]))

    await runUninstall('test-harness', projectDir)

    expect(await fileExists(join(projectDir, 'skills', 'commit.md'))).toBe(false)
    expect(await fileExists(join(projectDir, 'skills'))).toBe(false)
  })

  it('14. 삭제 후 부모 디렉토리에 다른 파일 있으면 유지됨', async () => {
    await mkdir(join(projectDir, 'skills'), { recursive: true })
    const content = '# Commit skill'
    await writeFile(join(projectDir, 'skills', 'commit.md'), content)
    await writeFile(join(projectDir, 'skills', 'review.md'), '# Review skill')
    const checksum = computeStringChecksum(content)

    await writeLock(projectDir, makeLock([
      { path: 'skills/commit.md', checksum, strategy: 'overwrite' },
    ]))

    await runUninstall('test-harness', projectDir)

    expect(await fileExists(join(projectDir, 'skills', 'commit.md'))).toBe(false)
    expect(await fileExists(join(projectDir, 'skills'))).toBe(true)  // still has review.md
  })

  it('15. .gobbi-lock.json 없음 → exit code 1', async () => {
    await expect(runUninstall('test-harness', projectDir)).rejects.toThrow('process.exit(1)')
  })

  it('16. lock.harness ≠ 인자 → exit code 1', async () => {
    await writeLock(projectDir, {
      harness: 'other-harness',
      agent: 'claude-code',
      version: '1.0.0',
      installed_at: '2026-04-01T00:00:00Z',
      files: [],
    })

    await expect(
      runUninstall('test-harness', projectDir),
    ).rejects.toThrow('process.exit(1)')
  })

  it('17. lock zod 파싱 실패 → exit code 1', async () => {
    await writeFile(
      join(projectDir, '.gobbi-lock.json'),
      JSON.stringify({ invalid: 'structure' }),
    )

    await expect(runUninstall('test-harness', projectDir)).rejects.toThrow('process.exit(1)')
  })
})
