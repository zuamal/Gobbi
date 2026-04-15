import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseManifest, type Manifest } from './schema.js'
import * as logger from './logger.js'

export async function loadManifests(registryRoot?: string): Promise<Manifest[]> {
  const root = registryRoot ?? process.env['GOBBI_REGISTRY'] ?? join(process.cwd(), 'registry')

  const agentDirs = await readdir(root, { withFileTypes: true }).catch(() => {
    throw new Error(`Registry not found at: ${root}`)
  })

  const manifests: Manifest[] = []

  for (const agentDir of agentDirs) {
    if (!agentDir.isDirectory()) continue
    const agentPath = join(root, String(agentDir.name))

    const harnessDirs = await readdir(agentPath, { withFileTypes: true }).catch(() => null)
    if (!harnessDirs) continue

    for (const harnessDir of harnessDirs) {
      if (!harnessDir.isDirectory()) continue
      const manifestPath = join(agentPath, String(harnessDir.name), 'manifest.json')

      try {
        const content = await readFile(manifestPath, 'utf-8')
        const raw: unknown = JSON.parse(content)
        manifests.push(parseManifest(raw))
      } catch {
        logger.warn(`Skipping invalid manifest: ${manifestPath}`)
      }
    }
  }

  return manifests
}
