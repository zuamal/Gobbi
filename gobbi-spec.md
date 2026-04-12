# 고삐 (Gobbi) — Project Specification v1

> Harness registry, benchmark, and installer CLI for coding agents

---

## 1. Overview

### Problem

Coding agent harness engineering is exploding — CLAUDE.md, skills, hooks, MCP configurations, evaluator patterns, multi-agent orchestration setups — but there is no structured way to:

1. **Compare** harnesses quantitatively for a given coding agent
2. **Apply** a chosen harness to a project without manual setup

Developers spend more time configuring their agent harness than shipping code with it. Each coding agent (Claude Code, OpenCode, Codex, etc.) has its own ecosystem of community-built harnesses, but discovery and evaluation remain ad-hoc.

### Solution

**Gobbi** is an open-source CLI tool + harness registry that:

- Catalogs community-built harnesses per coding agent
- Benchmarks them on a standardized task subset (model fixed, harness as the only variable)
- Recommends harnesses based on user context (agent, language, framework, scale)
- Installs selected harness configurations into the user's project with one command

### Core Principle

The same model with a basic scaffold scores 23% on SWE-bench Pro. With an optimized scaffold, it scores 45%+. That 22-point swing dwarfs the ~1-point gap between frontier models. **The harness is the variable that matters most — Gobbi makes it accessible.**

---

## 2. Domain Model

| Entity | Description |
|---|---|
| **Agent** | Target coding agent (e.g., Claude Code, OpenCode). A harness belongs to exactly one agent. |
| **Harness** | A registered harness. Consists of a manifest + configuration files (CLAUDE.md, skills, hooks, MCP, etc.). |
| **BenchmarkSuite** | A standardized task subset used for evaluation (e.g., swe-bench-pro-mini). |
| **BenchmarkRun** | Execution result for a specific Harness × Agent × Model × BenchmarkSuite combination. Records pass rate, token usage, execution time. |
| **UserContext** | Conditions the user provides: agent, language, framework, scale (solo/team), project type. |
| **Match** | Recommendation output: ranked list of harnesses with scores and match reasoning. |

### Relationships

```
Agent 1──* Harness
Harness 1──* BenchmarkRun
BenchmarkRun *──1 BenchmarkSuite
UserContext → MatchEngine → Match[] (ranked Harness list)
```

---

## 3. CLI Interface

### Commands

```
gobbi list [--agent <name>]
gobbi recommend --agent <name> [--lang] [--framework] [--scale] [--sort <field>]
gobbi install <harness-name> [--only <components>] [--all]
gobbi uninstall <harness-name>
gobbi benchmark <harness-name>
```

### 3.1 `gobbi recommend`

**Input modes:**

- Flag-based: `gobbi recommend --agent claude-code --lang typescript --scale solo`
- Interactive: `gobbi recommend` (no flags) → sequential prompts for each condition

**Required input:** `--agent` only. All other fields are optional filters.

**Output:**

```
$ gobbi recommend --agent claude-code --lang typescript

  #  Harness                    Pass Rate  Tokens(avg)  Style
  1  celesteanders-harness      67.0%      2.8M         evaluator-separated, tdd
  2  claude-code-harness        63.5%      3.1M         plan-work-review, guardrail

  ── Unranked (benchmark pending) ──────────────────────────
  -  humanlayer-minimal         -          -            minimal, ship-fast

  Model: claude-sonnet-4-6 | Suite: swe-bench-pro-mini (20 tasks)
  Sort: --sort pass_rate (default) | Options: tokens, time, name
```

Harnesses without benchmark results are displayed in a separate **Unranked** section below the ranked list. They are not sorted by pass rate and show `-` for all metric fields.

**Sorting:** Default is `pass_rate` descending. User can change with `--sort tokens`, `--sort time`, `--sort name`.

### 3.2 `gobbi install`

**Default behavior:** Interactive component checklist.

```
$ gobbi install celesteanders-harness

  Components found:
  [x] CLAUDE.md
  [x] skills/ (3 files)
  [x] hooks/ (2 files)
  [ ] mcp.json

  Arrow keys to move, Space to toggle, Enter to confirm
```

