import { z } from 'zod'

const BenchmarkEntrySchema = z.object({
  suite: z.string(),
  model: z.string(),
  model_version: z.string(),
  pass_rate: z.number(),
  total_tokens: z.number(),
  avg_time_sec: z.number(),
  run_date: z.string(),
  docker_image_hash: z.string(),
  checksum: z.string(),
})

export const ManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  agent: z.string(),
  description: z.string(),
  published_at: z.string(),
  tags: z.object({
    languages: z.array(z.string()),
    frameworks: z.array(z.string()),
    scale: z.array(z.string()),
    style: z.array(z.string()),
  }),
  files: z
    .object({
      claude_md: z.string().optional(),
      skills: z.string().optional(),
      hooks: z.string().optional(),
      mcp: z.string().optional(),
    })
    .optional(),
  benchmarks: z.array(BenchmarkEntrySchema).optional(),
})

export type Manifest = z.infer<typeof ManifestSchema>

export function parseManifest(raw: unknown): Manifest {
  return ManifestSchema.parse(raw)
}
