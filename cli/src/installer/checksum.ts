import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export function computeStringChecksum(content: string): string {
  const hash = createHash('sha256').update(content, 'utf-8').digest('hex')
  return `sha256:${hash}`
}

export async function computeFileChecksum(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf-8')
  return computeStringChecksum(content)
}
