import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runInstall } from './install.js'

vi.mock('../logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('@clack/prompts', () => ({
  multiselect: vi.fn(),
  select: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseManifest = {
  name: 'test-harness',
  version: '1.0.0',
  agent: 'claude-code',
  description: 'Test harness',
  published_at: '2026-04-01',
  tags: { languages: ['typescript'], frameworks: ['any'], scale: ['solo'], style: ['tdd'] },
}

async function createRegistryHarness(
  registryRoot: string,
  manifest: Record<string, unknown>,
  files: Record<string, string>, // relative path → content
): Promise<void> {
  const m = manifest as typeof baseManifest & { files?: Record<string, string> }
  const harnessDir = join(registryRoot, m.agent, m.name)
  await mkdir(harnessDir, { recursive: true })
  await writeFile(join(harnessDir, 'manifest.json'), JSON.stringify(manifest))
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = join(harnessDir, relPath)
    await mkdir(join(absPath, '..'), { recursive: true })
    await writeFile(absPath, content)
  }
}

// ── Test setup ────────────────────────────────────────────────────────────────

let registryDir: string
let projectDir: string

beforeEach(async () => {
  registryDir = await mkdtemp(join(tmpdir(), 'gobbi-reg-'))
  projectDir = await mkdtemp(join(tmpdir(), 'gobbi-proj-'))
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
  await Promise.all([
    rm(registryDir, { recursive: true, force: true }),
    rm(projectDir, { recursive: true, force: true }),
  ]).catch(() => undefined)
})

