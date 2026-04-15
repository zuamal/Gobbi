import type { Manifest } from '../schema.js'

export type SortField = 'pass_rate' | 'tokens' | 'time' | 'name'

export type BenchmarkRun = NonNullable<Manifest['benchmarks']>[number]

export interface UserContext {
  agent: string
  lang?: string
  framework?: string
  scale?: string
}

export interface RankedEntry {
  manifest: Manifest
  benchmark: BenchmarkRun
}

export interface MatchResult {
  ranked: RankedEntry[]
  unranked: Manifest[]
  model: string | null
  suite: string | null
}

function latestBenchmark(benchmarks: BenchmarkRun[]): BenchmarkRun {
  return [...benchmarks].sort((a, b) => b.run_date.localeCompare(a.run_date))[0]!
}

export function matchHarnesses(
  manifests: Manifest[],
  context: UserContext,
  sort: SortField,
): MatchResult {
  let filtered = manifests.filter(m => m.agent === context.agent)

  if (context.lang !== undefined) {
    filtered = filtered.filter(
      m => m.tags.languages.includes(context.lang!) || m.tags.languages.includes('any'),
    )
  }

  if (context.framework !== undefined) {
    filtered = filtered.filter(
      m => m.tags.frameworks.includes(context.framework!) || m.tags.frameworks.includes('any'),
    )
  }

  if (context.scale !== undefined) {
    filtered = filtered.filter(m => m.tags.scale.includes(context.scale!))
  }

  const ranked: RankedEntry[] = []
  const unranked: Manifest[] = []

  for (const manifest of filtered) {
    if (manifest.benchmarks && manifest.benchmarks.length > 0) {
      ranked.push({ manifest, benchmark: latestBenchmark(manifest.benchmarks) })
    } else {
      unranked.push(manifest)
    }
  }

  ranked.sort((a, b) => {
    switch (sort) {
      case 'pass_rate':
        return b.benchmark.pass_rate - a.benchmark.pass_rate
      case 'tokens':
        return a.benchmark.total_tokens - b.benchmark.total_tokens
      case 'time':
        return a.benchmark.avg_time_sec - b.benchmark.avg_time_sec
      case 'name':
        return a.manifest.name.localeCompare(b.manifest.name)
    }
  })

  unranked.sort((a, b) => a.name.localeCompare(b.name))

  const model = ranked.length > 0 ? ranked[0]!.benchmark.model : null
  const suite = ranked.length > 0 ? ranked[0]!.benchmark.suite : null

  return { ranked, unranked, model, suite }
}
