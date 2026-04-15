import { Command } from 'commander'
import { createRecommendCommand } from './commands/recommend.js'

const program = new Command()

program
  .name('gobbi')
  .version('0.1.0')
  .description('Harness registry, benchmark, and installer CLI for coding agents')

program.addCommand(createRecommendCommand())

await program.parseAsync(process.argv)
