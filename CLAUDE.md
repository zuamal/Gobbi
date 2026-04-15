# Gobbi — CLAUDE.md

Harness registry, benchmark, and installer CLI for coding agents.
Single source of truth is `gobbi-spec.md`. This file is for reference only.
Registry lives in `registry/`, CLI source in `cli/src/`, benchmarks in `benchmarks/`.

---

## Stack

- **Runtime**: Node.js 20+, ESM only (`import/export`, no `require`)
- **Language**: TypeScript with `strict: true` — no `any`, no implicit types
- **CLI parsing**: commander
- **Interactive prompts**: @clack/prompts
- **Schema validation**: zod (manifest + lock file)
- **Testing**: vitest — implementation is not done until tests pass
- **Build**: tsup (single-file bundle)
- **Package manager**: pnpm
- **Logger**: No external library. User-facing messages use `@clack/prompts` log methods (`log.info`, `log.warn`, `log.error`). Debug output uses a thin internal wrapper over `process.stderr.write`.

---

## Agent Team Roles

Team lead is the human. Agents operate within strict boundaries.

### PM
**Allowed**: task decomposition, DoD writing, acceptance criteria, spec cross-checking, updating `docs/`, suggesting implementation direction (e.g. "conflict handling should be a separate module") 
**Not allowed**: code-level instructions (e.g. "write this function like X"), code review
**Output format**: task list with explicit DoD per item, handed to team lead for approval

### Dev
**Allowed**: implementing CLI commands, writing unit tests, updating `cli/src/`
**Not allowed**: modifying acceptance criteria, interpreting spec ambiguity without PM clarification
**Starts work only after**: team lead approves PM's plan for that command

### QA
**Allowed**: running vitest, writing failing test stubs, verifying DoD checklist, reporting issues
**Not allowed**: implementation, changing existing source files outside `*.test.ts`
**Output format**: pass/fail per DoD item + failing test stubs (handed to Dev if issues found)

---

## Workflow Per Command

```
Team lead → PM: "write task + DoD for gobbi <command>"
PM → Team lead: task list with DoD
Team lead: approve or revise
Team lead → Dev: approved plan
Dev: implement + unit tests
Dev → QA: "ready for review"
QA: run vitest + check DoD → report to team lead
Team lead: accept or send back to Dev
```

One command per cycle. Do not start the next command before the current one is QA-approved.

---

## Code Style (enforced, no exceptions)

- ESM only: `import { x } from 'y'`, never `require()`
- `strict: true` in tsconfig — treat type errors as blockers
- Functions over classes — no `class` unless a library forces it
- Every public function has an explicit return type annotation
- Async/await only, no raw Promise chains
- No `console.log` in production code — use a logger abstraction

---

## Key Invariants (do not break these)

**gobbi install**
- Never silently overwrite files — conflict flow is mandatory per file
- Merge rules: `.md` → append with divider, `.json` → shallow merge with prompt on key conflict, other → overwrite or skip only
- Always write `.gobbi-lock.json` with checksums after install

**gobbi uninstall**
- Read `.gobbi-lock.json` — never delete files not listed there
- If a file's checksum differs from lock, prompt before deletion

**gobbi recommend**
- Unranked harnesses (empty `benchmarks[]`) always render below ranked, never sorted into the ranked list
- Default sort: `pass_rate` descending

**gobbi benchmark**
- Runs in Docker (`gobbi-runner` image) — never on host directly
- Output JSON must include `docker_image_hash` and `checksum`

**manifest.json**
- Validate against `.gobbi-schema.json` via zod on every read
- `benchmarks` field is optional — missing or empty array = unranked

---

## Directory Layout

```
cli/src/commands/     — one file per command (list, recommend, install, uninstall, benchmark)
cli/src/matching/     — recommendation engine
cli/src/installer/    — conflict.ts, merge.ts
cli/src/runner/       — docker.ts, verify.ts
registry/             — harness manifests (read-only at runtime)
benchmarks/           — suites, results, runner
```

---

## What Counts as Done (global DoD)

A task is done when:
1. `pnpm typecheck` exits 0
2. `pnpm test` exits 0 (vitest, all related tests)
3. `pnpm build` exits 0
4. QA has checked every DoD item for that command and reported pass
