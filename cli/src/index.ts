import { Command } from 'commander'
import { createRecommendCommand } from './commands/recommend.js'
import { createInstallCommand } from './commands/install.js'

const program = new Command()

program
  .name('gobbi')
  .version('0.1.0')
  .description('Harness registry, benchmark, and installer CLI for coding agents')

program.addCommand(createRecommendCommand())
program.addCommand(createInstallCommand())

await program.parseAsync(process.argv)
