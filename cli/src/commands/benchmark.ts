import { Command } from 'commander'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import * as logger from '../logger.js'
import { loadManifests } from '../registry.js'
import {
  isDockerAvailable,
  getDockerImageHash,
  runBenchmarkInDocker,
  type TaskProgress,
} from '../runner/docker.js'
import { computeExecutionChecksum, aggregateResults } from '../runner/verify.js'

const BENCHMARK_SUITE = 'swe-bench-pro-mini' as const
const BENCHMARK_MODEL = 'claude-sonnet-4-6' as const

// ── Progress bar ───────────────────────────────────────────────────────────────

function renderProgressBar(completed: number, total: number): string {
  const BAR_LENGTH = 16
  const filled = total > 0 ? Math.round((completed / total) * BAR_LENGTH) : 0
  const empty = BAR_LENGTH - filled
  const bar = '█'.repeat(filled) + '░'.repeat(empty)
  return `  Running... [${bar}] ${completed}/${total}`
}

// ── Number formatting (same rules as recommend) ────────────────────────────────

function formatTokens(total: number): string {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}K`
  return String(total)
}

function formatPassRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

// ── Main handler ───────────────────────────────────────────────────────────────

export async function runBenchmark(
  harnessName: string,
  registryRoot?: string,
  projectDir?: string,
): Promise<void> {
  const cwd = projectDir ?? process.cwd()

  // 1. Look up harness in registry
  const manifests = await loadManifests(registryRoot)
  const harness = manifests.find((m) => m.name === harnessName)

  if (!harness) {
    logger.error(`Harness not found in registry: ${harnessName}`)
    process.exit(1)
    return
  }

  // 2. Check Docker availability
  const dockerOk = await isDockerAvailable()
  if (!dockerOk) {
    logger.error('Docker is not available. Please install and start Docker.')
    process.exit(1)
    return
  }

  // 3. Get gobbi-runner image hash
  let dockerImageHash: string
  try {
    dockerImageHash = await getDockerImageHash('gobbi-runner')
  } catch {
    logger.error('gobbi-runner image not found. Run: docker pull gobbi-runner')
    process.exit(1)
    return
  }

  // 4. Constants (V1 fixed)
  const suite = BENCHMARK_SUITE
  const model = BENCHMARK_MODEL

  // 5. Print header
  process.stdout.write(`\n`)
  process.stdout.write(`  Agent: ${harness.agent}\n`)
  process.stdout.write(`  Model: ${model}\n`)
  process.stdout.write(`  Suite: ${suite}\n`)
  process.stdout.write(`  Environment: docker (gobbi-runner:latest)\n`)
  process.stdout.write(`\n`)

  // 6. Run Docker container with progress bar
  let lastProgress: TaskProgress = { completed: 0, total: 0 }

  const onProgress = (progress: TaskProgress): void => {
    lastProgress = progress
    process.stdout.write(`\r${renderProgressBar(progress.completed, progress.total)}`)
  }

  // Determine harness src path from registry
  // Registry layout: registry/<agent>/<harness>/manifest.json
  // We need the harness directory path
  const root =
    registryRoot ??
    process.env['GOBBI_REGISTRY'] ??
    join(process.cwd(), 'registry')
  const harnessSrcPath = join(root, harness.agent, harnessName)

  let runResult: Awaited<ReturnType<typeof runBenchmarkInDocker>>
  try {
    runResult = await runBenchmarkInDocker(
      {
        harnessSrcPath,
        agent: harness.agent,
        suite,
        model,
      },
      onProgress,
    )
  } catch (err) {
    process.stdout.write('\n')
    logger.error(
      `Docker container failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    process.exit(1)
    return
  }

  // End progress bar line
  if (lastProgress.total > 0) {
    process.stdout.write(
      `\r${renderProgressBar(lastProgress.completed, lastProgress.total)}\n`,
    )
  } else {
    process.stdout.write('\n')
  }

  // 7. Parse raw result (already done by runBenchmarkInDocker)
  const { raw } = runResult

  // 8. Compute execution log checksum
  const checksum = computeExecutionChecksum(raw.execution_log)

  // 9. Aggregate results
  const agg = aggregateResults(raw)

  // 10. Write result file
  const runDate = new Date().toISOString().slice(0, 10)
  const resultObj = {
    suite,
    model,
    model_version: raw.model_version,
    pass_rate: agg.passRate,
    total_tokens: agg.totalTokens,
    avg_time_sec: agg.avgTimeSec,
    run_date: runDate,
    docker_image_hash: runResult.dockerImageHash,
    checksum,
    submitted_by: 'self' as const,
  }

  const resultDir = join(cwd, 'benchmarks', 'results', harness.agent)
  const resultPath = join(resultDir, `${harnessName}.json`)

  try {
    await mkdir(resultDir, { recursive: true })
    await writeFile(resultPath, JSON.stringify(resultObj, null, 2), 'utf-8')
  } catch (err) {
    logger.error(
      `Failed to write result file: ${resultPath} — ${err instanceof Error ? err.message : String(err)}`,
    )
    process.exit(1)
    return
  }

  // 11. Print result summary
  const relResultPath = join('benchmarks', 'results', harness.agent, `${harnessName}.json`)

  process.stdout.write(`\n`)
  process.stdout.write(`  Results:\n`)
  process.stdout.write(
    `  Pass rate: ${formatPassRate(agg.passRate)} (${agg.passCount}/${agg.totalCount} tasks)\n`,
  )
  process.stdout.write(`  Avg tokens: ${formatTokens(agg.totalTokens / Math.max(agg.totalCount, 1))} per task\n`)
  process.stdout.write(`  Avg time: ${Math.round(agg.avgTimeSec)}s per task\n`)
  process.stdout.write(`\n`)
  process.stdout.write(`  Output: ${relResultPath}\n`)
}

export function createBenchmarkCommand(): Command {
  return new Command('benchmark')
    .description('Run benchmark suite against a harness in Docker')
    .argument('<harness-name>', 'name of the harness to benchmark')
    .action(async (harnessName: string) => {
      await runBenchmark(harnessName)
    })
}