**Shortcut flags:**

- `gobbi install celesteanders-harness --only skills,hooks` — install specific components
- `gobbi install celesteanders-harness --all` — install everything without confirmation

**Conflict handling (per file):**

```
  Conflict: CLAUDE.md already exists

  [d] Show diff
  [o] Overwrite with harness version
  [m] Merge (append harness content below existing)
  [s] Skip this file

  Choice:
```

**Merge strategy by file type:**

| File type | Merge behavior |
|---|---|
| `.md` files | Append with section divider |
| `.json` files | Shallow merge: keep existing keys, add new keys, prompt on conflicting keys |
| Other files | Overwrite or skip only (no merge option) |

**Lock file:** Generates `.gobbi-lock.json` recording installed components for `uninstall` support.

### 3.3 `gobbi uninstall`

Reads `.gobbi-lock.json` and removes installed files. Prompts before deletion if files have been modified since installation (checksum comparison).

### 3.4 `gobbi benchmark`

Runs the standardized benchmark suite against a harness in a Docker container.

```
$ gobbi benchmark celesteanders-harness

  Agent: claude-code
  Model: claude-sonnet-4-6
  Suite: swe-bench-pro-mini (20 tasks)
  Environment: docker (gobbi-runner:latest)

  Running... [████████░░░░░░░░] 8/20

  Results:
  Pass rate: 67.0% (14/20 tasks)  [sic: 13.4/20]
  Avg tokens: 2.8M per task
  Avg time: 145s per task

  Output: benchmarks/results/claude-code/celesteanders-harness.json
```

Outputs a result JSON with Docker image hash and execution checksum for integrity verification.

---

## 4. Benchmark Design

### Task Selection

- **Source:** SWE-bench Pro
- **Languages:** Python + TypeScript
- **Difficulty:** Middle band (30-70% pass rate range for frontier models)
- **Task types:** Even distribution across bug fix, refactoring, feature addition
- **Size:** 20 tasks

### Execution Model

- **V1:** Agent-specific benchmark runners (independent per agent)
- **Future:** Common task set with per-agent execution adapters
- **Rationale:** Gobbi's core value is comparing harnesses within the same agent, not across agents. Cross-agent abstraction is unnecessary overhead for V1.

### Variables

- **Fixed:** Model, benchmark suite, Docker environment
- **Variable:** Harness configuration only
- **Recorded:** Pass rate, total tokens consumed, average time per task

### Integrity

- Benchmark runs in a standardized Docker container (`gobbi-runner`)
- Result JSON includes Docker image hash and execution log checksum
- `submitted_by` field tracks self-submission vs maintainer-run (internal only, not displayed in recommendations)

---

## 5. Manifest Schema

Each harness has a `manifest.json`:

```json
{
  "name": "celesteanders-harness",
  "version": "1.2.0",
  "agent": "claude-code",
  "description": "Separated evaluator + JSON plan-based TDD harness",
  "tags": {
    "languages": ["python", "typescript"],
    "frameworks": ["any"],
    "scale": ["solo", "small-team"],
    "style": ["tdd", "plan-first", "evaluator-separated"]
  },
  "files": {
    "claude_md": "./CLAUDE.md",
    "skills": "./skills/",
    "hooks": "./hooks/",
    "mcp": "./mcp.json"
  },
  "benchmarks": [
    {
      "suite": "swe-bench-pro-mini",
      "model": "claude-sonnet-4-6",
      "model_version": "2026-03-01",
      "pass_rate": 0.67,
      "total_tokens": 2840000,
      "avg_time_sec": 145,
      "run_date": "2026-04-01",
      "docker_image_hash": "sha256:abc123...",
      "checksum": "a3f8..."
    }
  ]
}
```

The `benchmarks` field is **optional**. An empty array (`"benchmarks": []`) or omission of the field indicates the harness has not yet been benchmarked. Such harnesses are valid for registry inclusion and installation, but appear as **unranked** in `gobbi recommend` output.

Validated by `.gobbi-schema.json` (JSON Schema). CI enforces validation on every PR.

---

## 6. Repository Structure

