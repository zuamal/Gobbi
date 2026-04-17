import { describe, it, expect } from 'vitest'
import { computeExecutionChecksum, aggregateResults } from './verify.js'
import type { RawBenchmarkResult } from './docker.js'

function makeResult(overrides?: Partial<RawBenchmarkResult>): RawBenchmarkResult {
  return {
    tasks: [
      { id: 'task-1', passed: true, tokens: 1000, time_sec: 10 },
      { id: 'task-2', passed: false, tokens: 2000, time_sec: 20 },
      { id: 'task-3', passed: true, tokens: 3000, time_sec: 30 },
    ],
    model_version: '2026-03-01',
    execution_log: 'log content here',
    ...overrides,
  }
}

describe('computeExecutionChecksum', () => {
  it('1. 반환값이 sha256: + 64자 hex', () => {
    const result = computeExecutionChecksum('some log')
    expect(result).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('2. 동일 로그 → 동일 체크섬', () => {
    const log = 'identical log content'
    expect(computeExecutionChecksum(log)).toBe(computeExecutionChecksum(log))
  })
})

describe('aggregateResults', () => {
  it('3. pass_rate = passedCount / totalCount', () => {
    const raw = makeResult()
    const agg = aggregateResults(raw)
    // 2 out of 3 passed
    expect(agg.passRate).toBeCloseTo(2 / 3)
    expect(agg.passCount).toBe(2)
    expect(agg.totalCount).toBe(3)
  })

  it('4. avg_time_sec = 전체 시간 합 / task 수', () => {
    const raw = makeResult()
    const agg = aggregateResults(raw)
    // (10 + 20 + 30) / 3 = 20
    expect(agg.avgTimeSec).toBeCloseTo(20)
  })

  it('5. total_tokens = 전체 토큰 합', () => {
    const raw = makeResult()
    const agg = aggregateResults(raw)
    expect(agg.totalTokens).toBe(6000)
  })

  it('6. 모두 통과 → pass_rate 1.0', () => {
    const raw = makeResult({
      tasks: [
        { id: 't1', passed: true, tokens: 100, time_sec: 5 },
        { id: 't2', passed: true, tokens: 200, time_sec: 10 },
      ],
    })
    const agg = aggregateResults(raw)
    expect(agg.passRate).toBe(1.0)
  })

  it('7. 빈 tasks 배열 → pass_rate 0, avg_time_sec 0', () => {
    const raw = makeResult({ tasks: [] })
    const agg = aggregateResults(raw)
    expect(agg.passRate).toBe(0)
    expect(agg.avgTimeSec).toBe(0)
    expect(agg.totalCount).toBe(0)
    expect(agg.passCount).toBe(0)
    expect(agg.totalTokens).toBe(0)
  })
})
