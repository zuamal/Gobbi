# Gobbi 기여 가이드

## 개요

registry에 기여하는 방법은 두 가지입니다:

1. **harness 제출** — `registry/`에 에이전트 설정을 추가해 다른 사람들이 설치할 수 있게 합니다
2. **benchmark 결과 추가** — 기존 harness에 표준 suite 실행 결과를 포함합니다

두 경우 모두 pull request가 제출 수단입니다. 별도 서비스나 API 키가 필요하지 않습니다.

---

## harness 제출 절차

1. 리포지터리를 Fork합니다
2. `registry/<agent>/<harness-name>/` 디렉토리를 만들고 `manifest.json`과 설정 파일을 추가합니다
3. *(선택)* `gobbi benchmark <harness-name>`을 로컬에서 실행하고 결과 JSON을 PR에 포함합니다
4. benchmark 결과를 포함하지 않으면 harness는 **unranked**로 병합됩니다. `gobbi recommend`에서 ranked harness 아래에 표시됩니다. 메인테이너가 나중에 benchmark를 실행할 수 있습니다.
5. CI가 manifest schema와 결과 checksum(결과 포함 시)을 검증합니다
6. 메인테이너가 검토 후 병합합니다

---

## registry 구조

```
registry/
└── <agent-name>/           예: claude-code, opencode
    └── <harness-name>/     예: celesteanders-harness
        ├── manifest.json   필수
        ├── CLAUDE.md
        ├── skills/
        ├── hooks/
        └── mcp.json
```

디렉토리 이름(`<agent-name>`, `<harness-name>`)은 `manifest.json`의 `agent` 및 `name` 필드와 일치해야 합니다.

---

## `manifest.json` 필드 설명

| 필드 | 필수 | 설명 |
|---|---|---|
| `name` | 필수 | harness 식별자. 디렉토리 이름과 일치해야 합니다. |
| `version` | 필수 | Semantic version (예: `"1.2.0"`) |
| `agent` | 필수 | 대상 에이전트. 상위 디렉토리 이름과 일치해야 합니다. |
| `description` | 필수 | 한 줄 설명 |
| `published_at` | 필수 | 공개일 (ISO 8601 형식, `YYYY-MM-DD`) |
| `tags.languages` | 필수 | 지원 언어. 언어 무관이면 `["any"]` |
| `tags.frameworks` | 필수 | 지원 프레임워크. 무관이면 `["any"]` |
| `tags.scale` | 필수 | 팀 규모: `solo`, `small-team` 등 |
| `tags.style` | 필수 | 스타일 태그: `tdd`, `plan-first`, `evaluator-separated` 등 |
| `files` | 필수 | 설치 대상 파일 또는 디렉토리 경로 |
| `benchmarks` | 선택 | benchmark 결과 배열. 없으면 unranked. |

### `manifest.json` 예시

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

## benchmark 결과 포함 방법

benchmark 결과는 선택 사항이지만 강력히 권장합니다. 결과를 포함하면 `gobbi recommend`에서 ranked 목록에 표시됩니다.

1. 로컬에서 benchmark를 실행합니다:
   ```bash
   gobbi benchmark <harness-name>
   ```
2. 결과 파일이 `benchmarks/results/<agent>/<harness-name>.json`에 생성됩니다
3. 결과 객체를 `manifest.json`의 `benchmarks` 배열에 추가합니다
4. 수정된 `manifest.json`과 결과 JSON 파일을 모두 PR에 포함합니다

기여자가 직접 실행한 결과는 `submitted_by: "self"`로 기록됩니다. 메인테이너가 독립적으로 재실행한 결과는 `submitted_by: "maintainer"`로 기록됩니다. 이 필드는 내부용이며 추천 결과에 표시되지 않습니다.

---

## CI 검증 항목

`registry/`를 수정하는 모든 PR에서 다음을 실행합니다:

- **manifest schema 검증** — `manifest.json`을 `.gobbi-schema.json` 기준으로 검증합니다
- **benchmark 결과 무결성** — 결과 JSON이 포함된 경우 `checksum` 필드가 실행 로그와 일치하는지 확인합니다

CI를 통과해야 PR을 병합할 수 있습니다.

---

## PR 규칙

- PR 하나당 harness 하나
- `manifest.json` 필수 포함
- 기존 프로젝트에서 파생된 harness인 경우 라이선스를 확인하고 PR 설명에 명시하세요
