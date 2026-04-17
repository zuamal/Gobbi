import { zodToJsonSchema } from 'zod-to-json-schema'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { ManifestSchema } from '../src/schema.ts'

// zod-to-json-schema 기본 출력에서 additionalProperties 키를 재귀적으로 제거한다.
// manifest는 기여자가 확장 필드를 자유롭게 추가할 수 있어야 하므로
// additionalProperties 제한을 두지 않는다.
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

const raw = zodToJsonSchema(ManifestSchema, {
  $refStrategy: 'none',
  target: 'jsonSchema7',
})

const cleaned = removeAdditionalProperties(raw) as Record<string, unknown>

// $schema 필드를 첫 번째 키로 보장
const output = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  ...cleaned,
}

// 출력 경로: 프로젝트 루트 (.gobbi-schema.json)
// cli/scripts/ 기준으로 두 단계 상위
const outPath = join(
  fileURLToPath(new URL('../../.gobbi-schema.json', import.meta.url)),
)

writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf-8')
console.log(`Generated: ${outPath}`)
