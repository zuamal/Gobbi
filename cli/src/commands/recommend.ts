import { Command } from 'commander'
import { select, text, isCancel } from '@clack/prompts'
import { loadManifests } from '../registry.js'
import * as logger from '../logger.js'
import { matchHarnesses, type SortField, type UserContext, type MatchResult } from '../matching/engine.js'

const VALID_SORTS: SortField[] = ['pass_rate', 'tokens', 'time', 'name']
const INDENT = '  '
const RANK_COL = 1
const SEP = '  '
const HARNESS_COL = 27
const PASS_RATE_COL = 11
const TOKENS_COL = 13

export function formatPassRate(rate: number): string {
  return (rate * 100).toFixed(1) + '%'
}

export function formatTokens(total: number): string {
  if (total >= 1_000_000) return (total / 1_000_000).toFixed(1) + 'M'
  if (total >= 1_000) return (total / 1_000).toFixed(1) + 'K'
  return total.toString()
}

function formatRow(
  rank: string,
  harness: string,
  passRate: string,
  tokens: string,
  style: string,
): string {
  return (
    `${INDENT}${rank.padEnd(RANK_COL)}${SEP}` +
    `${harness.padEnd(HARNESS_COL)}${passRate.padEnd(PASS_RATE_COL)}${tokens.padEnd(TOKENS_COL)}${style}`
  )
}

export function formatOutput(result: MatchResult, sort: SortField, agentName: string): string {
  if (result.ranked.length === 0 && result.unranked.length === 0) {
    return `No harnesses found for agent ${agentName}.`
  }

  const lines: string[] = []

  if (result.ranked.length > 0) {
    lines.push(formatRow('#', 'Harness', 'Pass Rate', 'Tokens(avg)', 'Style'))
    for (let i = 0; i < result.ranked.length; i++) {
      const entry = result.ranked[i]!
      lines.push(
        formatRow(
          String(i + 1),
          entry.manifest.name,
          formatPassRate(entry.benchmark.pass_rate),
          formatTokens(entry.benchmark.total_tokens),
          entry.manifest.tags.style.join(', '),
        ),
      )
    }
  }

  if (result.unranked.length > 0) {
    if (result.ranked.length > 0) lines.push('')
    lines.push('  ── Unranked (benchmark pending) ──────────────────────────')
    for (const manifest of result.unranked) {
      lines.push(formatRow('-', manifest.name, '-', '-', manifest.tags.style.join(', ')))
    }
  }

  lines.push('')

  if (result.model !== null && result.suite !== null) {
    lines.push(`  Model: ${result.model} | Suite: ${result.suite}`)
  }

  const otherSorts = VALID_SORTS.filter(s => s !== sort).join(', ')
  const defaultLabel = sort === 'pass_rate' ? ' (default)' : ''
  lines.push(`  Sort: --sort ${sort}${defaultLabel} | Options: ${otherSorts}`)

  return lines.join('\n')
}

export interface RecommendOptions {
  agent?: string
  lang?: string
  framework?: string
  scale?: string
  sort?: string
}

export async function runRecommend(opts: RecommendOptions, registryRoot?: string): Promise<void> {
  const sortRaw = opts.sort
  if (sortRaw !== undefined && !(VALID_SORTS as string[]).includes(sortRaw)) {
    logger.error(`Invalid sort value: "${sortRaw}". Valid options: ${VALID_SORTS.join(', ')}`)
    process.exit(1)
  }
  const sort: SortField = (sortRaw as SortField | undefined) ?? 'pass_rate'

  const noFlags =
    opts.agent === undefined &&
    opts.lang === undefined &&
    opts.framework === undefined &&
    opts.scale === undefined &&
    opts.sort === undefined

  if (noFlags) {
    let manifests
    try {
      manifests = await loadManifests(registryRoot)
    } catch {
      logger.error('Registry not found. Run gobbi from your project root.')
      process.exit(1)
      return
    }

    const agents = [...new Set(manifests.map(m => m.agent))].sort()
    const agentResult = await select({
      message: 'Select agent',
      options: agents.map(a => ({ value: a, label: a })),
    })
    if (isCancel(agentResult)) { process.exit(0); return }

    const langResult = await text({ message: 'Language (optional, press Enter to skip)' })
    if (isCancel(langResult)) { process.exit(0); return }

    const frameworkResult = await text({ message: 'Framework (optional, press Enter to skip)' })
    if (isCancel(frameworkResult)) { process.exit(0); return }

    const allScales = [...new Set(manifests.flatMap(m => m.tags.scale))].sort()
    const scaleResult = await select({
      message: 'Scale (optional)',
      options: [
        ...allScales.map(s => ({ value: s, label: s })),
        { value: '', label: '(skip)' },
      ],
    })
    if (isCancel(scaleResult)) { process.exit(0); return }

    const sortResult = await select({
      message: 'Sort by',
      options: [
        { value: 'pass_rate', label: 'pass_rate (default)' },
        { value: 'tokens', label: 'tokens' },
        { value: 'time', label: 'time' },
        { value: 'name', label: 'name' },
      ],
    })
    if (isCancel(sortResult)) { process.exit(0); return }

    const interactiveSort = (sortResult as SortField)
    const context: UserContext = {
      agent: agentResult as string,
      lang: (langResult as string) || undefined,
      framework: (frameworkResult as string) || undefined,
      scale: (scaleResult as string) || undefined,
    }

    const result = matchHarnesses(manifests, context, interactiveSort)
    const output = formatOutput(result, interactiveSort, context.agent)
    writeOutput(output, result)
    return
  }

  if (opts.agent === undefined) {
    logger.error('Missing required option: --agent')
    process.exit(1)
    return
  }

  let manifests
  try {
    manifests = await loadManifests(registryRoot)
  } catch {
    logger.error('Registry not found. Run gobbi from your project root.')
    process.exit(1)
    return
  }

  const context: UserContext = {
    agent: opts.agent,
    lang: opts.lang,
    framework: opts.framework,
    scale: opts.scale,
  }

  const result = matchHarnesses(manifests, context, sort)
  const output = formatOutput(result, sort, opts.agent)
  writeOutput(output, result)
}

function writeOutput(output: string, result: MatchResult): void {
  const isEmpty = result.ranked.length === 0 && result.unranked.length === 0
  process.stdout.write(isEmpty ? output + '\n' : '\n' + output + '\n')
}

export function createRecommendCommand(): Command {
  return new Command('recommend')
    .description('Recommend harnesses based on user context')
    .option('--agent <name>', 'target coding agent')
    .option('--lang <name>', 'programming language')
    .option('--framework <name>', 'framework')
    .option('--scale <name>', 'project scale')
    .option('--sort <field>', 'sort field (pass_rate, tokens, time, name)')
    .action(async (opts: RecommendOptions) => {
      await runRecommend(opts)
    })
}
