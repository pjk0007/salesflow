# 실제 사이트 소스 확인

2026-10-15 확인. GitHub 앱의 설치 계정은 `isaackimmatches`만 표시했고 앱 목록에는 `matches-plan` 저장소가 나오지 않았다. 기존 Git 로그인은 같은 사용자의 `matches-plan` 조직 접근 권한을 갖고 있었으며 GitHub API로 비공개 소스를 조회할 수 있었다. 저장소가 없거나 사용자가 접근할 수 없다는 결론은 잘못이었다. 인증 정보는 출력·저장하지 않았다.

| 대상 | 확인한 소스 | 근거와 남은 확인 |
|---|---|---|
| 디하 웹 | [matches-plan/new-designer-hire](https://github.com/matches-plan/new-designer-hire), main `025036ce6dbb917e0358b5f98b6558010a7df090` | Pages Router·Firebase Auth/Firestore·정적 export 지침. `src/hooks/common/useChannelTalk.ts`에서 boot/shutdown과 채팅 페이지 숨김, `FireAuthProvider.tsx`에서 Firebase 회원 확인과 기존 Sendb 트래커 identify를 확인. 새 상담 SDK의 서버 확인 회원 JWT 발급 경로는 아직 연결하지 않음 |
| 디하 서버 | [matches-plan/designer-hire-server](https://github.com/matches-plan/designer-hire-server), master `3d09f62931b9e8960cf89c981d8111beece1f96c` | Firebase Cloud Functions·Express·firebase-admin 패키지, 공개 API sessionAuth/apiKeyAuth 소스 경로. 실제 auth middleware 동작·새 상담 토큰 발급 구현과 배포는 후속 |
| 백오랩 웹 | [matches-plan/back-office-lab](https://github.com/matches-plan/back-office-lab), main `6604ba06ce3624f68a420078c2d32d1bdd12ad51` | Next Node 서버. `_app.tsx`의 채널톡 hook, hook의 한 번 boot/상담 열기 분석 이벤트, README의 기존 Sendb 문의 저장과 로컬 검증 시 모의 서버 필요 조건 확인. 새 상담 SDK 설치·기존 CTA 연결·실제 배포 대상 대조는 후속 |

위 SHA는 후속 `git ls-remote --heads`로 각 원격 기본 브랜치 커밋과 일치함을 확인했다. 이 저장소의 최신 소스가 현재 운영 도메인의 배포 커밋이라고 아직 확인하지 않았다. 비슷한 이름의 `designer-hire`(2025년 마지막 push), `backofficelab`, `back_office_lab`도 있어 이름이나 최근 수정 시각만으로 운영 대상을 확정하지 않는다.

디하 프런트는 정적 export이므로 서비스 API 키나 회원 서명 비밀을 넣을 수 없다. 기존 Firebase 로그인 증명은 서버에서 검증한 뒤 샌드비의 사업별 짧은 회원 인증으로 교환해야 한다. 백오랩은 서버 API를 가진 구조여서 서버 설정과 모의 전송 경로를 대조한 뒤 연결할 수 있다. 기존 고객 여정 트래커 `window.sendb`와 새 상담 위젯 전역 이름도 별도 확인해야 한다.

세 저장소를 환경/credential 파일을 제외한 sparse checkout으로 `F:/Dev/sendb-sites`에 준비하고 각각 `codex/sendb-support-integration` 브랜치를 만들었다. 디하 서버에는 Firebase 확인→샌드비 고객/JWT 교환을 구현해 [서버 초안 PR #1](https://github.com/matches-plan/designer-hire-server/pull/1)에 올렸다. 서버 단위95(신규15)·교차 SQL/API8 검증과 한계는 [SITE-INTEGRATION.md](SITE-INTEGRATION.md)에 기록했다. 두 웹 프런트의 위젯/로그인 연결은 아직 수정하지 않았다. 키 발급·실제 DB 접근·고객 메일/SMS·실제 서버 설정/배포는 수행하지 않았고 로컬 Electron 앱의 기존 변경도 보존했다.
