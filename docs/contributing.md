# Contributing to Gobbi

## Overview

There are two ways to contribute to the registry:

1. **Submit a harness** — add your agent configuration to `registry/` so others can install it
2. **Add benchmark results** — run the standard suite against an existing harness and include the results

In both cases, a pull request is the submission mechanism. No hosted service or API key required.

---

## Submitting a Harness

1. Fork the repository
2. Create `registry/<agent>/<harness-name>/` with a `manifest.json` and your configuration files
3. *(Optional)* Run `gobbi benchmark <harness-name>` locally and include the result JSON in your PR
4. If no benchmark result is included, the harness is merged as **unranked** and will appear below ranked harnesses in `gobbi recommend`. Maintainers may run benchmarks later.
5. CI validates the manifest schema and, if results are included, verifies the result checksum
6. A maintainer reviews and merges

---

## Registry Structure

```
registry/
└── <agent-name>/           e.g. claude-code, opencode
    └── <harness-name>/     e.g. celesteanders-harness
        ├── manifest.json   required
        ├── CLAUDE.md
        ├── skills/
        ├── hooks/
        └── mcp.json
```

The directory names (`<agent-name>`, `<harness-name>`) must match the `agent` and `name` fields in `manifest.json`.

---

## `manifest.json` Field Reference

| Field | Required | Description |
|---|---|---|
| `name` | yes | Harness identifier. Must match the directory name. |
| `version` | yes | Semantic version (e.g. `"1.2.0"`) |
| `agent` | yes | Target agent. Must match the parent directory name. |
| `description` | yes | One-line description |
| `published_at` | yes | Publication date in ISO 8601 format (`YYYY-MM-DD`) |
| `tags.languages` | yes | Languages this harness is suited for. Use `["any"]` for language-agnostic. |
| `tags.frameworks` | yes | Frameworks. Use `["any"]` if not framework-specific. |
| `tags.scale` | yes | Team scale: `solo`, `small-team`, etc. |
| `tags.style` | yes | Style tags: `tdd`, `plan-first`, `evaluator-separated`, etc. |
| `files` | yes | Paths to installable files or directories |
| `benchmarks` | no | Benchmark results. Omit or leave empty for unranked. |

### Example `manifest.json`

```json
{
  "name": "celesteanders-harness",
  "version": "1.2.0",
  "agent": "claude-code",
  "description": "Separated evaluator + JSON plan-based TDD harness",
  "published_at": "2026-04-01",
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
      "checksum": "sha256:a3f8..."
    }
  ]
}
```

---

## Including Benchmark Results

Benchmark results are optional but strongly encouraged. Including them makes your harness eligible for ranked placement in `gobbi recommend`.

1. Run the benchmark locally:
   ```bash
   gobbi benchmark <harness-name>
   ```
2. The result is written to `benchmarks/results/<agent>/<harness-name>.json`
3. Copy the result object into the `benchmarks` array in your `manifest.json`
4. Include both the updated `manifest.json` and the result JSON file in your PR

Results submitted by the contributor are recorded as `submitted_by: "self"`. Maintainers may re-run benchmarks independently; those are recorded as `submitted_by: "maintainer"`. This field is internal and not shown in recommendations.

---

## CI Checks

Every PR that touches `registry/` runs:

- **Manifest schema validation** — validates `manifest.json` against `.gobbi-schema.json`
- **Benchmark result integrity** — if a result JSON is included, verifies the `checksum` field matches the execution log

CI must pass before a PR can be merged.

---

## PR Rules

- One harness per PR
- `manifest.json` must be included
- If your harness is derived from an existing project, confirm the license permits redistribution and note it in the PR description
