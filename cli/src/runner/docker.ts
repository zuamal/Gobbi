import { spawn } from 'node:child_process'

export interface BenchmarkOptions {
  harnessSrcPath: string
  agent: string
  suite: string
  model: string
}

export interface TaskProgress {
  completed: number
  total: number
}

export interface RawBenchmarkResult {
  tasks: Array<{ id: string; passed: boolean; tokens: number; time_sec: number }>
  model_version: string
  execution_log: string
}

export interface DockerRunResult {
  raw: RawBenchmarkResult
  dockerImageHash: string
}

export async function isDockerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('docker', ['info'])
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

export async function getDockerImageHash(imageName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'inspect',
      `${imageName}:latest`,
      '--format={{.Id}}',
    ])

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (err) => reject(err))

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`docker inspect failed (exit ${code}): ${stderr.trim()}`))
        return
      }
      const hash = stdout.trim()
      resolve(hash.startsWith('sha256:') ? hash : `sha256:${hash}`)
    })
  })
}

export async function runBenchmarkInDocker(
  options: BenchmarkOptions,
  onProgress: (progress: TaskProgress) => void,
): Promise<DockerRunResult> {
  const dockerImageHash = await getDockerImageHash('gobbi-runner')

  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'run',
      '--rm',
      '-v',
      `${options.harnessSrcPath}:/harness:ro`,
      'gobbi-runner',
      'run',
      '--suite',
      options.suite,
      '--model',
      options.model,
    ])

    const lines: string[] = []
    let buffer = ''

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const parts = buffer.split('\n')
      buffer = parts.pop() ?? ''

      for (const line of parts) {
        const trimmed = line.trim()
        if (!trimmed) continue

        lines.push(trimmed)

        const progressMatch = /^PROGRESS (\d+)\/(\d+)/.exec(trimmed)
        if (progressMatch) {
          onProgress({
            completed: parseInt(progressMatch[1], 10),
            total: parseInt(progressMatch[2], 10),
          })
        }
      }
    })

    child.on('error', (err) => reject(err))

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Docker container exited with code ${code}`))
        return
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        lines.push(buffer.trim())
      }

      let lastLine: string | undefined
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i]!.startsWith('{')) {
          lastLine = lines[i]
          break
        }
      }
      if (!lastLine) {
        reject(new Error('No JSON result found in benchmark output'))
        return
      }

      let raw: RawBenchmarkResult
      try {
        raw = JSON.parse(lastLine) as RawBenchmarkResult
      } catch {
        reject(new Error('Failed to parse benchmark output.'))
        return
      }

      resolve({ raw, dockerImageHash })
    })
  })
}
