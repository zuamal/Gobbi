# Gobbi

> Harness registry, benchmark, and installer CLI for coding agents

[한국어](README.ko.md)

## Why Gobbi

The same model with a basic scaffold scores 23% on SWE-bench Pro. With an optimized scaffold, it scores 45%+. That 22-point swing dwarfs the ~1-point gap between frontier models. **The harness is the variable that matters most — Gobbi makes it accessible.**

Gobbi is an open-source CLI that:

- Catalogs community-built harnesses per coding agent
- Benchmarks them on a standardized task subset (model fixed, harness as the only variable)
- Recommends harnesses based on your context (agent, language, framework, scale)
- Installs selected harness configurations into your project with one command

## Installation

```bash
npm install -g @zuamal/gobbi
```

## Commands

### `gobbi list`

List all harnesses in the registry, grouped by agent.

```bash
# All agents
gobbi list

# One agent
gobbi list --agent claude-code
```

### `gobbi recommend`

Get a ranked recommendation based on your context.

```bash
gobbi recommend --agent claude-code --lang typescript --scale solo
```

Run without flags for interactive mode:

```bash
gobbi recommend
```

### `gobbi install`

Install a harness into your project. Prompts for component selection and handles file conflicts.

```bash
# Interactive component selection
gobbi install celesteanders-harness

# Install specific components
gobbi install celesteanders-harness --only skills,hooks

# Install everything (still prompts on file conflicts)
gobbi install celesteanders-harness --all
```

### `gobbi uninstall`

Remove an installed harness. Reads `.gobbi-lock.json` and restores or removes files according to the recorded install strategy.

```bash
gobbi uninstall celesteanders-harness
```

### `gobbi benchmark`

Run the standardized benchmark suite against a harness inside a Docker container.

```bash
gobbi benchmark celesteanders-harness
```

## Contributing

See [docs/contributing.md](docs/contributing.md) to submit a harness or add benchmark results.

## License

MIT
