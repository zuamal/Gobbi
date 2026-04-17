import { describe, it, expect, beforeAll } from 'vitest'
import { zodToJsonSchema } from 'zod-to-json-schema'
import Ajv from 'ajv'
import { ManifestSchema } from '../src/schema.ts'

// ── 스크립트와 동일한 로직으로 인메모리 스키마 생성 ──────────────────────────

function removeAdditionalProperties(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(removeAdditionalProperties)
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'additionalProperties') continue
      result[k] = removeAdditionalProperties(v)
    }
    return result
  }
  return value
}

const rawSchema = zodToJsonSchema(ManifestSchema, {
  $refStrategy: 'none',
  target: 'jsonSchema7',
})

const schema = removeAdditionalProperties(rawSchema) as Record<string, unknown>

// ── AJV 컴파일 ────────────────────────────────────────────────────────────────

let validate: ReturnType<Ajv['compile']>

beforeAll(() => {
  const ajv = new Ajv({ strict: false })
  validate = ajv.compile(schema)
})

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

const fullManifest = {
  name: 'celesteanders-harness',
  version: '1.2.0',
  agent: 'claude-code',
  description: 'A comprehensive coding harness with all fields populated',
  published_at: '2026-04-01',
  tags: {
    languages: ['typescript', 'python'],
    frameworks: ['nextjs', 'fastapi'],
    scale: ['startup', 'enterprise'],
    style: ['tdd', 'plan-first', 'evaluator-separated'],
  },
  files: {
    claude_md: 'CLAUDE.md',
    skills: 'skills/',
    hooks: '.claude/hooks/',
    mcp: 'mcp.json',
  },
  benchmarks: [
    {
      suite: 'swe-bench-pro-mini',
      model: 'claude-sonnet-4-6',
      model_version: '2026-03-01',
      pass_rate: 0.65,
      total_tokens: 2840000,
      avg_time_sec: 145,
      run_date: '2026-04-16',
      docker_image_hash: 'sha256:abc123def456',
      checksum: 'sha256:fedcba654321',
    },
  ],
}

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe('generate-schema', () => {
  it('1. 스펙 §5 예시 manifest (전체 필드 포함) → 검증 통과', () => {
    expect(validate(fullManifest)).toBe(true)
  })

  it('2. benchmarks 필드 누락 manifest → 검증 통과 (optional)', () => {
    const { benchmarks: _, ...withoutBenchmarks } = fullManifest
    expect(validate(withoutBenchmarks)).toBe(true)
  })

  it('3. benchmarks: [] (빈 배열) manifest → 검증 통과', () => {
    expect(validate({ ...fullManifest, benchmarks: [] })).toBe(true)
  })

  it('4. published_at 누락 manifest → 검증 실패', () => {
    const { published_at: _, ...withoutPublishedAt } = fullManifest
    expect(validate(withoutPublishedAt)).toBe(false)
  })

  it('5. name 누락 manifest → 검증 실패', () => {
    const { name: _, ...withoutName } = fullManifest
    expect(validate(withoutName)).toBe(false)
  })

  it('6. agent 누락 manifest → 검증 실패', () => {
    const { agent: _, ...withoutAgent } = fullManifest
    expect(validate(withoutAgent)).toBe(false)
  })

  it('7. tags.style 빈 배열 manifest → 검증 통과 (배열 항목 수 제한 없음)', () => {
    expect(
      validate({ ...fullManifest, tags: { ...fullManifest.tags, style: [] } }),
    ).toBe(true)
  })

  it('8. 알 수 없는 추가 필드 포함 manifest → 검증 통과 (additionalProperties 제한 없음)', () => {
    expect(
      validate({
        ...fullManifest,
        custom_field: 'some value',
        extra_metadata: { nested: true },
      }),
    ).toBe(true)
  })
})