```
gobbi/
├── registry/
│   ├── claude-code/
│   │   ├── celesteanders-harness/
│   │   │   ├── manifest.json
│   │   │   ├── CLAUDE.md
│   │   │   ├── skills/
│   │   │   ├── hooks/
│   │   │   └── mcp.json
│   │   ├── claude-code-harness/
│   │   └── humanlayer-minimal/
│   └── opencode/
│       ├── oh-my-openagent/
│       └── ...
│
├── benchmarks/
│   ├── suites/
│   │   └── swe-bench-pro-mini/
│   │       ├── suite.json
│   │       └── tasks/
│   ├── results/
│   │   ├── claude-code/
│   │   │   └── celesteanders-harness.json
│   │   └── opencode/
│   │       └── oh-my-openagent.json
│   └── runner/
│       ├── Dockerfile
│       └── run.sh
│
├── cli/
│   ├── src/
│   │   ├── commands/
│   │   │   ├── list.ts
│   │   │   ├── recommend.ts
│   │   │   ├── install.ts
│   │   │   ├── uninstall.ts
│   │   │   └── benchmark.ts
│   │   ├── matching/
│   │   │   └── engine.ts
│   │   ├── installer/
│   │   │   ├── conflict.ts
│   │   │   └── merge.ts
│   │   └── runner/
│   │       ├── docker.ts
│   │       └── verify.ts
│   ├── package.json
│   └── tsconfig.json
│
├── docs/
│   ├── contributing.md
│   ├── benchmark-methodology.md
│   └── ko/
│       ├── contributing.md
│       └── benchmark-methodology.md
│
├── .gobbi-schema.json
├── LICENSE (MIT)
├── gobbi-spec.md
└── README.md
```

---

## 7. Contribution Flow

### Submitting a Harness

1. Fork the repo
2. Create `registry/<agent>/<harness-name>/` with `manifest.json` + config files
3. *(Optional)* Run `gobbi benchmark <harness-name>` locally and include result JSON in the PR
4. If no benchmark result is included, the harness is merged as **unranked**. Maintainer may run benchmarks later.
5. CI validates: manifest schema check + result checksum integrity (if results are included)
6. Maintainer reviews and merges

### Benchmark Results

- Submitter may run benchmarks and include results (recorded as `submitted_by: "self"`)
- Maintainer may re-run benchmarks (recorded as `submitted_by: "maintainer"`)
- `submitted_by` is an internal field — not displayed in recommendations

---

## 8. Tech Stack

| Component | Choice | Rationale |
|---|---|---|
| CLI | TypeScript (Node.js) | Target users are in npm ecosystem; JSON-native |
| Package | npm (`gobbi`) | Standard distribution for CLI tools |
| Registry | Git repository (this repo) | No infra needed; PRs as submission mechanism |
| Benchmark runner | Docker | Reproducible environment |
| CI | GitHub Actions | Schema validation, checksum verification |
| License | MIT | Maximum adoption |

---

## 9. V1 Scope

### In scope

- 2 agents: Claude Code, OpenCode
- 3-5 harnesses per agent (empty registry at launch; harnesses added post-launch after license checks)
- SWE-bench Pro mini subset: 20 tasks, Python + TypeScript
- CLI: list, recommend, install, uninstall, benchmark
- Manifest schema + CI validation
- README in English + Korean

### Out of scope (future)

- Cross-agent harness comparison
- Web UI
- Automated harness optimization (Meta-Harness style)
- Paid tiers or hosted benchmarking service
- Additional agents beyond Claude Code and OpenCode

---

## 10. Open Decisions

| # | Decision | Status |
|---|---|---|
| 1 | Specific 20 tasks to include in swe-bench-pro-mini subset | Criteria defined (lang, difficulty, type balance). Actual task selection TBD at implementation. |
| 2 | Exact Docker base image for benchmark runner | TBD. Needs to support both Claude Code and OpenCode CLI execution. |
| 3 | CLI interactive UI library | TBD. Candidates: inquirer, prompts, clack. |
| 4 | Project name validation (npm `gobbi` availability) | TBD. Need to check npm registry. |
