# Benchmark Methodology

## Philosophy

Gobbi's benchmark design rests on a single constraint: **the harness is the only variable**.

Model, benchmark suite, and execution environment are fixed. Every harness is evaluated under identical conditions. This makes pass rate, token usage, and execution time directly comparable across harnesses for the same agent — without confounding factors from model updates or infrastructure differences.

Gobbi does not compare harnesses across agents. Its core value is ranking harnesses *within* a given agent's ecosystem. Cross-agent comparison introduces too many variables to be meaningful in V1.

---

## Benchmark Suite: swe-bench-pro-mini

| Property | Value |
|---|---|
| Source | SWE-bench Pro |
| Task count | 20 |
| Languages | Python, TypeScript |
| Difficulty band | 30–70% pass rate for frontier models |
| Task types | Bug fix, refactoring, feature addition (evenly distributed) |

The difficulty band is intentional. Tasks where all models pass (or all fail) do not discriminate between harnesses. The middle band maximizes signal.

---

## Variables

### Fixed

| Variable | Value |
|---|---|
| Model | `claude-sonnet-4-6` |
| Benchmark suite | `swe-bench-pro-mini` |
| Docker image | `gobbi-runner:latest` |

### Variable (the only one)

| Variable | What changes |
|---|---|
| Harness configuration | CLAUDE.md, skills, hooks, MCP, etc. |

### Recorded

Each benchmark run records:

- **Pass rate** — fraction of tasks passed (e.g. `0.67` = 13/20)
- **Total tokens** — sum of tokens consumed across all tasks
- **Avg time per task** — mean wall-clock seconds

---

## Execution Environment

Benchmarks run inside a Docker container using the `gobbi-runner` image. Running benchmarks directly on the host is not supported.

The Docker container:

- Has the target agent CLI pre-installed
- Mounts the harness directory read-only at `/harness`
- Executes the benchmark suite against the mounted harness configuration
- Outputs a result JSON to stdout on completion

This design ensures every benchmark run starts from an identical, clean state regardless of the submitter's local environment.

---

## Integrity Verification

Every result JSON includes two integrity fields:

| Field | Description |
|---|---|
| `docker_image_hash` | SHA-256 digest of the `gobbi-runner` image used. Confirms the execution environment. |
| `checksum` | SHA-256 hash of the full execution log. Confirms the result has not been modified after the run. |

Both fields are verified by CI when a benchmark result is included in a PR.

---

## `submitted_by` Field

| Value | Meaning |
|---|---|
| `"self"` | The harness author ran `gobbi benchmark` locally and included the result |
| `"maintainer"` | A maintainer independently re-ran the benchmark |

This field is internal. It is stored in the result JSON but never displayed in `gobbi recommend` output. It exists so maintainers can distinguish self-reported results from independently verified ones.
