import { log } from '@clack/prompts'

export function info(message: string): void {
  log.info(message)
}

export function warn(message: string): void {
  log.warn(message)
}

export function error(message: string): void {
  log.error(message)
}

export function debug(message: string): void {
  if (process.env['DEBUG'] === 'gobbi') {
    process.stderr.write(`[debug] ${message}\n`)
  }
}
