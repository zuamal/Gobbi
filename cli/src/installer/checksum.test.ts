import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { computeStringChecksum, computeFileChecksum } from './checksum.js'

describe('computeStringChecksum', () => {
  it('1. 반환값이 "sha256:" + 64자 hex', () => {
    const result = computeStringChecksum('hello')
    expect(result).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('2. 동일 내용 → 동일 체크섬', () => {
    const a = computeStringChecksum('same content')
    const b = computeStringChecksum('same content')
    expect(a).toBe(b)
  })

  it('3. 다른 내용 → 다른 체크섬', () => {
    const a = computeStringChecksum('content A')
    const b = computeStringChecksum('content B')
    expect(a).not.toBe(b)
  })
})

describe('computeFileChecksum', () => {
  it('4. 파일 내용과 computeStringChecksum 결과 일치', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gobbi-checksum-'))
    const filePath = join(dir, 'test.txt')
    const content = 'file content for checksum test'

    try {
      await writeFile(filePath, content, 'utf-8')
      const fileResult = await computeFileChecksum(filePath)
      const stringResult = computeStringChecksum(content)
      expect(fileResult).toBe(stringResult)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
