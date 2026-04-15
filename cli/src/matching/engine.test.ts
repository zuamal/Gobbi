import { describe, it, expect } from 'vitest'
import { matchHarnesses } from './engine.js'
import type { Manifest } from '../schema.js'

function makeManifest(overrides: Partial<Manifest> & Pick<Manifest, 'name' | 'agent'>): Manifest {
  return {
    version: '1.0.0',
    description: 'Test harness',
    published_at: '2026-04-01',
    tags: {
      languages: ['typescript'],
      frameworks: ['any'],
      scale: ['solo'],
      style: ['tdd'],
    },
    ...overrides,
  }
}

function makeBenchmark(overrides?: Partial<NonNullable<Manifest['benchmarks']>[number]>) {
  return {
    suite: 'swe-bench-pro-mini',
    model: 'claude-sonnet-4-6',
    model_version: '2026-03-01',
    pass_rate: 0.67,
    total_tokens: 2_840_000,
    avg_time_sec: 145,
    run_date: '2026-04-01',
    docker_image_hash: 'sha256:abc123',
    checksum: 'sha256:def456',
    ...overrides,
  }
}

describe('matchHarnesses', () => {
  it('1. agent 필터: 다른 agent의 manifest 제외', () => {
    const manifests = [
      makeManifest({ name: 'cc-harness', agent: 'claude-code' }),
      makeManifest({ name: 'oc-harness', agent: 'opencode' }),
    ]
    const result = matchHarnesses(manifests, { agent: 'claude-code' }, 'pass_rate')
    expect(result.ranked.length + result.unranked.length).toBe(1)
    expect(result.unranked[0]!.name).toBe('cc-harness')
  })

  it('2. lang 필터: 일치하는 lang 포함', () => {
    const manifests = [
      makeManifest({ name: 'ts-harness', agent: 'claude-code', tags: { languages: ['typescript'], frameworks: ['any'], scale: ['solo'], style: ['tdd'] } }),
      makeManifest({ name: 'py-harness', agent: 'claude-code', tags: { languages: ['python'], frameworks: ['any'], scale: ['solo'], style: ['tdd'] } }),
    ]
    const result = matchHarnesses(manifests, { agent: 'claude-code', lang: 'typescript' }, 'pass_rate')
    expect(result.unranked).toHaveLength(1)
    expect(result.unranked[0]!.name).toBe('ts-harness')
  })

  it('3. lang 필터: "any" 포함된 manifest 통과', () => {
    const manifests = [
      makeManifest({ name: 'any-harness', agent: 'claude-code', tags: { languages: ['any'], frameworks: ['any'], scale: ['solo'], style: ['tdd'] } }),
    ]
    const result = matchHarnesses(manifests, { agent: 'claude-code', lang: 'typescript' }, 'pass_rate')
    expect(result.unranked).toHaveLength(1)
    expect(result.unranked[0]!.name).toBe('any-harness')
  })

  it('4. lang 필터: 불일치 manifest 제외', () => {
    const manifests = [
      makeManifest({ name: 'go-harness', agent: 'claude-code', tags: { languages: ['go'], frameworks: ['any'], scale: ['solo'], style: ['tdd'] } }),
    ]
    const result = matchHarnesses(manifests, { agent: 'claude-code', lang: 'typescript' }, 'pass_rate')
    expect(result.ranked).toHaveLength(0)
    expect(result.unranked).toHaveLength(0)
  })

  it('5. framework 필터: "any" 포함된 manifest 통과', () => {
    const manifests = [
      makeManifest({ name: 'any-fw-harness', agent: 'claude-code', tags: { languages: ['typescript'], frameworks: ['any'], scale: ['solo'], style: ['tdd'] } }),
    ]
    const result = matchHarnesses(manifests, { agent: 'claude-code', framework: 'react' }, 'pass_rate')
    expect(result.unranked).toHaveLength(1)
  })

  it('6. scale 필터: 불일치 제외', () => {
    const manifests = [
      makeManifest({ name: 'solo-harness', agent: 'claude-code', tags: { languages: ['typescript'], frameworks: ['any'], scale: ['solo'], style: ['tdd'] } }),
    ]
    const result = matchHarnesses(manifests, { agent: 'claude-code', scale: 'enterprise' }, 'pass_rate')
    expect(result.ranked).toHaveLength(0)
    expect(result.unranked).toHaveLength(0)
  })

  it('7. ranked/unranked 분리: benchmarks 없는 하네스 → unranked', () => {
    const manifests = [
      makeManifest({ name: 'ranked', agent: 'claude-code', benchmarks: [makeBenchmark()] }),
      makeManifest({ name: 'unranked', agent: 'claude-code' }),
    ]
    const result = matchHarnesses(manifests, { agent: 'claude-code' }, 'pass_rate')
    expect(result.ranked).toHaveLength(1)
    expect(result.unranked).toHaveLength(1)
    expect(result.ranked[0]!.manifest.name).toBe('ranked')
    expect(result.unranked[0]!.name).toBe('unranked')
  })

  it('8. pass_rate 정렬: 내림차순 확인', () => {
    const manifests = [
      makeManifest({ name: 'low', agent: 'claude-code', benchmarks: [makeBenchmark({ pass_rate: 0.50 })] }),
      makeManifest({ name: 'high', agent: 'claude-code', benchmarks: [makeBenchmark({ pass_rate: 0.80 })] }),
      makeManifest({ name: 'mid', agent: 'claude-code', benchmarks: [makeBenchmark({ pass_rate: 0.65 })] }),
    ]
    const result = matchHarnesses(manifests, { agent: 'claude-code' }, 'pass_rate')
    expect(result.ranked.map(r => r.manifest.name)).toEqual(['high', 'mid', 'low'])
  })

  it('9. tokens 정렬: 오름차순 확인', () => {
    const manifests = [
      makeManifest({ name: 'heavy', agent: 'claude-code', benchmarks: [makeBenchmark({ total_tokens: 5_000_000 })] }),
      makeManifest({ name: 'light', agent: 'claude-code', benchmarks: [makeBenchmark({ total_tokens: 1_000_000 })] }),
    ]
    const result = matchHarnesses(manifests, { agent: 'claude-code' }, 'tokens')
    expect(result.ranked.map(r => r.manifest.name)).toEqual(['light', 'heavy'])
  })

  it('10. time 정렬: 오름차순 확인', () => {
    const manifests = [
      makeManifest({ name: 'slow', agent: 'claude-code', benchmarks: [makeBenchmark({ avg_time_sec: 300 })] }),
      makeManifest({ name: 'fast', agent: 'claude-code', benchmarks: [makeBenchmark({ avg_time_sec: 100 })] }),
    ]
    const result = matchHarnesses(manifests, { agent: 'claude-code' }, 'time')
    expect(result.ranked.map(r => r.manifest.name)).toEqual(['fast', 'slow'])
  })

  it('11. name 정렬: 알파벳 오름차순 확인', () => {
    const manifests = [
      makeManifest({ name: 'zebra-harness', agent: 'claude-code', benchmarks: [makeBenchmark()] }),
      makeManifest({ name: 'alpha-harness', agent: 'claude-code', benchmarks: [makeBenchmark()] }),
    ]
    const result = matchHarnesses(manifests, { agent: 'claude-code' }, 'name')
    expect(result.ranked.map(r => r.manifest.name)).toEqual(['alpha-harness', 'zebra-harness'])
  })

  it('12. benchmark 복수 개 → run_date 최신 항목을 정렬 기준으로 사용', () => {
    const manifests = [
      makeManifest({
        name: 'multi-bench',
        agent: 'claude-code',
        benchmarks: [
          makeBenchmark({ pass_rate: 0.40, run_date: '2026-01-01' }),
          makeBenchmark({ pass_rate: 0.90, run_date: '2026-04-01' }),
        ],
      }),
    ]
    const result = matchHarnesses(manifests, { agent: 'claude-code' }, 'pass_rate')
    expect(result.ranked[0]!.benchmark.pass_rate).toBe(0.90)
  })

  it('13. model / suite: ranked[0]의 최신 benchmark에서 가져옴', () => {
    const manifests = [
      makeManifest({
        name: 'harness',
        agent: 'claude-code',
        benchmarks: [makeBenchmark({ model: 'claude-sonnet-4-6', suite: 'swe-bench-pro-mini' })],
      }),
    ]
    const result = matchHarnesses(manifests, { agent: 'claude-code' }, 'pass_rate')
    expect(result.model).toBe('claude-sonnet-4-6')
    expect(result.suite).toBe('swe-bench-pro-mini')
  })

  it('14. ranked 없음 → model=null, suite=null', () => {
    const manifests = [
      makeManifest({ name: 'unranked', agent: 'claude-code' }),
    ]
    const result = matchHarnesses(manifests, { agent: 'claude-code' }, 'pass_rate')
    expect(result.model).toBeNull()
    expect(result.suite).toBeNull()
  })

  it('15. 필터 후 0개 → ranked=[], unranked=[]', () => {
    const manifests = [
      makeManifest({ name: 'oc-harness', agent: 'opencode' }),
    ]
    const result = matchHarnesses(manifests, { agent: 'claude-code' }, 'pass_rate')
    expect(result.ranked).toHaveLength(0)
    expect(result.unranked).toHaveLength(0)
  })
})
