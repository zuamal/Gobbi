import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runList } from './list.js'

vi.mock('../logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeManifest(overrides: {
  name: string
  agent: string
  version?: string
  published_at?: string
  style?: string[]
}): object {
  return {
    name: overrides.name,
    version: overrides.version ?? '1.0.0',
    agent: overrides.agent,
    description: `${overrides.name} test harness`,
    published_at: overrides.published_at ?? '2026-01-01',
    tags: {
      languages: [],
      frameworks: [],
      scale: [],
      style: overrides.style ?? [],
    },
    benchmarks: [],
  }
}

async function writeManifest(
  registryRoot: string,
  manifest: ReturnType<typeof makeManifest> & { agent: string; name: string },
): Promise<void> {
  const dir = join(registryRoot, manifest.agent, manifest.name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest))
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let registryRoot: string
let output: string

beforeEach(async () => {
  registryRoot = await mkdtemp(join(tmpdir(), 'gobbi-list-test-'))
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
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  await rm(registryRoot, { recursive: true, force: true }).catch(() => undefined)
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runList', () => {
  it('1. 하네스 2개 (에이전트 다름) → 에이전트별 그룹 2개, Total: 2 harnesses', async () => {
    await writeManifest(registryRoot, makeManifest({ name: 'alpha', agent: 'claude-code' }) as Parameters<typeof writeManifest>[1])
    await writeManifest(registryRoot, makeManifest({ name: 'beta', agent: 'opencode' }) as Parameters<typeof writeManifest>[1])

    await runList({}, registryRoot)

    expect(output).toContain('claude-code (1 harness)')
    expect(output).toContain('opencode (1 harness)')
    expect(output).toContain('Total: 2 harnesses')
  })

  it('2. 하네스 1개 → 그룹 헤더 (1 harness), footer Total: 1 harness (단수)', async () => {
    await writeManifest(registryRoot, makeManifest({ name: 'alpha', agent: 'claude-code' }) as Parameters<typeof writeManifest>[1])

    await runList({}, registryRoot)

    expect(output).toContain('claude-code (1 harness)')
    expect(output).toContain('Total: 1 harness')
    expect(output).not.toContain('harnesses')
  })

  it('3. --agent 필터 → 해당 에이전트 그룹만 출력', async () => {
    await writeManifest(registryRoot, makeManifest({ name: 'alpha', agent: 'claude-code' }) as Parameters<typeof writeManifest>[1])
    await writeManifest(registryRoot, makeManifest({ name: 'beta', agent: 'opencode' }) as Parameters<typeof writeManifest>[1])

    await runList({ agent: 'claude-code' }, registryRoot)

    expect(output).toContain('claude-code')
    expect(output).toContain('alpha')
    expect(output).not.toContain('opencode')
    expect(output).not.toContain('beta')
  })

  it('4. --agent 값이 레지스트리에 없음 → exit code 1', async () => {
    await writeManifest(registryRoot, makeManifest({ name: 'alpha', agent: 'claude-code' }) as Parameters<typeof writeManifest>[1])

    await expect(runList({ agent: 'Claude-Code' }, registryRoot)).rejects.toThrow(
      'process.exit(1)',
    )
  })

  it('5. registry/ 없음 → exit code 1', async () => {
    await expect(
      runList({}, '/nonexistent-path-gobbi-test'),
    ).rejects.toThrow('process.exit(1)')
  })

  it('6. manifest 1개 파싱 실패 → 경고 출력 + 나머지 하네스 정상 출력', async () => {
    await writeManifest(registryRoot, makeManifest({ name: 'valid', agent: 'claude-code' }) as Parameters<typeof writeManifest>[1])

    // Invalid manifest (missing published_at)
    const invalidDir = join(registryRoot, 'claude-code', 'invalid-harness')
    await mkdir(invalidDir, { recursive: true })
    await writeFile(
      join(invalidDir, 'manifest.json'),
      JSON.stringify({ name: 'invalid-harness', version: '1.0.0' }),
    )

    const { warn } = await import('../logger.js')
    await runList({}, registryRoot)

    expect(vi.mocked(warn)).toHaveBeenCalled()
    expect(output).toContain('valid')
  })

  it('7. tags.style 복수 값 → 쉼표+공백으로 join', async () => {
    await writeManifest(
      registryRoot,
      makeManifest({
        name: 'styled',
        agent: 'claude-code',
        style: ['tdd', 'plan-first', 'evaluator-separated'],
      }) as Parameters<typeof writeManifest>[1],
    )

    await runList({}, registryRoot)

    expect(output).toContain('tdd, plan-first, evaluator-separated')
  })

  it('8. 하네스 0개 → "No harnesses found." 출력 후 exit code 0', async () => {
    // Registry exists but no harnesses
    await runList({}, registryRoot)

    expect(output).toContain('No harnesses found.')
  })
})
