import { computeStringChecksum } from '../installer/checksum.js'
import type { RawBenchmarkResult } from './docker.js'

export function computeExecutionChecksum(executionLog: string): string {
  return computeStringChecksum(executionLog)
}

export function aggregateResults(raw: RawBenchmarkResult): {
  passRate: number
  passCount: number
  totalCount: number
  totalTokens: number
  avgTimeSec: number
} {
  const totalCount = raw.tasks.length

  if (totalCount === 0) {
    return {
      passRate: 0,
      passCount: 0,
      totalCount: 0,
      totalTokens: 0,
      avgTimeSec: 0,
    }
  }

  const passCount = raw.tasks.filter((t) => t.passed).length
  const totalTokens = raw.tasks.reduce((sum, t) => sum + t.tokens, 0)
  const totalTime = raw.tasks.reduce((sum, t) => sum + t.time_sec, 0)

  return {
    passRate: passCount / totalCount,
    passCount,
    totalCount,
    totalTokens,
    avgTimeSec: totalTime / totalCount,
  }
}
