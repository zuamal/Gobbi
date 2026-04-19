# Gobbi

> 코딩 에이전트를 위한 harness registry, benchmark, installer CLI

[English](README.md)

## Gobbi를 사용하는 이유

기본 scaffold로 실행한 모델은 SWE-bench Pro에서 23%를 기록합니다. 최적화된 scaffold를 사용하면 45% 이상으로 오릅니다. 이 22포인트 차이는 프런티어 모델 간 격차(~1포인트)를 훨씬 뛰어넘습니다. **가장 중요한 변수는 harness입니다 — Gobbi는 그 접근을 쉽게 만듭니다.**

Gobbi는 오픈소스 CLI로 다음을 제공합니다:

- 코딩 에이전트별 커뮤니티 harness 목록 관리
- 표준화된 태스크 서브셋으로 harness 벤치마크 (모델 고정, harness만 변수)
- 사용자 컨텍스트(에이전트, 언어, 프레임워크, 규모) 기반 harness 추천
- 선택한 harness를 프로젝트에 한 번에 설치

## 설치

```bash
npm install -g @zuamal/gobbi
```

## 커맨드

### `gobbi list`

registry의 harness 목록을 에이전트별로 그룹핑해 표시합니다.

```bash
# 전체 에이전트
gobbi list

# 특정 에이전트
gobbi list --agent claude-code
```

### `gobbi recommend`

컨텍스트 기반으로 harness를 순위 추천합니다.

```bash
gobbi recommend --agent claude-code --lang typescript --scale solo
```

플래그 없이 실행하면 인터랙티브 모드로 진행됩니다:

```bash
gobbi recommend
```

### `gobbi install`

harness를 프로젝트에 설치합니다. 컴포넌트 선택과 파일 충돌을 대화형으로 처리합니다.

```bash
# 컴포넌트 선택 화면
gobbi install celesteanders-harness

# 특정 컴포넌트만 설치
gobbi install celesteanders-harness --only skills,hooks

# 전체 설치 (파일 충돌 시에는 여전히 확인 프롬프트 표시)
gobbi install celesteanders-harness --all
```

### `gobbi uninstall`

설치된 harness를 제거합니다. `.gobbi-lock.json`을 읽어 기록된 install strategy에 따라 파일을 복원하거나 삭제합니다.

```bash
gobbi uninstall celesteanders-harness
```

### `gobbi benchmark`

Docker 컨테이너 안에서 표준 benchmark suite를 실행합니다.

```bash
gobbi benchmark celesteanders-harness
```

## 기여하기

harness 제출 또는 benchmark 결과 추가 방법은 [docs/ko/contributing.md](docs/ko/contributing.md)를 참고하세요.

## 라이선스

MIT
