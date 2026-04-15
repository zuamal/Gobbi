import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runRecommend, formatPassRate, formatTokens } from './recommend.js'

vi.mock('../logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('@clack/prompts', () => ({
  select: vi.fn(),
  text: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseBenchmark = {
  suite: 'swe-bench-pro-mini',
  model: 'claude-sonnet-4-6',
  model_version: '2026-03-01',
  pass_rate: 0.67,
  total_tokens: 2_840_000,
  avg_time_sec: 145,
  run_date: '2026-04-01',
  docker_image_hash: 'sha256:abc123',
  checksum: 'sha256:def456',
}

function makeManifestJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'test-harness',
    version: '1.0.0',
    agent: 'claude-code',
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

async function createRegistry(
  structure: Record<string, Record<string, Record<string, unknown>>>,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gobbi-test-'))
  for (const [agent, harnesses] of Object.entries(structure)) {
    for (const [harness, manifest] of Object.entries(harnesses)) {
      await mkdir(join(dir, agent, harness), { recursive: true })
      await writeFile(join(dir, agent, harness, 'manifest.json'), JSON.stringify(manifest))
    }
  }
  return dir
}

// ── Test helpers ──────────────────────────────────────────────────────────────

let registryDir: string
let capturedOutput: string[]

beforeEach(() => {
  capturedOutput = []
  vi.spyOn(process.stdout, 'write').mockImplementation(
    ((chunk: string | Uint8Array) => {
      capturedOutput.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }) as typeof process.stdout.write,
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
  if (registryDir) {
    await rm(registryDir, { recursive: true, force: true }).catch(() => undefined)
    registryDir = ''
  }
})

function getOutput(): string {
  return capturedOutput.join('')
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runRecommend — flag-based mode', () => {
  it('1. --agent 단독: 전체 하네스 출력', async () => {
    registryDir = await createRegistry({
      'claude-code': {
        'harness-a': makeManifestJson({ name: 'harness-a', benchmarks: [baseBenchmark] }),
        'harness-b': makeManifestJson({ name: 'harness-b' }),
      },
    })
    await runRecommend({ agent: 'claude-code' }, registryDir)
    const out = getOutput()
    expect(out).toContain('harness-a')
    expect(out).toContain('harness-b')
  })

  it('2. --lang 필터 적용: 불일치 하네스 제외됨', async () => {
    registryDir = await createRegistry({
      'claude-code': {
        'ts-harness': makeManifestJson({
          name: 'ts-harness',
          tags: { languages: ['typescript'], frameworks: ['any'], scale: ['solo'], style: ['tdd'] },
        }),
        'py-harness': makeManifestJson({
          name: 'py-harness',
          tags: { languages: ['python'], frameworks: ['any'], scale: ['solo'], style: ['tdd'] },
        }),
      },
    })
    await runRecommend({ agent: 'claude-code', lang: 'typescript' }, registryDir)
    const out = getOutput()
    expect(out).toContain('ts-harness')
    expect(out).not.toContain('py-harness')
  })

  it('3. --framework 필터 적용', async () => {
    registryDir = await createRegistry({
      'claude-code': {
        'react-harness': makeManifestJson({
          name: 'react-harness',
          tags: { languages: ['typescript'], frameworks: ['react'], scale: ['solo'], style: ['tdd'] },
        }),
        'vue-harness': makeManifestJson({
          name: 'vue-harness',
          tags: { languages: ['typescript'], frameworks: ['vue'], scale: ['solo'], style: ['tdd'] },
        }),
      },
    })
    await runRecommend({ agent: 'claude-code', framework: 'react' }, registryDir)
    const out = getOutput()
    expect(out).toContain('react-harness')
    expect(out).not.toContain('vue-harness')
  })

  it('4. --scale 필터 적용', async () => {
    registryDir = await createRegistry({
      'claude-code': {
        'solo-harness': makeManifestJson({
          name: 'solo-harness',
          tags: { languages: ['typescript'], frameworks: ['any'], scale: ['solo'], style: ['tdd'] },
        }),
        'team-harness': makeManifestJson({
          name: 'team-harness',
          tags: { languages: ['typescript'], frameworks: ['any'], scale: ['small-team'], style: ['tdd'] },
        }),
      },
    })
    await runRecommend({ agent: 'claude-code', scale: 'solo' }, registryDir)
    const out = getOutput()
    expect(out).toContain('solo-harness')
    expect(out).not.toContain('team-harness')
  })

  it('5. --sort tokens → tokens 오름차순 순위 테이블', async () => {
    registryDir = await createRegistry({
      'claude-code': {
        'heavy': makeManifestJson({ name: 'heavy', benchmarks: [{ ...baseBenchmark, total_tokens: 5_000_000 }] }),
        'light': makeManifestJson({ name: 'light', benchmarks: [{ ...baseBenchmark, total_tokens: 1_000_000 }] }),
      },
    })
    await runRecommend({ agent: 'claude-code', sort: 'tokens' }, registryDir)
    const out = getOutput()
    expect(out.indexOf('light')).toBeLessThan(out.indexOf('heavy'))
  })

  it('6. ranked + unranked 혼합: 두 섹션 분리 출력', async () => {
    registryDir = await createRegistry({
      'claude-code': {
        'ranked-h': makeManifestJson({ name: 'ranked-h', benchmarks: [baseBenchmark] }),
        'unranked-h': makeManifestJson({ name: 'unranked-h' }),
      },
    })
    await runRecommend({ agent: 'claude-code' }, registryDir)
    const out = getOutput()
    expect(out).toContain('Harness')
    expect(out).toContain('Unranked (benchmark pending)')
    expect(out).toContain('ranked-h')
    expect(out).toContain('unranked-h')
  })

  it('7. ranked만 있음: unranked 섹션 없음', async () => {
    registryDir = await createRegistry({
      'claude-code': {
        'ranked-h': makeManifestJson({ name: 'ranked-h', benchmarks: [baseBenchmark] }),
      },
    })
    await runRecommend({ agent: 'claude-code' }, registryDir)
    expect(getOutput()).not.toContain('Unranked')
  })

  it('8. unranked만 있음: 테이블 헤더 없음, Model/Suite 줄 없음', async () => {
    registryDir = await createRegistry({
      'claude-code': {
        'unranked-h': makeManifestJson({ name: 'unranked-h' }),
      },
    })
    await runRecommend({ agent: 'claude-code' }, registryDir)
    const out = getOutput()
    expect(out).not.toContain('Pass Rate')
    expect(out).not.toContain('Model:')
    expect(out).toContain('Unranked')
  })

  it('9. 필터 결과 0개 → "No harnesses found" 출력, exit code 0', async () => {
    registryDir = await createRegistry({
      'opencode': {
        'oc-harness': makeManifestJson({ name: 'oc-harness', agent: 'opencode' }),
      },
    })
    await runRecommend({ agent: 'claude-code' }, registryDir)
    expect(getOutput()).toContain('No harnesses found for agent claude-code')
  })

  it('10. --agent 없이 --lang 있음 → exit code 1', async () => {
    await expect(runRecommend({ lang: 'typescript' })).rejects.toThrow('process.exit(1)')
  })

  it('11. registry/ 없음 → exit code 1', async () => {
    await expect(
      runRecommend({ agent: 'claude-code' }, '/nonexistent/path/registry'),
    ).rejects.toThrow('process.exit(1)')
  })

  it('12. pass_rate 포맷: 0.67 → "67.0%"', () => {
    expect(formatPassRate(0.67)).toBe('67.0%')
    expect(formatPassRate(0.635)).toBe('63.5%')
    expect(formatPassRate(1.0)).toBe('100.0%')
  })

  it('13. tokens 포맷: 2840000 → "2.8M", 850000 → "850.0K"', () => {
    expect(formatTokens(2_840_000)).toBe('2.8M')
    expect(formatTokens(850_000)).toBe('850.0K')
    expect(formatTokens(500)).toBe('500')
  })

  it('14. Sort footer: 기본값일 때 (default), 비기본값일 때 생략', async () => {
    registryDir = await createRegistry({
      'claude-code': {
        'h': makeManifestJson({ name: 'h', benchmarks: [baseBenchmark] }),
      },
    })

    await runRecommend({ agent: 'claude-code' }, registryDir)
    expect(getOutput()).toContain('--sort pass_rate (default)')

    capturedOutput = []
    await runRecommend({ agent: 'claude-code', sort: 'tokens' }, registryDir)
    expect(getOutput()).toContain('--sort tokens')
    expect(getOutput()).not.toContain('(default)')
  })
})

describe('runRecommend — interactive mode', () => {
  it('15. 인터랙티브 모드: 프롬프트 응답 주입 → 플래그 기반과 동일 결과 출력', async () => {
    registryDir = await createRegistry({
      'claude-code': {
        'ranked-h': makeManifestJson({ name: 'ranked-h', benchmarks: [baseBenchmark] }),
      },
    })

    const { select, text } = await import('@clack/prompts')
    vi.mocked(select)
      .mockResolvedValueOnce('claude-code')  // agent
      .mockResolvedValueOnce('')             // scale → skip
      .mockResolvedValueOnce('pass_rate')    // sort
    vi.mocked(text)
      .mockResolvedValueOnce('')             // lang → skip
      .mockResolvedValueOnce('')             // framework → skip

    await runRecommend({}, registryDir)
    const out = getOutput()
    expect(out).toContain('ranked-h')
    expect(out).toContain('--sort pass_rate (default)')
  })

  it('16. 인터랙티브 모드 Scale 선택지: 레지스트리 tags.scale 합집합 + (skip), 알파벳 정렬', async () => {
    registryDir = await createRegistry({
      'claude-code': {
        'h1': makeManifestJson({
          name: 'h1',
          tags: { languages: ['typescript'], frameworks: ['any'], scale: ['solo', 'small-team'], style: ['tdd'] },
        }),
        'h2': makeManifestJson({
          name: 'h2',
          tags: { languages: ['typescript'], frameworks: ['any'], scale: ['enterprise'], style: ['tdd'] },
        }),
      },
    })

    const { select, text } = await import('@clack/prompts')
    vi.mocked(select)
      .mockResolvedValueOnce('claude-code')  // agent
      .mockResolvedValueOnce('')             // scale → skip
      .mockResolvedValueOnce('pass_rate')    // sort
    vi.mocked(text)
      .mockResolvedValueOnce('')             // lang → skip
      .mockResolvedValueOnce('')             // framework → skip

    await runRecommend({}, registryDir)

    const calls = vi.mocked(select).mock.calls
    const scaleCall = calls.find(c => (c[0] as { message: string }).message === 'Scale (optional)')
    expect(scaleCall).toBeDefined()
    const opts = (scaleCall![0] as { options: Array<{ value: string; label: string }> }).options
    expect(opts.map(o => o.value)).toEqual(['enterprise', 'small-team', 'solo', ''])
    expect(opts.at(-1)!.label).toBe('(skip)')
  })
})
