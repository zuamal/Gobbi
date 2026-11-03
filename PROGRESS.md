---
name: 고삐
type: other
status: paused
stages: [CLI 개발, npm 배포, 벤치마크 구축, 레지스트리 확장]
stage: 벤치마크 구축
next: swe-bench-pro-mini 20개 태스크 목록 확정
resume: v0.1.1을 npm에 배포하고 vanilla 하네스만 등록한 상태(2026-04-19). benchmarks/ 디렉토리(suite·runner Dockerfile)를 만들고, gobbi-spec.md §10의 미결정 1·2번(태스크 20개, Docker 베이스 이미지)부터 정하면 됨.
---

## CLI 개발
- [x] CLI 스캐폴드와 list 커맨드
- [x] recommend 커맨드 (매칭 엔진, unranked 분리)
- [x] install 커맨드 (충돌 처리, 병합, lock 파일)
- [x] uninstall 커맨드 (체크섬 비교, 백업 복원)
- [x] benchmark 커맨드 (Docker 러너, 결과 체크섬)
- [x] manifest 스키마 생성과 통합 테스트
- [x] 영/한 문서 (README, contributing, benchmark 방법론)

## npm 배포
- [x] 패키지명 @zuamal/gobbi로 확정
- [x] tsup 번들과 패키징 설정
- [x] npm 0.1.1 배포
- [x] vanilla 기준 하네스 등록 (claude-code, opencode)

## 벤치마크 구축
- [ ] swe-bench-pro-mini 20개 태스크 선정 (Python·TypeScript, 중간 난이도)
- [ ] Docker 베이스 이미지 확정과 gobbi-runner 이미지 작성
- [ ] benchmarks/suites, benchmarks/runner 디렉토리 구성
- [ ] vanilla 하네스로 기준 점수 실측
- [ ] 실측 결과를 manifest benchmarks에 기록

## 레지스트리 확장
- [ ] 라이선스 확인 후 claude-code 하네스 3~5개 등록
- [ ] 라이선스 확인 후 opencode 하네스 3~5개 등록
- [ ] PR CI: manifest 스키마와 결과 체크섬 검증
- [ ] 등록 하네스 벤치마크 실행으로 recommend 순위 채우기
