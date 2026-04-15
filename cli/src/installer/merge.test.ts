import { describe, it, expect, vi } from 'vitest'
import { mergeMd, mergeJson } from './merge.js'

describe('mergeMd', () => {
  it('1. 구분선 포함, incoming이 기존 뒤에 추가됨', () => {
    const result = mergeMd('existing content', 'incoming content', {
      harness: 'test-harness',
      version: '1.0.0',
    })
    expect(result).toContain('existing content')
    expect(result).toContain('incoming content')
    const existingIdx = result.indexOf('existing content')
    const incomingIdx = result.indexOf('incoming content')
    expect(existingIdx).toBeLessThan(incomingIdx)
  })

  it('2. 구분선에 harness 이름과 버전 포함', () => {
    const result = mergeMd('existing', 'incoming', {
      harness: 'my-harness',
      version: '2.3.1',
    })
    expect(result).toContain('---')
    expect(result).toContain('<!-- gobbi: my-harness@2.3.1 -->')
  })
})

describe('mergeJson', () => {
  const noConflict = vi.fn()

  it('3. 기존에만 있는 키 유지', async () => {
    const result = await mergeJson(
      JSON.stringify({ existingKey: 'value' }),
      JSON.stringify({ newKey: 'new' }),
      noConflict,
    )
    const parsed = JSON.parse(result) as Record<string, unknown>
    expect(parsed['existingKey']).toBe('value')
  })

  it('4. incoming에만 있는 키 추가', async () => {
    const result = await mergeJson(
      JSON.stringify({ existingKey: 'value' }),
      JSON.stringify({ newKey: 'new' }),
      noConflict,
    )
    const parsed = JSON.parse(result) as Record<string, unknown>
    expect(parsed['newKey']).toBe('new')
  })

  it('5. 충돌 키 → "keep" 선택 시 기존 값 유지', async () => {
    const onConflict = vi.fn().mockResolvedValue('keep')
    const result = await mergeJson(
      JSON.stringify({ key: 'existing' }),
      JSON.stringify({ key: 'incoming' }),
      onConflict,
    )
    const parsed = JSON.parse(result) as Record<string, unknown>
    expect(parsed['key']).toBe('existing')
  })

  it('6. 충돌 키 → "overwrite" 선택 시 incoming 값으로 교체', async () => {
    const onConflict = vi.fn().mockResolvedValue('overwrite')
    const result = await mergeJson(
      JSON.stringify({ key: 'existing' }),
      JSON.stringify({ key: 'incoming' }),
      onConflict,
    )
    const parsed = JSON.parse(result) as Record<string, unknown>
    expect(parsed['key']).toBe('incoming')
  })

  it('7. 결과가 유효한 JSON (2-space indent)', async () => {
    const result = await mergeJson(
      JSON.stringify({ a: 1 }),
      JSON.stringify({ b: 2 }),
      noConflict,
    )
    expect(() => JSON.parse(result)).not.toThrow()
    // 2-space indent: starts with "{\n  "
    expect(result).toMatch(/^\{\n {2}"/)
  })

  it('8. 충돌 없는 경우 onConflict 호출 안 됨', async () => {
    const onConflict = vi.fn()
    await mergeJson(
      JSON.stringify({ a: 1 }),
      JSON.stringify({ b: 2 }),
      onConflict,
    )
    expect(onConflict).not.toHaveBeenCalled()
  })
})
