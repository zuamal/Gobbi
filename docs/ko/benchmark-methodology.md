# Benchmark 방법론

## 철학

Gobbi의 benchmark 설계는 하나의 원칙에 기반합니다: **harness가 유일한 변수입니다.**

모델, benchmark suite, 실행 환경은 고정됩니다. 모든 harness는 동일한 조건에서 평가됩니다. 이를 통해 pass rate, 토큰 사용량, 실행 시간을 동일 에이전트 내 harness 간에 직접 비교할 수 있습니다 — 모델 업데이트나 인프라 차이로 인한 혼란 없이.

Gobbi는 에이전트 간 harness 비교를 지원하지 않습니다. 핵심 가치는 특정 에이전트 생태계 *안에서* harness 순위를 매기는 것입니다. 에이전트 간 비교는 너무 많은 변수를 포함해 V1에서는 의미있는 결과를 내기 어렵습니다.

---

## Benchmark Suite: swe-bench-pro-mini

| 속성 | 값 |
|---|---|
| 출처 | SWE-bench Pro |
| 태스크 수 | 20개 |
| 언어 | Python, TypeScript |
| 난이도 범위 | 프런티어 모델 기준 pass rate 30–70% |
| 태스크 유형 | 버그 수정, 리팩토링, 기능 추가 (균등 분포) |

난이도 범위 설정은 의도적입니다. 모든 모델이 통과하거나 모두 실패하는 태스크는 harness 간 차이를 드러내지 못합니다. 중간 난이도 범위에서 신호가 가장 강하게 나타납니다.

---

## 변수

### 고정 변수

| 변수 | 값 |
|---|---|
| 모델 | `claude-sonnet-4-6` |
| Benchmark suite | `swe-bench-pro-mini` |
| Docker 이미지 | `gobbi-runner:latest` |

### 가변 변수 (유일한 변수)

| 변수 | 변경되는 것 |
|---|---|
| Harness 설정 | CLAUDE.md, skills, hooks, MCP 등 |

### 기록 항목

각 benchmark 실행은 다음을 기록합니다:

- **Pass rate** — 통과한 태스크 비율 (예: `0.67` = 13/20)
- **Total tokens** — 전체 태스크에서 소비된 토큰 합계
- **Avg time per task** — 태스크당 평균 소요 시간 (초)

---

## 실행 환경

Benchmark는 `gobbi-runner` 이미지를 사용하는 Docker 컨테이너 안에서 실행됩니다. 호스트에서 직접 실행하는 방식은 지원하지 않습니다.

Docker 컨테이너는:

- 대상 에이전트 CLI가 사전 설치되어 있습니다
- harness 디렉토리를 읽기 전용으로 `/harness`에 마운트합니다
- 마운트된 harness 설정을 대상으로 benchmark suite를 실행합니다
- 완료 시 결과 JSON을 stdout으로 출력합니다

이 구조 덕분에 모든 benchmark 실행은 제출자의 로컬 환경과 무관하게 동일하고 깨끗한 상태에서 시작됩니다.

---

## 무결성 검증

모든 결과 JSON에는 두 가지 무결성 필드가 포함됩니다:

| 필드 | 설명 |
|---|---|
| `docker_image_hash` | 사용된 `gobbi-runner` 이미지의 SHA-256 digest. 실행 환경을 확인합니다. |
| `checksum` | 전체 실행 로그의 SHA-256 해시. 실행 후 결과가 수정되지 않았음을 확인합니다. |

두 필드 모두 benchmark 결과가 포함된 PR에서 CI가 검증합니다.

---

## `submitted_by` 필드

| 값 | 의미 |
|---|---|
| `"self"` | harness 작성자가 직접 `gobbi benchmark`를 실행해 포함한 결과 |
| `"maintainer"` | 메인테이너가 독립적으로 재실행한 결과 |

이 필드는 내부용입니다. 결과 JSON에 저장되지만 `gobbi recommend` 출력에는 표시되지 않습니다. 자체 제출 결과와 독립 검증 결과를 구분하기 위해 존재합니다.
