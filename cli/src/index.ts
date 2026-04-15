import { Command } from 'commander'

const program = new Command()

program
  .name('gobbi')
  .version('0.1.0')
  .description('Harness registry, benchmark, and installer CLI for coding agents')

await program.parseAsync(process.argv)
