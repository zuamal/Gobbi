import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

// Mock child_process before importing the module under test
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

import { spawn } from 'node:child_process'
import {
  isDockerAvailable,
  getDockerImageHash,
  runBenchmarkInDocker,
  type BenchmarkOptions,
} from './docker.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

interface MockChild extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
}

function makeMockChild(): MockChild {
  const child = new EventEmitter() as MockChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

const mockSpawn = vi.mocked(spawn)

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── isDockerAvailable ─────────────────────────────────────────────────────────

describe('isDockerAvailable', () => {
  it('1. spawn 성공 → true', async () => {
    const child = makeMockChild()
    mockSpawn.mockReturnValueOnce(child as ReturnType<typeof spawn>)

    const promise = isDockerAvailable()
    child.emit('close', 0)

    expect(await promise).toBe(true)
  })

  it('2. spawn 실패 (ENOENT) → false', async () => {
    const child = makeMockChild()
    mockSpawn.mockReturnValueOnce(child as ReturnType<typeof spawn>)

    const promise = isDockerAvailable()
    child.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    expect(await promise).toBe(false)
  })
})

// ── getDockerImageHash ────────────────────────────────────────────────────────

describe('getDockerImageHash', () => {
  it('3. docker inspect stdout 파싱 → sha256: 형식 반환', async () => {
    const child = makeMockChild()
    mockSpawn.mockReturnValueOnce(child as ReturnType<typeof spawn>)

    const promise = getDockerImageHash('gobbi-runner')
    child.stdout.emit('data', Buffer.from('sha256:abc123def456\n'))
    child.emit('close', 0)

    const hash = await promise
    expect(hash).toBe('sha256:abc123def456')
  })

  it('4. 이미지 없음 (exit code 1) → Error throw', async () => {
    const child = makeMockChild()
    mockSpawn.mockReturnValueOnce(child as ReturnType<typeof spawn>)

    const promise = getDockerImageHash('gobbi-runner')
    child.stderr.emit('data', Buffer.from('Error: No such image'))
    child.emit('close', 1)

    await expect(promise).rejects.toThrow()
  })
})

// ── runBenchmarkInDocker ──────────────────────────────────────────────────────

const baseOptions: BenchmarkOptions = {
  harnessSrcPath: '/registry/claude-code/test-harness',
  agent: 'claude-code',
  suite: 'swe-bench-pro-mini',
  model: 'claude-sonnet-4-6',
}

const sampleResult = {
  tasks: [
    { id: 't1', passed: true, tokens: 1000, time_sec: 10 },
    { id: 't2', passed: false, tokens: 2000, time_sec: 20 },
  ],
  model_version: '2026-03-01',
  execution_log: 'PROGRESS 1/2\nPROGRESS 2/2\n',
}

function setupInspectAndRun(runChild: MockChild): void {
  // First spawn call is for getDockerImageHash (inside runBenchmarkInDocker)
  const inspectChild = makeMockChild()
  mockSpawn
    .mockReturnValueOnce(inspectChild as ReturnType<typeof spawn>)
    .mockReturnValueOnce(runChild as ReturnType<typeof spawn>)

  // Resolve inspect immediately
  setImmediate(() => {
    inspectChild.stdout.emit('data', Buffer.from('sha256:deadbeef\n'))
    inspectChild.emit('close', 0)
  })
}

describe('runBenchmarkInDocker', () => {
  it('5. PROGRESS n/total 줄 → onProgress 콜백 호출됨', async () => {
    const runChild = makeMockChild()
    setupInspectAndRun(runChild)

    const onProgress = vi.fn()
    const promise = runBenchmarkInDocker(baseOptions, onProgress)

    setImmediate(() => {
      runChild.stdout.emit('data', Buffer.from('PROGRESS 1/5\n'))
      runChild.stdout.emit('data', Buffer.from('PROGRESS 2/5\n'))
      runChild.stdout.emit(
        'data',
        Buffer.from(JSON.stringify(sampleResult) + '\n'),
      )
      runChild.emit('close', 0)
    })

    await promise
    expect(onProgress).toHaveBeenCalledWith({ completed: 1, total: 5 })
    expect(onProgress).toHaveBeenCalledWith({ completed: 2, total: 5 })
  })

  it('6. 마지막 JSON 줄 파싱 → RawBenchmarkResult 반환', async () => {
    const runChild = makeMockChild()
    setupInspectAndRun(runChild)

    const promise = runBenchmarkInDocker(baseOptions, vi.fn())

    setImmediate(() => {
      runChild.stdout.emit('data', Buffer.from('PROGRESS 1/2\n'))
      runChild.stdout.emit(
        'data',
        Buffer.from(JSON.stringify(sampleResult) + '\n'),
      )
      runChild.emit('close', 0)
    })

    const result = await promise
    expect(result.raw.model_version).toBe('2026-03-01')
    expect(result.raw.tasks).toHaveLength(2)
    expect(result.dockerImageHash).toBe('sha256:deadbeef')
  })

  it('7. 컨테이너 exit code ≠ 0 → Error throw', async () => {
    const runChild = makeMockChild()
    setupInspectAndRun(runChild)

    const promise = runBenchmarkInDocker(baseOptions, vi.fn())

    setImmediate(() => {
      runChild.emit('close', 1)
    })

    await expect(promise).rejects.toThrow()
  })

  it('8. harness 경로가 -v 마운트 인자에 포함됨', async () => {
    const runChild = makeMockChild()
    setupInspectAndRun(runChild)

    const promise = runBenchmarkInDocker(baseOptions, vi.fn())

    setImmediate(() => {
      runChild.stdout.emit(
        'data',
        Buffer.from(JSON.stringify(sampleResult) + '\n'),
      )
      runChild.emit('close', 0)
    })

    await promise

    // Second spawn call is the docker run call
    const calls = mockSpawn.mock.calls
    const runCall = calls[1]
    expect(runCall).toBeDefined()
    const args = runCall![1] as string[]
    const mountArg = args.find((a) => a.includes(baseOptions.harnessSrcPath))
    expect(mountArg).toBeDefined()
    expect(mountArg).toContain('/harness:ro')
  })
})
