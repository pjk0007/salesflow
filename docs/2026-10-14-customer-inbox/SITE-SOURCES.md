# 실제 사이트 소스 확인

2026-10-15 확인. GitHub 앱의 설치 계정은 `isaackimmatches`만 표시했고 앱 목록에는 `matches-plan` 저장소가 나오지 않았다. 기존 Git 로그인은 같은 사용자의 `matches-plan` 조직 접근 권한을 갖고 있었으며 GitHub API로 비공개 소스를 조회할 수 있었다. 저장소가 없거나 사용자가 접근할 수 없다는 결론은 잘못이었다. 인증 정보는 출력·저장하지 않았다.

| 대상 | 확인한 소스 | 근거와 남은 확인 |
|---|---|---|
| 디하 웹 | [matches-plan/new-designer-hire](https://github.com/matches-plan/new-designer-hire), 기준 main `025036ce6dbb917e0358b5f98b6558010a7df090` | Pages Router·Firebase Auth/Firestore·정적 export. 기존 채널톡 호출 지점에 샌드비 SDK와 서버 회원 교환 어댑터를 연결해 별도 브랜치 `03e864e`·초안 PR25로 검토. 여정 tracker/프로젝트 채팅 유지. 실제 로그인·배포 검수는 후속 |
| 디하 서버 | [matches-plan/designer-hire-server](https://github.com/matches-plan/designer-hire-server), 기준 master `3d09f62931b9e8960cf89c981d8111beece1f96c` | Firebase Cloud Functions·Express·firebase-admin. Firebase 확인/회수·서버 고객 문서→샌드비 인증 교환 구현은 별도 브랜치 `a546d56`·초안 PR1, 가상 공급자 검수 완료. 실제 서버 배포는 후속 |
| 백오랩 웹 | [matches-plan/back-office-lab](https://github.com/matches-plan/back-office-lab), main `6604ba06ce3624f68a420078c2d32d1bdd12ad51` | Next Node 서버. `_app.tsx`의 채널톡 hook, hook의 한 번 boot/상담 열기 분석 이벤트, README의 기존 Sendb 문의 저장과 로컬 검증 시 모의 서버 필요 조건 확인. 새 상담 SDK 설치·기존 CTA 연결·실제 배포 대상 대조는 후속 |

위 SHA는 후속 `git ls-remote --heads`로 각 원격 기본 브랜치 커밋과 일치함을 확인했다. 이 저장소의 최신 소스가 현재 운영 도메인의 배포 커밋이라고 아직 확인하지 않았다. 비슷한 이름의 `designer-hire`(2025년 마지막 push), `backofficelab`, `back_office_lab`도 있어 이름이나 최근 수정 시각만으로 운영 대상을 확정하지 않는다.

디하 프런트는 정적 export이므로 서비스 API 키나 회원 서명 비밀을 넣을 수 없다. 기존 Firebase 로그인 증명은 서버에서 검증한 뒤 샌드비의 사업별 짧은 회원 인증으로 교환해야 한다. 백오랩은 서버 API를 가진 구조여서 서버 설정과 모의 전송 경로를 대조한 뒤 연결할 수 있다. 기존 고객 여정 트래커 `window.sendb`와 새 상담 위젯 전역 이름도 별도 확인해야 한다.

세 저장소를 환경/credential 파일을 제외한 sparse checkout으로 `F:/Dev/sendb-sites`에 준비하고 각각 `codex/sendb-support-integration` 브랜치를 만들었다. 디하 서버의 [초안 PR1](https://github.com/matches-plan/designer-hire-server/pull/1)에 더해 디하 웹의 [초안 PR25](https://github.com/matches-plan/new-designer-hire/pull/25)에 위젯/회원 연결을 올렸다. 서버 단위95(신규15)·교차 SQL/API8, 프런트 단위67(신규17)·격리 정적 빌드·실제 어댑터 Chrome 검증과 한계는 [SITE-INTEGRATION.md](SITE-INTEGRATION.md), [DESIGNER-SITE.md](DESIGNER-SITE.md)에 기록했다. 백오랩 웹 연결은 후속이다. 키 발급·실제 DB 접근·고객 메일/SMS·실제 서버 설정/배포는 수행하지 않았고 로컬 Electron 앱의 기존 변경도 보존했다.
