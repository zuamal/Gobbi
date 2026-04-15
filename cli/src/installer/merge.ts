export function mergeMd(
  existing: string,
  incoming: string,
  meta: { harness: string; version: string },
): string {
  return `${existing}\n\n---\n<!-- gobbi: ${meta.harness}@${meta.version} -->\n\n${incoming}`
}

export async function mergeJson(
  existing: string,
  incoming: string,
  onConflict: (
    key: string,
    existingVal: unknown,
    incomingVal: unknown,
  ) => Promise<'keep' | 'overwrite'>,
): Promise<string> {
  const existingObj = JSON.parse(existing) as Record<string, unknown>
  const incomingObj = JSON.parse(incoming) as Record<string, unknown>

  const result: Record<string, unknown> = { ...existingObj }

  for (const [key, incomingVal] of Object.entries(incomingObj)) {
    if (!(key in existingObj)) {
      result[key] = incomingVal
    } else {
      const choice = await onConflict(key, existingObj[key], incomingVal)
      if (choice === 'overwrite') {
        result[key] = incomingVal
      }
    }
  }

  return JSON.stringify(result, null, 2)
}
