import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { computeStringChecksum } from '../installer/checksum.js'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

// Keep plain vi.fn() refs so we can control them in tests
const mockIsDockerAvailable = vi.fn()
const mockGetDockerImageHash = vi.fn()
const mockRunBenchmarkInDocker = vi.fn()

vi.mock('../runner/docker.js', () => ({
  isDockerAvailable: () => mockIsDockerAvailable(),
  getDockerImageHash: (imageName: string) => mockGetDockerImageHash(imageName),
  runBenchmarkInDocker: (
    opts: unknown,
    onProgress: (p: { completed: number; total: number }) => void,
  ) => mockRunBenchmarkInDocker(opts, onProgress),
}))

const mockLoadManifests = vi.fn()
vi.mock('../registry.js', () => ({
  loadManifests: (registryRoot?: string) => mockLoadManifests(registryRoot),
}))

import { runBenchmark } from './benchmark.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const executionLog = 'PROGRESS 1/3\nPROGRESS 2/3\nPROGRESS 3/3\n'

const sampleRaw = {
  tasks: [
    { id: 't1', passed: true, tokens: 1000, time_sec: 10 },
    { id: 't2', passed: true, tokens: 2000, time_sec: 20 },
    { id: 't3', passed: false, tokens: 3000, time_sec: 30 },
  ],
  model_version: '2026-03-01',
  execution_log: executionLog,
}

const dockerImageHash = 'sha256:abc123def456'

const sampleManifest = {
  name: 'test-harness',
  version: '1.0.0',
  agent: 'claude-code',
  description: 'Test harness',
  published_at: '2026-01-01',
  tags: { languages: [], frameworks: [], scale: [], style: [] },
  benchmarks: [],
}