async function readLock(dir: string): Promise<Record<string, unknown>> {
  const content = await readFile(join(dir, '.gobbi-lock.json'), 'utf-8')
  return JSON.parse(content) as Record<string, unknown>
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runInstall', () => {
  it('1. 파일 없음 → 직접 설치, lock에 strategy: overwrite', async () => {
    await createRegistryHarness(
      registryDir,
      { ...baseManifest, files: { claude_md: './CLAUDE.md' } },
      { 'CLAUDE.md': '# Harness' },
    )
    const { multiselect } = await import('@clack/prompts')
    vi.mocked(multiselect).mockResolvedValueOnce(['claude_md'])

    await runInstall('test-harness', {}, registryDir, projectDir)

    const content = await readFile(join(projectDir, 'CLAUDE.md'), 'utf-8')
    expect(content).toBe('# Harness')

    const lock = await readLock(projectDir)
    const files = lock['files'] as Array<Record<string, unknown>>
    expect(files[0]!['strategy']).toBe('overwrite')
  })

  it('2. --all → 체크리스트 없이 전체 설치 (충돌 없는 경우)', async () => {
    await createRegistryHarness(
      registryDir,
      { ...baseManifest, files: { claude_md: './CLAUDE.md', mcp: './mcp.json' } },
      { 'CLAUDE.md': '# Harness', 'mcp.json': '{"key":"value"}' },
    )
    const { multiselect } = await import('@clack/prompts')

    await runInstall('test-harness', { all: true }, registryDir, projectDir)

    expect(vi.mocked(multiselect)).not.toHaveBeenCalled()
    expect(await readFile(join(projectDir, 'CLAUDE.md'), 'utf-8')).toBe('# Harness')
    expect(await readFile(join(projectDir, 'mcp.json'), 'utf-8')).toBe('{"key":"value"}')
  })

  it('2a. --all + 기존 파일 존재 → 충돌 프롬프트 표시됨, overwrite 선택', async () => {
    await createRegistryHarness(
      registryDir,
      { ...baseManifest, files: { claude_md: './CLAUDE.md' } },
      { 'CLAUDE.md': '# New Harness' },
    )
    await writeFile(join(projectDir, 'CLAUDE.md'), '# Old Content')

    const { select } = await import('@clack/prompts')
    vi.mocked(select).mockResolvedValueOnce('o')  // overwrite

    await runInstall('test-harness', { all: true }, registryDir, projectDir)

    const content = await readFile(join(projectDir, 'CLAUDE.md'), 'utf-8')
    expect(content).toBe('# New Harness')
  })

  it('3. --only claude_md → 해당 컴포넌트만 설치', async () => {
    await createRegistryHarness(
      registryDir,
      { ...baseManifest, files: { claude_md: './CLAUDE.md', mcp: './mcp.json' } },
      { 'CLAUDE.md': '# Harness', 'mcp.json': '{"k":"v"}' },
    )

    await runInstall('test-harness', { only: 'claude_md' }, registryDir, projectDir)

    expect(await readFile(join(projectDir, 'CLAUDE.md'), 'utf-8')).toBe('# Harness')
    await expect(readFile(join(projectDir, 'mcp.json'), 'utf-8')).rejects.toThrow()
  })

  it('4. --only와 --all 동시 → exit code 1', async () => {
    await expect(
      runInstall('test-harness', { only: 'claude_md', all: true }, registryDir, projectDir),
    ).rejects.toThrow('process.exit(1)')
  })

  it('5. --only에 없는 키 → exit code 1', async () => {
    await createRegistryHarness(
      registryDir,
      { ...baseManifest, files: { claude_md: './CLAUDE.md' } },
      { 'CLAUDE.md': '# Harness' },
    )
    await expect(
      runInstall('test-harness', { only: 'nonexistent_key' }, registryDir, projectDir),
    ).rejects.toThrow('process.exit(1)')
  })

  it('6. 충돌 overwrite → 파일 교체, lock checksum이 설치 후 파일과 일치', async () => {
    await createRegistryHarness(
      registryDir,
      { ...baseManifest, files: { claude_md: './CLAUDE.md' } },
      { 'CLAUDE.md': '# New Content' },
    )
    await writeFile(join(projectDir, 'CLAUDE.md'), '# Old Content')

    const { select } = await import('@clack/prompts')
    vi.mocked(select).mockResolvedValueOnce('o')

    await runInstall('test-harness', { all: true }, registryDir, projectDir)

    const installedContent = await readFile(join(projectDir, 'CLAUDE.md'), 'utf-8')
    expect(installedContent).toBe('# New Content')

    const lock = await readLock(projectDir)
    const files = lock['files'] as Array<Record<string, unknown>>
    expect(files[0]!['strategy']).toBe('overwrite')
    expect(files[0]!['checksum']).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('7. 충돌 skip → 파일 불변, lock에 해당 파일 없음', async () => {
    await createRegistryHarness(
      registryDir,
      { ...baseManifest, files: { claude_md: './CLAUDE.md' } },
      { 'CLAUDE.md': '# Incoming' },
    )
    await writeFile(join(projectDir, 'CLAUDE.md'), '# Kept')

    const { select } = await import('@clack/prompts')
    vi.mocked(select).mockResolvedValueOnce('s')

    await runInstall('test-harness', { all: true }, registryDir, projectDir)

    expect(await readFile(join(projectDir, 'CLAUDE.md'), 'utf-8')).toBe('# Kept')
    const lock = await readLock(projectDir)
    const files = lock['files'] as Array<Record<string, unknown>>
    expect(files).toHaveLength(0)
  })

  it('8. 충돌 merge .md → 구분선 포함 결과, lock에 original_checksum 있음', async () => {
    await createRegistryHarness(
      registryDir,
      { ...baseManifest, files: { claude_md: './CLAUDE.md' } },
      { 'CLAUDE.md': '# Incoming' },
    )
    await writeFile(join(projectDir, 'CLAUDE.md'), '# Existing')

    const { select } = await import('@clack/prompts')
    vi.mocked(select).mockResolvedValueOnce('m')

    await runInstall('test-harness', { all: true }, registryDir, projectDir)

    const result = await readFile(join(projectDir, 'CLAUDE.md'), 'utf-8')
    expect(result).toContain('# Existing')
    expect(result).toContain('# Incoming')
    expect(result).toContain('---')

    const lock = await readLock(projectDir)
    const files = lock['files'] as Array<Record<string, unknown>>
    expect(files[0]!['strategy']).toBe('merge')
    expect(files[0]!['original_checksum']).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('9. 충돌 merge .json → shallow merge 결과 파일', async () => {
    await createRegistryHarness(
      registryDir,
      { ...baseManifest, files: { mcp: './mcp.json' } },
      { 'mcp.json': '{"newKey":"newVal","sharedKey":"incoming"}' },
    )
    await writeFile(join(projectDir, 'mcp.json'), '{"existingKey":"existVal","sharedKey":"existing"}')

    const { select } = await import('@clack/prompts')
    vi.mocked(select)
      .mockResolvedValueOnce('m')     // conflict: merge
      .mockResolvedValueOnce('keep')  // JSON key conflict: keep existing

    await runInstall('test-harness', { all: true }, registryDir, projectDir)

    const result = JSON.parse(await readFile(join(projectDir, 'mcp.json'), 'utf-8')) as Record<string, unknown>
    expect(result['existingKey']).toBe('existVal')    // existing-only key preserved
    expect(result['newKey']).toBe('newVal')            // incoming-only key added
    expect(result['sharedKey']).toBe('existing')       // conflict: kept existing
  })

  it('10. merge 후 .gobbi/backups/ 에 원본 파일 존재', async () => {
    await createRegistryHarness(
      registryDir,
      { ...baseManifest, files: { claude_md: './CLAUDE.md' } },
      { 'CLAUDE.md': '# Incoming' },
    )
    await writeFile(join(projectDir, 'CLAUDE.md'), '# Original')

    const { select } = await import('@clack/prompts')
    vi.mocked(select).mockResolvedValueOnce('m')

    await runInstall('test-harness', { all: true }, registryDir, projectDir)

    const backupContent = await readFile(join(projectDir, '.gobbi', 'backups', 'CLAUDE.md'), 'utf-8')
    expect(backupContent).toBe('# Original')
  })

  it('11. 0개 선택 → exit code 0, 파일 변경 없음', async () => {
    await createRegistryHarness(
      registryDir,
      { ...baseManifest, files: { claude_md: './CLAUDE.md' } },
      { 'CLAUDE.md': '# Harness' },
    )
    const { multiselect } = await import('@clack/prompts')
    vi.mocked(multiselect).mockResolvedValueOnce([])

    await expect(
      runInstall('test-harness', {}, registryDir, projectDir),
    ).rejects.toThrow('process.exit(0)')

    await expect(readFile(join(projectDir, 'CLAUDE.md'), 'utf-8')).rejects.toThrow()
  })

  it('12. harness 없음 → exit code 1', async () => {
    await createRegistryHarness(
      registryDir,
      { ...baseManifest, files: { claude_md: './CLAUDE.md' } },
      { 'CLAUDE.md': '# Harness' },
    )
    await expect(
      runInstall('nonexistent-harness', { all: true }, registryDir, projectDir),
    ).rejects.toThrow('process.exit(1)')
  })

  it('13. 다른 harness lock 존재 → exit code 1', async () => {
    await createRegistryHarness(
      registryDir,
      { ...baseManifest, files: { claude_md: './CLAUDE.md' } },
      { 'CLAUDE.md': '# Harness' },
    )
    const existingLock = {
      harness: 'other-harness',
      agent: 'claude-code',
      version: '1.0.0',
      installed_at: '2026-04-01T00:00:00Z',
      files: [],
    }
    await writeFile(join(projectDir, '.gobbi-lock.json'), JSON.stringify(existingLock))

    await expect(
      runInstall('test-harness', { all: true }, registryDir, projectDir),
    ).rejects.toThrow('process.exit(1)')
  })

  it('14. 동일 harness lock 존재 → 재설치 성공 (lock 덮어쓰기)', async () => {
    await createRegistryHarness(
      registryDir,
      { ...baseManifest, files: { claude_md: './CLAUDE.md' } },
      { 'CLAUDE.md': '# Updated' },
    )
    const existingLock = {
      harness: 'test-harness',
      agent: 'claude-code',
      version: '0.9.0',
      installed_at: '2026-01-01T00:00:00Z',
      files: [],
    }
    await writeFile(join(projectDir, '.gobbi-lock.json'), JSON.stringify(existingLock))

    const { multiselect } = await import('@clack/prompts')
    vi.mocked(multiselect).mockResolvedValueOnce(['claude_md'])

    await runInstall('test-harness', {}, registryDir, projectDir)

    const lock = await readLock(projectDir)
    expect(lock['version']).toBe('1.0.0')
  })

  it('15. 디렉토리 컴포넌트 → 하위 파일 전체 설치, 타겟 디렉토리 자동 생성', async () => {
    await createRegistryHarness(
      registryDir,
      { ...baseManifest, files: { skills: './skills/' } },
      {
        'skills/commit.md': '# Commit skill',
        'skills/review.md': '# Review skill',
      },
    )
    const { multiselect } = await import('@clack/prompts')
    vi.mocked(multiselect).mockResolvedValueOnce(['skills'])

    await runInstall('test-harness', {}, registryDir, projectDir)

    expect(await readFile(join(projectDir, 'skills', 'commit.md'), 'utf-8')).toBe('# Commit skill')
    expect(await readFile(join(projectDir, 'skills', 'review.md'), 'utf-8')).toBe('# Review skill')
  })
})
