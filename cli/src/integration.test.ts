import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── Module mocks (must be top-level, vitest hoists these) ─────────────────────

vi.mock('./logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('@clack/prompts', () => ({
  multiselect: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const mockIsDockerAvailable = vi.fn()
const mockGetDockerImageHash = vi.fn()
const mockRunBenchmarkInDocker = vi.fn()

vi.mock('./runner/docker.js', () => ({
  isDockerAvailable: () => mockIsDockerAvailable(),
  getDockerImageHash: (imageName: string) => mockGetDockerImageHash(imageName),
  runBenchmarkInDocker: (
    opts: unknown,
    onProgress: (p: { completed: number; total: number }) => void,
  ) => mockRunBenchmarkInDocker(opts, onProgress),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { runInstall } from './commands/install.js'
import { runUninstall } from './commands/uninstall.js'
import { runList } from './commands/list.js'
import { runRecommend } from './commands/recommend.js'
import { runBenchmark } from './commands/benchmark.js'
import { computeFileChecksum } from './installer/checksum.js'
import { ManifestSchema } from './schema.js'
import { Command } from 'commander'
import { createListCommand } from './commands/list.js'
import { createRecommendCommand } from './commands/recommend.js'
import { createInstallCommand } from './commands/install.js'
import { createUninstallCommand } from './commands/uninstall.js'
import { createBenchmarkCommand } from './commands/benchmark.js'

// ── Shared helpers ────────────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
  return stat(p)
    .then(() => true)
    .catch(() => false)
}

function makeManifest(overrides: {
  name: string
  agent: string
  version?: string
  files?: Record<string, string>
  benchmarks?: Array<{
    suite: string
    model: string
    model_version: string
    pass_rate: number
    total_tokens: number
    avg_time_sec: number
    run_date: string
    docker_image_hash: string
    checksum: string
  }>
}): Record<string, unknown> {
  return {
    name: overrides.name,
    version: overrides.version ?? '1.0.0',
    agent: overrides.agent,
    description: `${overrides.name} harness`,
    published_at: '2026-04-01',
    tags: {
      languages: ['typescript'],
      frameworks: ['any'],
      scale: ['solo'],
      style: ['tdd'],
    },
    files: overrides.files,
    benchmarks: overrides.benchmarks,
  }
}

async function createRegistryHarness(
  registryRoot: string,
  manifest: Record<string, unknown>,
  sourceFiles: Record<string, string> = {},
): Promise<void> {
  const agent = manifest['agent'] as string
  const name = manifest['name'] as string
  const harnessDir = join(registryRoot, agent, name)
  await mkdir(harnessDir, { recursive: true })
  await writeFile(join(harnessDir, 'manifest.json'), JSON.stringify(manifest))
  for (const [relPath, content] of Object.entries(sourceFiles)) {
    const abs = join(harnessDir, relPath)
    await mkdir(join(abs, '..'), { recursive: true })
    await writeFile(abs, content)
  }
}

// ── Global setup / teardown ───────────────────────────────────────────────────

let registryRoot: string
let projectDir: string
let output: string

beforeEach(async () => {
  registryRoot = await mkdtemp(join(tmpdir(), 'gobbi-int-reg-'))
  projectDir = await mkdtemp(join(tmpdir(), 'gobbi-int-proj-'))
  output = ''

  vi.spyOn(process.stdout, 'write').mockImplementation(
    ((chunk: string | Uint8Array) => {
      output += typeof chunk === 'string' ? chunk : chunk.toString()
      return true
    }) as typeof process.stdout.write,
  )

  vi.spyOn(process, 'exit').mockImplementation(
    ((_code?: string | number | null) => {
      throw new Error(`process.exit(${_code ?? 0})`)
    }) as typeof process.exit,
  )

  mockIsDockerAvailable.mockResolvedValue(true)
  mockGetDockerImageHash.mockResolvedValue('sha256:deadbeef0123456789')
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  await Promise.all([
    rm(registryRoot, { recursive: true, force: true }),
    rm(projectDir, { recursive: true, force: true }),
  ]).catch(() => undefined)
})

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: install → uninstall 전체 사이클
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 1: install → uninstall cycle', () => {
  describe('1-A: 깨끗한 프로젝트 설치 후 완전 제거', () => {
    it('install creates files and lock; uninstall removes everything', async () => {
      await createRegistryHarness(
        registryRoot,
        makeManifest({
          name: 'test-harness',
          agent: 'claude-code',
          files: { claude_md: 'CLAUDE.md', skills: 'skills' },
        }),
        {
          'CLAUDE.md': '# Harness Claude',
          'skills/commit.md': '# Commit skill',
          'skills/review.md': '# Review skill',
        },
      )

      await runInstall(
        'test-harness',
        { all: true },
        registryRoot,
        projectDir,
      )

      // Verify install
      expect(await fileExists(join(projectDir, '.gobbi-lock.json'))).toBe(true)
      expect(await fileExists(join(projectDir, 'CLAUDE.md'))).toBe(true)
      expect(await fileExists(join(projectDir, 'skills', 'commit.md'))).toBe(true)
      expect(await fileExists(join(projectDir, 'skills', 'review.md'))).toBe(true)

      await runUninstall('test-harness', projectDir)

      // Verify uninstall
      expect(await fileExists(join(projectDir, 'CLAUDE.md'))).toBe(false)
      expect(await fileExists(join(projectDir, 'skills', 'commit.md'))).toBe(false)
      expect(await fileExists(join(projectDir, 'skills', 'review.md'))).toBe(false)
      expect(await fileExists(join(projectDir, 'skills'))).toBe(false)
      expect(await fileExists(join(projectDir, '.gobbi-lock.json'))).toBe(false)
    })
  })

  describe('1-B: merge 설치 후 원본 복원', () => {
    it('merge install preserves original; uninstall restores it', async () => {
      const originalContent = '# My original CLAUDE.md'
      await writeFile(join(projectDir, 'CLAUDE.md'), originalContent)

      await createRegistryHarness(
        registryRoot,
        makeManifest({
          name: 'merge-harness',
          agent: 'claude-code',
          files: { claude_md: 'CLAUDE.md' },
        }),
        { 'CLAUDE.md': '# Harness additions' },
      )

      // Mock conflict resolution to select 'merge'
      const { select } = await import('@clack/prompts')
      vi.mocked(select).mockResolvedValueOnce('m')

      await runInstall(
        'merge-harness',
        { all: true },
        registryRoot,
        projectDir,
      )

      // Verify strategy=merge in lock
      const lockRaw = await readFile(
        join(projectDir, '.gobbi-lock.json'),
        'utf-8',
      )
      const lock = JSON.parse(lockRaw) as {
        files: Array<Record<string, unknown>>
      }
      const claudeEntry = lock.files.find(
        (f) => f['path'] === 'CLAUDE.md',
      )
      expect(claudeEntry?.['strategy']).toBe('merge')
      expect(claudeEntry?.['original_checksum']).toBeDefined()

      // Verify backup exists
      expect(
        await fileExists(join(projectDir, '.gobbi', 'backups', 'CLAUDE.md')),
      ).toBe(true)

      // Verify merged content has both parts
      const mergedContent = await readFile(
        join(projectDir, 'CLAUDE.md'),
        'utf-8',
      )
      expect(mergedContent).toContain(originalContent)
      expect(mergedContent).toContain('# Harness additions')

      await runUninstall('merge-harness', projectDir)

      // Verify restoration
      const restoredContent = await readFile(
        join(projectDir, 'CLAUDE.md'),
        'utf-8',
      )
      expect(restoredContent).toBe(originalContent)

      // Backup deleted
      expect(
        await fileExists(join(projectDir, '.gobbi', 'backups', 'CLAUDE.md')),
      ).toBe(false)

      // Backup dir deleted (empty)
      expect(
        await fileExists(join(projectDir, '.gobbi', 'backups')),
      ).toBe(false)
    })
  })

  describe('1-C: 파일 수정 후 uninstall 경고', () => {
    it('confirm N keeps modified file', async () => {
      await createRegistryHarness(
        registryRoot,
        makeManifest({
          name: 'mod-harness',
          agent: 'claude-code',
          files: { claude_md: 'CLAUDE.md' },
        }),
        { 'CLAUDE.md': '# Harness' },
      )

      await runInstall(
        'mod-harness',
        { all: true },
        registryRoot,
        projectDir,
      )

      // Modify the installed file
      await writeFile(
        join(projectDir, 'CLAUDE.md'),
        '# Modified after install',
      )

      const { confirm } = await import('@clack/prompts')
      vi.mocked(confirm).mockResolvedValueOnce(false) // N → keep

      await runUninstall('mod-harness', projectDir)

      expect(await fileExists(join(projectDir, 'CLAUDE.md'))).toBe(true)
      expect(vi.mocked(confirm)).toHaveBeenCalled()
    })

    it('confirm y deletes modified file', async () => {
      await createRegistryHarness(
        registryRoot,
        makeManifest({
          name: 'mod-harness2',
          agent: 'claude-code',
          files: { claude_md: 'CLAUDE.md' },
        }),
        { 'CLAUDE.md': '# Harness' },
      )

      await runInstall(
        'mod-harness2',
        { all: true },
        registryRoot,
        projectDir,
      )

      await writeFile(join(projectDir, 'CLAUDE.md'), '# Modified')

      const { confirm } = await import('@clack/prompts')
      vi.mocked(confirm).mockResolvedValueOnce(true) // y → delete

      await runUninstall('mod-harness2', projectDir)

      expect(await fileExists(join(projectDir, 'CLAUDE.md'))).toBe(false)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: list → recommend 데이터 일관성
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 2: list → recommend data consistency', () => {
  describe('2-A: 동일 레지스트리 기준 하네스 목록 일치', () => {
    it('list and recommend show the same claude-code harnesses', async () => {
      await createRegistryHarness(
        registryRoot,
        makeManifest({ name: 'alpha-harness', agent: 'claude-code' }),
      )
      await createRegistryHarness(
        registryRoot,
        makeManifest({ name: 'beta-harness', agent: 'claude-code' }),
      )
      await createRegistryHarness(
        registryRoot,
        makeManifest({ name: 'gamma-harness', agent: 'opencode' }),
      )

      // Run list and capture output
      output = ''
      await runList({}, registryRoot)
      const listOutput = output

      // Run recommend --agent claude-code
      output = ''
      await runRecommend({ agent: 'claude-code' }, registryRoot)
      const recommendOutput = output

      // Both should mention the two claude-code harnesses
      for (const name of ['alpha-harness', 'beta-harness']) {
        expect(listOutput).toContain(name)
        expect(recommendOutput).toContain(name)
      }

      // opencode harness should only appear in list, not in --agent claude-code recommend
      expect(listOutput).toContain('gamma-harness')
      expect(recommendOutput).not.toContain('gamma-harness')
    })
  })

  describe('2-B: 파싱 실패 harness의 동일한 건너뜀', () => {
    it('both list and recommend skip invalid manifest with warn', async () => {
      const agent = 'claude-code'
      await createRegistryHarness(
        registryRoot,
        makeManifest({ name: 'valid-harness', agent }),
      )

      // Write an invalid manifest (missing published_at)
      const invalidDir = join(registryRoot, agent, 'invalid-harness')
      await mkdir(invalidDir, { recursive: true })
      await writeFile(
        join(invalidDir, 'manifest.json'),
        JSON.stringify({
          name: 'invalid-harness',
          version: '1.0.0',
          agent,
        }),
      )

      const { warn } = await import('./logger.js')

      output = ''
      await runList({}, registryRoot)
      const listOutput = output
      const listWarnCount = vi.mocked(warn).mock.calls.length

      vi.clearAllMocks()

      output = ''
      await runRecommend({ agent }, registryRoot)
      const recommendOutput = output
      const recommendWarnCount = vi.mocked(warn).mock.calls.length

      // Both show valid harness
      expect(listOutput).toContain('valid-harness')
      expect(recommendOutput).toContain('valid-harness')

      // Both skip invalid harness
      expect(listOutput).not.toContain('invalid-harness')
      expect(recommendOutput).not.toContain('invalid-harness')

      // Both log a warning
      expect(listWarnCount).toBeGreaterThan(0)
      expect(recommendWarnCount).toBeGreaterThan(0)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: benchmark 결과 → recommend 출력 연결
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 3: benchmark result structure', () => {
  const dockerHash = 'sha256:abc123def456abc123def456abc123def456abc123def456abc123def456abc1'
  const sampleRaw = {
    tasks: [
      { id: 't01', passed: true, tokens: 5000, time_sec: 30 },
      { id: 't02', passed: true, tokens: 4000, time_sec: 25 },
      { id: 't03', passed: false, tokens: 6000, time_sec: 40 },
      { id: 't04', passed: true, tokens: 3000, time_sec: 20 },
      { id: 't05', passed: true, tokens: 5500, time_sec: 35 },
      { id: 't06', passed: false, tokens: 4500, time_sec: 28 },
      { id: 't07', passed: true, tokens: 6500, time_sec: 45 },
      { id: 't08', passed: true, tokens: 3500, time_sec: 22 },
      { id: 't09', passed: true, tokens: 7000, time_sec: 50 },
      { id: 't10', passed: false, tokens: 4000, time_sec: 30 },
      { id: 't11', passed: true, tokens: 5000, time_sec: 32 },
      { id: 't12', passed: false, tokens: 4800, time_sec: 38 },
      { id: 't13', passed: true, tokens: 3200, time_sec: 21 },
      { id: 't14', passed: true, tokens: 5600, time_sec: 37 },
      { id: 't15', passed: false, tokens: 4100, time_sec: 29 },
      { id: 't16', passed: true, tokens: 6800, time_sec: 48 },
      { id: 't17', passed: true, tokens: 3900, time_sec: 24 },
      { id: 't18', passed: true, tokens: 5200, time_sec: 33 },
      { id: 't19', passed: false, tokens: 4300, time_sec: 31 },
      { id: 't20', passed: true, tokens: 5800, time_sec: 39 },
    ],
    model_version: '2026-03-01',
    execution_log: 'log content for hash',
  }

  describe('3-A: 결과 JSON 구조가 ManifestSchema benchmarks[] 항목과 호환', () => {
    it('result JSON can be parsed by ManifestSchema benchmark entry schema', async () => {
      await createRegistryHarness(
        registryRoot,
        makeManifest({ name: 'bench-harness', agent: 'claude-code' }),
      )

      mockGetDockerImageHash.mockResolvedValue(dockerHash)
      mockRunBenchmarkInDocker.mockImplementation(
        async (
          _opts: unknown,
          onProgress: (p: { completed: number; total: number }) => void,
        ) => {
          sampleRaw.tasks.forEach((_, i) =>
            onProgress({ completed: i + 1, total: 20 }),
          )
          return { raw: sampleRaw, dockerImageHash: dockerHash }
        },
      )

      await runBenchmark('bench-harness', registryRoot, projectDir)

      const resultPath = join(
        projectDir,
        'benchmarks',
        'results',
        'claude-code',
        'bench-harness.json',
      )
      expect(await fileExists(resultPath)).toBe(true)

      const resultContent = JSON.parse(
        await readFile(resultPath, 'utf-8'),
      ) as Record<string, unknown>

      // Check required fields
      expect(typeof resultContent['suite']).toBe('string')
      expect(typeof resultContent['model']).toBe('string')
      expect(typeof resultContent['model_version']).toBe('string')
      expect(typeof resultContent['pass_rate']).toBe('number')
      expect(resultContent['pass_rate'] as number).toBeGreaterThanOrEqual(0)
      expect(resultContent['pass_rate'] as number).toBeLessThanOrEqual(1)
      expect(typeof resultContent['total_tokens']).toBe('number')
      expect(typeof resultContent['avg_time_sec']).toBe('number')
      expect(resultContent['run_date']).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(resultContent['docker_image_hash']).toMatch(/^sha256:/)
      expect(resultContent['checksum']).toMatch(/^sha256:[0-9a-f]{64}$/)

      // Validate against ManifestSchema benchmark entry schema
      const benchmarkEntrySchema =
        ManifestSchema.shape.benchmarks.unwrap().element
      expect(() => benchmarkEntrySchema.parse(resultContent)).not.toThrow()
    })
  })

  describe('3-B: manifest에 결과 반영 후 recommend 정렬', () => {
    it('ranked harnesses sorted by pass_rate descending', async () => {
      const benchmarkEntry = (passRate: number): object => ({
        suite: 'swe-bench-pro-mini',
        model: 'claude-sonnet-4-6',
        model_version: '2026-03-01',
        pass_rate: passRate,
        total_tokens: 1_000_000,
        avg_time_sec: 100,
        run_date: '2026-04-01',
        docker_image_hash: 'sha256:' + 'a'.repeat(64),
        checksum: 'sha256:' + 'b'.repeat(64),
      })

      await createRegistryHarness(
        registryRoot,
        makeManifest({
          name: 'harness-a',
          agent: 'claude-code',
          benchmarks: [benchmarkEntry(0.80) as Parameters<typeof makeManifest>[0]['benchmarks'] extends Array<infer T> ? T : never],
        }),
      )
      await createRegistryHarness(
        registryRoot,
        makeManifest({
          name: 'harness-b',
          agent: 'claude-code',
          benchmarks: [benchmarkEntry(0.60) as Parameters<typeof makeManifest>[0]['benchmarks'] extends Array<infer T> ? T : never],
        }),
      )

      output = ''
      await runRecommend({ agent: 'claude-code', sort: 'pass_rate' }, registryRoot)

      // harness-a (80%) should appear before harness-b (60%)
      const posA = output.indexOf('harness-a')
      const posB = output.indexOf('harness-b')
      expect(posA).toBeGreaterThan(-1)
      expect(posB).toBeGreaterThan(-1)
      expect(posA).toBeLessThan(posB)

      // Neither should be in the unranked section
      const unrankedIdx = output.indexOf('Unranked')
      if (unrankedIdx !== -1) {
        expect(output.indexOf('harness-a')).toBeLessThan(unrankedIdx)
        expect(output.indexOf('harness-b')).toBeLessThan(unrankedIdx)
      }
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: 공통 모듈 일관성
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 4: common module consistency', () => {
  describe('4-A: loadManifests() 레지스트리 경로 일관성', () => {
    it('all commands recognize harness from GOBBI_REGISTRY', async () => {
      await createRegistryHarness(
        registryRoot,
        makeManifest({
          name: 'env-harness',
          agent: 'claude-code',
          files: { claude_md: 'CLAUDE.md' },
        }),
        { 'CLAUDE.md': '# Env harness' },
      )

      // list: should find harness
      output = ''
      await runList({}, registryRoot)
      expect(output).toContain('env-harness')

      // recommend: should find harness
      output = ''
      await runRecommend({ agent: 'claude-code' }, registryRoot)
      expect(output).toContain('env-harness')

      // install: should find harness
      await runInstall(
        'env-harness',
        { all: true },
        registryRoot,
        projectDir,
      )
      expect(await fileExists(join(projectDir, 'CLAUDE.md'))).toBe(true)
      await runUninstall('env-harness', projectDir)

      // benchmark: should find harness
      mockRunBenchmarkInDocker.mockImplementation(
        async (
          _opts: unknown,
          onProgress: (p: { completed: number; total: number }) => void,
        ) => {
          onProgress({ completed: 1, total: 1 })
          return {
            raw: {
              tasks: [{ id: 't1', passed: true, tokens: 1000, time_sec: 10 }],
              model_version: '2026-03-01',
              execution_log: 'log',
            },
            dockerImageHash: 'sha256:deadbeef',
          }
        },
      )

      await expect(
        runBenchmark('env-harness', registryRoot, projectDir),
      ).resolves.not.toThrow()

      expect(
        await fileExists(
          join(projectDir, 'benchmarks', 'results', 'claude-code', 'env-harness.json'),
        ),
      ).toBe(true)
    })
  })

  describe('4-B: install 체크섬 ↔ uninstall 비교 일관성', () => {
    it('lock checksum matches installed file; changes are detected', async () => {
      await createRegistryHarness(
        registryRoot,
        makeManifest({
          name: 'chk-harness',
          agent: 'claude-code',
          files: { claude_md: 'CLAUDE.md' },
        }),
        { 'CLAUDE.md': '# Checksum test' },
      )

      await runInstall(
        'chk-harness',
        { all: true },
        registryRoot,
        projectDir,
      )

      const lockRaw = JSON.parse(
        await readFile(join(projectDir, '.gobbi-lock.json'), 'utf-8'),
      ) as { files: Array<{ path: string; checksum: string }> }

      const entry = lockRaw.files.find((f) => f.path === 'CLAUDE.md')
      expect(entry).toBeDefined()

      const installedPath = join(projectDir, 'CLAUDE.md')

      // Lock checksum === computeFileChecksum of installed file
      const liveChecksum = await computeFileChecksum(installedPath)
      expect(entry!.checksum).toBe(liveChecksum)

      // Modify file
      await writeFile(installedPath, '# Modified content after install')

      const modifiedChecksum = await computeFileChecksum(installedPath)
      expect(modifiedChecksum).not.toBe(entry!.checksum)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5: CLI 엔트리포인트 통합
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 5: CLI entry point', () => {
  function buildProgram(): Command {
    const p = new Command()
    p.name('gobbi').version('0.1.0').description('test')
    p.addCommand(createListCommand())
    p.addCommand(createRecommendCommand())
    p.addCommand(createInstallCommand())
    p.addCommand(createUninstallCommand())
    p.addCommand(createBenchmarkCommand())
    return p
  }

  it('5-A: --help에 5개 커맨드 (list, recommend, install, uninstall, benchmark) 포함', () => {
    const program = buildProgram()
    const names = program.commands.map((c) => c.name())
    for (const name of ['list', 'recommend', 'install', 'uninstall', 'benchmark']) {
      expect(names).toContain(name)
    }
  })

  it('5-B: 알 수 없는 커맨드 → 에러', async () => {
    const program = buildProgram()
    vi.spyOn(process.stderr, 'write').mockImplementation(
      (() => true) as typeof process.stderr.write,
    )
    await expect(
      program.parseAsync(['node', 'gobbi', 'foobar']),
    ).rejects.toThrow()
  })

  it('5-C: --version 출력이 semver 형식', () => {
    const program = buildProgram()
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/)
  })
})
