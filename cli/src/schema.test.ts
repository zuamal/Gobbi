import { describe, it, expect } from 'vitest'
import { parseManifest } from './schema.js'
import { ZodError } from 'zod'

const validManifest = {
  name: 'test-harness',
  version: '1.0.0',
  agent: 'claude-code',
  description: 'A test harness',
  published_at: '2026-04-01',
  tags: {
    languages: ['typescript'],
    frameworks: ['any'],
    scale: ['solo'],
    style: ['tdd'],
  },
  files: {
    claude_md: './CLAUDE.md',
  },
  benchmarks: [
    {
      suite: 'swe-bench-pro-mini',
      model: 'claude-sonnet-4-6',
      model_version: '2026-03-01',
      pass_rate: 0.67,
      total_tokens: 2840000,
      avg_time_sec: 145,
      run_date: '2026-04-01',
      docker_image_hash: 'sha256:abc123',
      checksum: 'sha256:def456',
    },
  ],
}

describe('parseManifest', () => {
  it('유효한 manifest 객체 → 파싱 성공, 반환값 타입 일치', () => {
    const result = parseManifest(validManifest)
    expect(result.name).toBe('test-harness')
    expect(result.version).toBe('1.0.0')
    expect(result.agent).toBe('claude-code')
    expect(result.published_at).toBe('2026-04-01')
    expect(result.benchmarks).toHaveLength(1)
  })

  it('published_at 누락 → ZodError throw', () => {
    const { published_at: _, ...withoutPublishedAt } = validManifest
    expect(() => parseManifest(withoutPublishedAt)).toThrow(ZodError)
  })

  it('benchmarks 누락 → 정상 파싱 (optional)', () => {
    const { benchmarks: _, ...withoutBenchmarks } = validManifest
    const result = parseManifest(withoutBenchmarks)
    expect(result.benchmarks).toBeUndefined()
  })

  it('benchmarks 빈 배열 → 정상 파싱', () => {
    const result = parseManifest({ ...validManifest, benchmarks: [] })
    expect(result.benchmarks).toEqual([])
  })

  it('알 수 없는 필드가 추가로 있을 때 → 파싱 성공, 반환값에서 해당 필드 제거됨 (strip 동작)', () => {
    const withExtra = { ...validManifest, unknown_field: 'should-be-stripped' }
    const result = parseManifest(withExtra) as Record<string, unknown>
    expect(result.name).toBe('test-harness')
    expect(result['unknown_field']).toBeUndefined()
  })
})
