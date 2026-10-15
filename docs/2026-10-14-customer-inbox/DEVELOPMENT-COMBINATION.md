# 네 기능의 로컬 조합 검수

2026-10-15, `codex/sendb-development-review`에서 네 승인 기능의 코드를 함께 적용한 뒤 전체 단위·타입·webpack 빌드를 한 번 수행했다. 개별 PR은 유지하며 이 브랜치는 로컬에만 둔다.

| 기능 | 승인 원본 커밋 |
|---|---|
| 채널톡 원본 추출·첨부 백업 | `65f2d04b2f067d7bc7037172d8fc606bcafe2b13` |
| 직원 문의별 초안·첨부 보존 | `d99746e3b7197644f64b143fe9c88910e5c2c3df` |
| 보관 첨부 일괄 보충 | `4646674d283ebdb44805a5175ef1404353d9254f` |
| 병합 전 AI 생성 이력 조회 | `d2635b1d86f0b9c414dcb7f3879f12d91e47ba56` |

기준은 `9a395e318b71d9bc3f29e56b2938ab837a3e9002`, 검사를 실행한 코드 HEAD는 `d960683be8d4820a7912cf4420158692a589fe64`다. 이후 커밋은 이 검수 기록만 추가한다. 제품/검사 소스 44개의 Git blob이 각 승인 원본과 모두 일치하며 제품 코드 충돌은 없었다. 문서 충돌은 각 기능의 근거를 보존해 정리했다.

- 전체 단위: 1,274개 통과, 실패·skip 0.
- 전체 타입: `tsc --noEmit --incremental false` 통과.
- 전체 빌드: `next build --webpack` 통과, 페이지 생성 단계 222/222 완료.
- 검사 전: JSON 15개 파싱, 충돌 표식 0, `git diff --check`, 원본 소스 비교 통과.

검사는 실제 환경 파일 없이 OS 필수 환경과 가상 DB 주소(127.0.0.1:1)를 사용했다. HTTP/TCP/TLS/DNS 연결을 차단했고 기존 의존성을 읽기 전용으로 재사용했으며 패키지 설치·공유 서버 변경은 없었다.

원본 기능별 UI/API 검수를 반복하지 않았다. `evidence-manifest.json`의 기존 QA 및 `currentSourceComparison`/`currentSourcesMatch`는 각 원래 커밋과 시점의 기록이다. staff/D3 파일 선택기 비교는 `comparisonProvenance`에 두 스냅샷을 함께 보존하며, 조합본의 44개 소스 비교는 별도 `developmentCombinationReview`와 외부 `four-heads.json`에만 기록한다. 따라서 과거의 개별 검수를 네 기능의 통합 UI/API 통과로 해석하지 않는다.

검수 원본은 `C:/Users/PW1234/Documents/ChatGPT/이삭/artifacts/development-combination-review`의 `four-heads.json`, `units.json/log`, `types.json/log`, `build.json/log`, `final-audit.json`이다. 최종 문서 커밋 HEAD와 원격 dev/main 불변 확인은 `final-audit.json`에 별도 기록한다.

실제 계정·고객 원본·모델 호출·서버 반영·현업 전환은 실행하지 않았다. 전체 대체의 R16은 완료로 판정하지 않는다.
