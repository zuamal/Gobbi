import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveConflict } from './conflict.js'

vi.mock('@clack/prompts', () => ({
  select: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

let tmpDir: string
let capturedOutput: string[]

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gobbi-conflict-'))
  capturedOutput = []
  vi.spyOn(process.stdout, 'write').mockImplementation(
    ((chunk: string | Uint8Array) => {
      capturedOutput.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }) as typeof process.stdout.write,
  )
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
})

describe('resolveConflict', () => {
  it('1. .md 파일: d/o/m/s 선택지 모두 표시', async () => {
    const { select } = await import('@clack/prompts')
    vi.mocked(select).mockResolvedValueOnce('s')

    const filePath = join(tmpDir, 'README.md')
    await writeFile(filePath, 'existing', 'utf-8')

    await resolveConflict(filePath, 'incoming')

    const call = vi.mocked(select).mock.calls[0]!
    const options = (call[0] as { options: Array<{ value: string }> }).options
    const values = options.map(o => o.value)
    expect(values).toContain('d')
    expect(values).toContain('o')
    expect(values).toContain('m')
    expect(values).toContain('s')
  })

  it('2. 비 .md/.json 파일: m 선택지 없음', async () => {
    const { select } = await import('@clack/prompts')
    vi.mocked(select).mockResolvedValueOnce('s')

    const filePath = join(tmpDir, 'hook.sh')
    await writeFile(filePath, '#!/bin/bash', 'utf-8')

    await resolveConflict(filePath, '#!/bin/bash\nnew content')

    const call = vi.mocked(select).mock.calls[0]!
    const options = (call[0] as { options: Array<{ value: string }> }).options
    const values = options.map(o => o.value)
    expect(values).not.toContain('m')
    expect(values).toContain('o')
    expect(values).toContain('s')
  })

  it('3. d 선택 시 기존·incoming 내용 출력 후 프롬프트 재표시', async () => {
    const { select } = await import('@clack/prompts')
    vi.mocked(select)
      .mockResolvedValueOnce('d')  // First: show diff
      .mockResolvedValueOnce('s')  // Second: skip

    const filePath = join(tmpDir, 'CLAUDE.md')
    await writeFile(filePath, 'existing content', 'utf-8')

    await resolveConflict(filePath, 'incoming content')

    const output = capturedOutput.join('')
    expect(output).toContain('existing content')
    expect(output).toContain('incoming content')
    expect(vi.mocked(select)).toHaveBeenCalledTimes(2)
  })

  it('4. o 선택 → "overwrite" 반환', async () => {
    const { select } = await import('@clack/prompts')
    vi.mocked(select).mockResolvedValueOnce('o')

    const filePath = join(tmpDir, 'CLAUDE.md')
    await writeFile(filePath, 'existing', 'utf-8')

    const result = await resolveConflict(filePath, 'incoming')
    expect(result).toBe('overwrite')
  })

  it('5. m 선택 → "merge" 반환', async () => {
    const { select } = await import('@clack/prompts')
    vi.mocked(select).mockResolvedValueOnce('m')

    const filePath = join(tmpDir, 'CLAUDE.md')
    await writeFile(filePath, 'existing', 'utf-8')

    const result = await resolveConflict(filePath, 'incoming')
    expect(result).toBe('merge')
  })

  it('6. s 선택 → "skip" 반환', async () => {
    const { select } = await import('@clack/prompts')
    vi.mocked(select).mockResolvedValueOnce('s')

    const filePath = join(tmpDir, 'CLAUDE.md')
    await writeFile(filePath, 'existing', 'utf-8')

    const result = await resolveConflict(filePath, 'incoming')
    expect(result).toBe('skip')
  })
})