async function fileExists(p: string): Promise<boolean> {
  return stat(p)
    .then(() => true)
    .catch(() => false)
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let projectDir: string

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'gobbi-benchmark-'))

  vi.spyOn(process.stdout, 'write').mockImplementation(
    ((_chunk: string | Uint8Array) => true) as typeof process.stdout.write,
  )

  vi.spyOn(process, 'exit').mockImplementation(
    ((_code?: string | number | null) => {
      throw new Error(`process.exit(${_code ?? 0})`)
    }) as typeof process.exit,
  )

  mockIsDockerAvailable.mockResolvedValue(true)
  mockGetDockerImageHash.mockResolvedValue(dockerImageHash)
  mockRunBenchmarkInDocker.mockImplementation(
    async (
      _opts: unknown,
      onProgress: (p: { completed: number; total: number }) => void,
    ) => {
      onProgress({ completed: 1, total: 3 })
      onProgress({ completed: 2, total: 3 })
      onProgress({ completed: 3, total: 3 })
      return { raw: sampleRaw, dockerImageHash }
    },
  )
  mockLoadManifests.mockResolvedValue([sampleManifest])
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  await rm(projectDir, { recursive: true, force: true }).catch(() => undefined)
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runBenchmark', () => {
  it('1. 정상 실행 → 결과 파일 생성됨', async () => {
    await runBenchmark('test-harness', undefined, projectDir)

    const resultPath = join(
      projectDir,
      'benchmarks',
      'results',
      'claude-code',
      'test-harness.json',
    )
    expect(await fileExists(resultPath)).toBe(true)
  })

  it('2. 결과 파일에 docker_image_hash, checksum, submitted_by: "self" 포함', async () => {
    await runBenchmark('test-harness', undefined, projectDir)

    const resultPath = join(
      projectDir,
      'benchmarks',
      'results',
      'claude-code',
      'test-harness.json',
    )
    const content = JSON.parse(await readFile(resultPath, 'utf-8')) as Record<
      string,
      unknown
    >

    expect(content['docker_image_hash']).toBe(dockerImageHash)
    expect(typeof content['checksum']).toBe('string')
    expect(content['submitted_by']).toBe('self')
  })

  it('3. checksum이 execution_log의 SHA-256과 일치', async () => {
    await runBenchmark('test-harness', undefined, projectDir)

    const resultPath = join(
      projectDir,
      'benchmarks',
      'results',
      'claude-code',
      'test-harness.json',
    )
    const content = JSON.parse(await readFile(resultPath, 'utf-8')) as Record<
      string,
      unknown
    >

    const expected = computeStringChecksum(executionLog)
    expect(content['checksum']).toBe(expected)
  })

  it('4. run_date가 오늘 날짜 (YYYY-MM-DD)', async () => {
    await runBenchmark('test-harness', undefined, projectDir)

    const resultPath = join(
      projectDir,
      'benchmarks',
      'results',
      'claude-code',
      'test-harness.json',
    )
    const content = JSON.parse(await readFile(resultPath, 'utf-8')) as Record<
      string,
      unknown
    >

    const today = new Date().toISOString().slice(0, 10)
    expect(content['run_date']).toBe(today)
  })

  it('5. 결과 파일 경로: benchmarks/results/<agent>/<harness>.json', async () => {
    await runBenchmark('test-harness', undefined, projectDir)

    const expectedPath = join(
      projectDir,
      'benchmarks',
      'results',
      'claude-code',
      'test-harness.json',
    )
    expect(await fileExists(expectedPath)).toBe(true)
  })

  it('6. 출력 디렉토리 없으면 자동 생성', async () => {
    await runBenchmark('test-harness', undefined, projectDir)

    const dir = join(projectDir, 'benchmarks', 'results', 'claude-code')
    expect(await fileExists(dir)).toBe(true)
  })

  it('7. 기존 결과 파일 있으면 덮어쓰기', async () => {
    await runBenchmark('test-harness', undefined, projectDir)

    const newLog = 'different log content'
    mockRunBenchmarkInDocker.mockImplementation(
      async (
        _opts: unknown,
        onProgress: (p: { completed: number; total: number }) => void,
      ) => {
        onProgress({ completed: 1, total: 1 })
        return {
          raw: { ...sampleRaw, execution_log: newLog },
          dockerImageHash,
        }
      },
    )

    await runBenchmark('test-harness', undefined, projectDir)

    const resultPath = join(
      projectDir,
      'benchmarks',
      'results',
      'claude-code',
      'test-harness.json',
    )
    const content = JSON.parse(await readFile(resultPath, 'utf-8')) as Record<
      string,
      unknown
    >
    expect(content['checksum']).toBe(computeStringChecksum(newLog))
  })

  it('8. isDockerAvailable false → exit code 1', async () => {
    mockIsDockerAvailable.mockResolvedValue(false)

    await expect(
      runBenchmark('test-harness', undefined, projectDir),
    ).rejects.toThrow('process.exit(1)')
  })

  it('9. getDockerImageHash throw → exit code 1', async () => {
    mockGetDockerImageHash.mockRejectedValue(
      new Error('gobbi-runner image not found'),
    )

    await expect(
      runBenchmark('test-harness', undefined, projectDir),
    ).rejects.toThrow('process.exit(1)')
  })

  it('10. harness 레지스트리에 없음 → exit code 1', async () => {
    mockLoadManifests.mockResolvedValue([])

    await expect(
      runBenchmark('unknown-harness', undefined, projectDir),
    ).rejects.toThrow('process.exit(1)')
  })

  it('11. onProgress 호출 횟수가 완료 task 수와 일치', async () => {
    const captured: Array<{ completed: number; total: number }> = []

    mockRunBenchmarkInDocker.mockImplementation(
      async (
        _opts: unknown,
        onProgress: (p: { completed: number; total: number }) => void,
      ) => {
        for (let i = 1; i <= 5; i++) {
          const progress = { completed: i, total: 5 }
          onProgress(progress)
          captured.push(progress)
        }
        return { raw: sampleRaw, dockerImageHash }
      },
    )

    await runBenchmark('test-harness', undefined, projectDir)

    expect(captured).toHaveLength(5)
    expect(captured[4]).toEqual({ completed: 5, total: 5 })
  })
})
