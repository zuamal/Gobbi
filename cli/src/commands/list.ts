import { Command } from 'commander'
import * as logger from '../logger.js'
import { loadManifests } from '../registry.js'
import type { Manifest } from '../schema.js'

// ── Formatting ────────────────────────────────────────────────────────────────

const DIVIDER = '  ' + '─'.repeat(60) + '\n'
const HEADER = `  ${'Name'.padEnd(27)}${'Version'.padEnd(9)}${'Published'.padEnd(13)}Style\n`

function harnessSuffix(n: number): string {
  return n === 1 ? 'harness' : 'harnesses'
}

function formatRow(m: Manifest): string {
  const name = m.name.padEnd(27)
  const version = m.version.padEnd(9)
  const published = m.published_at.padEnd(13)
  const style = m.tags.style.join(', ')
  return `  ${name}${version}${published}${style}\n`
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function runList(
  opts: { agent?: string },
  registryRoot?: string,
): Promise<void> {
  // 1. Load all manifests
  let manifests: Manifest[]
  try {
    manifests = await loadManifests(registryRoot)
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
    return
  }

  // 2. Filter by --agent if specified
  if (opts.agent !== undefined) {
    const filtered = manifests.filter((m) => m.agent === opts.agent)
    if (filtered.length === 0) {
      logger.error(`No agent found with name: ${opts.agent}`)
      process.exit(1)
      return
    }
    manifests = filtered
  }

  // 3. Handle empty registry
  if (manifests.length === 0) {
    process.stdout.write('  No harnesses found.\n')
    return
  }

  // 4. Group by agent, sorted alphabetically
  const groups = new Map<string, Manifest[]>()
  for (const m of manifests) {
    if (!groups.has(m.agent)) groups.set(m.agent, [])
    groups.get(m.agent)!.push(m)
  }

  const sortedAgents = [...groups.keys()].sort()

  for (const agent of sortedAgents) {
    const harnesses = groups.get(agent)!.sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    const count = harnesses.length
    process.stdout.write(
      `\n  ${agent} (${count} ${harnessSuffix(count)})\n`,
    )
    process.stdout.write(DIVIDER)
    process.stdout.write(HEADER)
    for (const h of harnesses) {
      process.stdout.write(formatRow(h))
    }
  }

  const total = manifests.length
  process.stdout.write(`\n  Total: ${total} ${harnessSuffix(total)}\n`)
}

export function createListCommand(): Command {
  return new Command('list')
    .description('List available harnesses from the registry')
    .option('--agent <name>', 'filter by agent name')
    .action(async (opts: { agent?: string }) => {
      await runList(opts)
    })
}
