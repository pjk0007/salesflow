# 디자이너하이어 상담 연결 UX와 검수

2026-10-15 · [디하 웹 초안 PR25](https://github.com/matches-plan/new-designer-hire/pull/25), `codex/sendb-support-integration` / `03e864e12939b8248692e15233e043df0f7430f8`. 기준 main은 `025036ce6dbb917e0358b5f98b6558010a7df090`이다. 서버 교환은 [디하 서버 초안 PR1](https://github.com/matches-plan/designer-hire-server/pull/1), 샌드비 SDK/위젯은 [초안 PR14](https://github.com/pjk0007/salesflow/pull/14)에 의존한다. 모두 검토용이며 실제 서버/키/출처 설정·main/master 병합·운영 배포는 수행하지 않았다.

## 고객이 사용하는 흐름

| 상황 | 고객에게 보이는 동작 |
|---|---|
| 로그인 확인 중 | 계정 확인을 기다린다. 확인되지 않은 회원 상담을 시작하지 않는다 |
| 비회원 문의 | 기존 문의 버튼으로 샌드비 상담을 열고 이름·선택 이메일과 문의를 남긴다 |
| 처음 로그인 | 같은 브라우저의 비회원 문의를 확인된 회원에게 연결한다. 기존 회원 대화와 합치고 작성 중인 문장을 유지한다 |
| 회원 A→B, 로그아웃 | 이전 연결을 종료한다. 다른 회원이나 새 비회원에게 A의 이력/초안을 넘기지 않는다 |
| 연결 실패 | ‘상담 연결을 완료하지 못했어요 / 다시 연결’. 같은 회원 재시도는 열린 iframe과 초안을 보존한다 |
| 오래 걸린 이전 계정 응답 | 현재 계정이 달라지면 반영하지 않는다. Firebase 토큰을 받기 전후에도 현재 uid를 확인한다 |
| 프로젝트 채팅·가이드 | 각 화면의 숨김 이유를 합쳐 버튼/창을 숨긴다. 하나가 끝나도 다른 숨김 이유가 남으면 계속 숨긴다 |
| 상담 답변 수신 | 샌드비 수신함의 공개 답변을 같은 대화에서 받는다. 처음 열 때 최신 답변을 보여주며 과거 대화를 읽다가 다시 열면 읽던 위치를 유지한다 |

기존 설정·푸터·지원 알림의 문의 호출은 공통 ChannelService 어댑터를 사용한다. 기존 프로젝트 채팅과 Firestore 지원 알림의 자체 답장, 고객 여정 트래커 `window.sendb`는 유지한다. 새 상담 전역은 `window.SendbChat`이다. 그 자료까지 샌드비로 이전했다는 의미는 아니다.

## 검토 후 설치할 설정

실제 값은 이번 작업에서 생성/수정하지 않았다. 브라우저의 공개 변수는 `NEXT_PUBLIC_SUPPORT_PROVIDER=sendb`, `NEXT_PUBLIC_SENDB_SUPPORT_API_BASE`, `NEXT_PUBLIC_SENDB_SUPPORT_CHANNEL_KEY`, `NEXT_PUBLIC_SENDB_SUPPORT_IDENTITY_URL`이다. identity URL은 Firebase 함수까지 포함하는 전체 `/api/support/identity` 주소다. API 서비스 키·서명 비밀과 사업/채널 권한은 서버 전용이다.

공급자 미설정은 기존 채널톡을 유지한다. sendb 선택 후 설정/인증 실패는 오류를 표시하며 다른 고객의 익명 상담이나 채널톡을 자동 시작하지 않는다. SDK 1.2.0 이상의 `showLauncher/hideLauncher/getSessionType`가 필요하다. `getSessionType`은 SDK 로컬 상태이며 로그인 검증·접근 권한 증명이 아니다. 고객 검증과 범위 확인은 서버가 한다. 샌드비 설치 출처와 디하 서버 허용 origin을 함께 검토해야 한다.

서버의 Firebase 확인→고객 upsert→회원 인증과 재현 명령은 [SITE-INTEGRATION.md](SITE-INTEGRATION.md), SDK 계약은 [API.md](API.md)를 따른다. 관련 PR의 앱·서버·SDK 버전과 공개 설정을 함께 검토한 뒤 별도 승인된 환경에서 설치해야 한다.

## 확인한 검사와 한계

디하 컨트롤러/API 신규17·기존 포함67, 앱/테스트 TypeScript와 기능 lint를 통과했다. 원본 `_app.tsx`에도 있는 방문 기록 effect 경고1을 유지했다. 가상 환경 값·외부 fetch 차단 상태에서 전체 정적 빌드/30페이지 export를 확인했으며 저장소 전체 기존 lint 경고62(앞의1 포함)를 보존했다. 서버·배포 환경 파일이나 credential을 로드하지 않았다.

Chrome의 포트3124 검수 앱은 실제 디하 `useChannelTalk`, `ChannelService`, 새 상담 상태 UI를 가져온다. Firebase 계정·기존 전체 사업 페이지·운영 tracker는 로드하지 않고 가상 세션을 제공한다. 샌드비 실제 API/SQL은 별도 PGlite와 로컬 서버에서 실행한다. 비회원 문의→첫 로그인 이력/초안→전송, 회원 B 분리·로그아웃, 실패/재연결, 늦은 A 인증 후 B 유지, 관리자 제외, 중첩 숨김과 수신함 공개 답변→사이트 수신을 확인했다. 이는 실제 Firebase 로그인이나 전체 사이트의 운영 검수를 증명하지 않는다.

샌드비 SDK 실제 JS의 가상 DOM 검사4, 기존 플랫폼 API11·회원연결12도 통과했다. 일반 사이트 button CSS가 hidden을 덮던 문제를 inline display 제어로 보완하고 실제 화면에서 확인했다. 숨긴 위젯을 처음 열 때 최신 답변 대신 첫 대화가 보이던 문제는 열기 상태에도 스크롤 효과를 실행해 수정했으며, 위로 이동해 과거 대화를 읽다가 닫고 열 때 위치0을 유지하는 것을 확인했다.

검수 소스·로그·화면의 해시는 `evidence-manifest.json`의 `designerFrontendQa`에 기록한다. 로그와 이미지는 로컬 `artifacts/sendb-replacement-20261014`에 보존한다. 이전 `siteIdentityQa`는 당시 서버 검수의 기록이고 최신 프런트 진척은 새 필드를 따른다.

실제 설치/배포·Firebase/전체 페이지·팀 업무·부하·지원 자료 이전·백오랩 프런트 연결과 전체 서비스 전환은 남아 있다. 운영 DB 접근·실제 고객 대화·메일·SMS·Google Chat 전송은 수행하지 않았다.
