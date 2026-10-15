# 백오피스랩 신청 후 상담 연결

2026-10-15 · [백오랩 웹 초안 PR2](https://github.com/matches-plan/back-office-lab/pull/2), `codex/sendb-support-integration` / `ad32e4555725272fe2851430a3b5cbeea272bac2`. 기준 main은 `6604ba06ce3624f68a420078c2d32d1bdd12ad51`이다. [샌드비 초안 PR14](https://github.com/pjk0007/salesflow/pull/14)의 SDK1.3과 비회원 입력 정보 API에 의존한다. 실제 설정/키 변경·main 병합·운영 서버 배포는 수행하지 않았다.

## 고객과 상담원의 흐름

| 상황 | 동작 |
|---|---|
| 사이트 방문 | 설정한 샌드비 비회원 상담 연결. Strict Mode/중복 CTA는 같은 연결 사용 |
| 신청 성공 | 기존 접수 안내/폼 초기화/이동 유지, 고객 입력 정보와 신청 요약을 상담 초안으로 준비 |
| 이미 작성 중인 문장 | 원래 문장을 유지하고 신청 내용으로 교체/유지 선택. 자동 전송 없음 |
| 고객이 보내기 클릭 | 준비된 회사·연락처·희망 업무·요청사항을 같은 상담으로 전송 |
| 접수 후 상담 연결 실패 | 접수 성공을 유지하고 재신청 없이 상담만 재연결 |
| 신청 저장 실패 | 폼을 지우지 않고 실패 안내. 상담 정보/초안 전달을 시작하지 않음 |
| 같은 비회원 정보 수정 | 해당 상담의 이름/선택 이메일만 변경하고 감사 기록. 기존 메시지 이력/작성자 이름은 보존 |
| 상담원 응대/새로고침 | 같은 비회원 대화에 공개 답변 수신, 같은 브라우저의 전송한 이력 복원 |

입력 이메일로 기존 CRM 회원 이력을 조회/합치지 않는다. 수신함은 ‘이메일 · 고객 입력’으로 표시하며 확인 후 같은 사업의 CRM 레코드를 연결하는 기존 절차를 유지한다. 비회원 프로필 갱신은 회원 JWT나 회원에게 연결된 옛 익명 증명으로 수행할 수 없다. 회사/전화 등 전체 신청 요약은 고객이 내용을 확인하고 전송한 메시지에 남는다. 이 연결이 기존 레코드를 새 고객 플랫폼에 자동 이전한다는 뜻은 아니다.

## 설치 계약

`NEXT_PUBLIC_SUPPORT_PROVIDER=sendb`, `NEXT_PUBLIC_SENDB_SUPPORT_API_BASE`(HTTPS origin), `NEXT_PUBLIC_SENDB_SUPPORT_CHANNEL_KEY`(백오랩 공개 채널 키)를 검토 후 설정한다. 값은 이번 작업에서 만들거나 변경하지 않았다. 미설정은 기존 채널톡이며 sendb 설정/로드 오류를 다른 공급자로 자동 전환하지 않는다. 기존 서버 전용 문의 저장/SMS 설정과 새 상담 공개 설정을 구분한다. 브라우저에 서비스 토큰을 넣지 않는다.

SDK1.3 `updateVisitorProfile`은 첫 메시지 전에는 iframe 입력만 채워 빈 상담을 만들지 않는다. 기존 비회원 증명이 있으면 해당 상담의 이름/이메일·버전·감사/outbox를 변경한다. 이름은100자, 선택 이메일254자이며 추가 ID 필드를 거절한다. 생략 이메일은 보존하고 빈 문자열은 지운다. 같은 입력 재시도는 감사 중복을 만들지 않는다. `setDraft`는5,000자 이내 제안이며 이미 쓰던 문장은 사람의 선택 없이 덮지 않는다. 상세 계약은 [API.md](API.md)를 따른다.

## 실제 소스 검수 범위

백오랩 신규 컨트롤러/설정/신청 초안9·앱/테스트 TypeScript·기능 lint를 통과했다. 가상 공개 설정/서버 키·loopback 저장 URL·외부 fetch 차단 상태에서 전체 Next 빌드/10개 정적 페이지와 API 출력을 확인했다. 실제 환경/credential 파일을 사용하지 않았다.

Chrome 포트3125의 별도 앱에서 실제 `ConsultingForm`, `useConsultSubmit`, `useChannelTalk`, 새 상담 어댑터와 `/api/consult`의 입력 검증·Notion/Sendb 저장·SMS 함수를 실행했다. 원본 전체 페이지의 운영 tracker/GA는 로드하지 않았고 저장/SMS는 모두 포트3126의 가상 수신기로 대체했다. 상담 API/SQL은 샌드비의 격리 PGlite에서 실행했다.

초안 유지/교체 선택·고객 직접 전송, 같은 비회원의 정보 변경과 두 문의/감사, 접수 후 상담 정보 전달503→재연결에서 저장/SMS 요청 각2 유지, 신청 저장 실패의 입력 보존, 수신함 답변→사이트·새로고침 이력 복원을 확인했다. 연결 대기 정보와 미전송 초안은 탭 메모리이며 새로고침 이전 상태를 영구 저장하는 기능은 아니다.

샌드비 SDK 실제 JS VM7·비회원 입력 정보 SQL/API8(기존 플랫폼API11 포함)·회원 연결12·상담22 회귀, 루트 타입/lint를 통과했다. `evidence-manifest.json`의 `backofficeFrontendQa`에 소스·로그·로컬 화면 해시를 기록한다. 과거 증거 필드의 ‘프런트 미구현’은 당시 시점의 기록이고 최신 상태는 이 필드를 따른다.

```sh
node scripts/check-chat-sdk.cjs
node --import tsx scripts/check-visitor-profile.cjs
node --import tsx scripts/check-inbox-identity.cjs
node --import tsx scripts/check-inbox.cjs
```

SQL 검사는 기존 `.testenv/test-runtime`의 PGlite를 사용한다. 실제 DB URL이나 사이트 환경 파일을 연결하지 않는다.

실제 도메인/배포 커밋·전체 사업 페이지/팀 업무·부하·설정/설치·지원 자료 이전·전체 대체 전환은 후속이다. 실제 고객 전송·운영 DB 접근·실제 Notion/SMS·서버 반영은 수행하지 않았다. 전체 목표는 [REPLACEMENT.md](REPLACEMENT.md), 사이트별 상태는 [SITE-INTEGRATION.md](SITE-INTEGRATION.md)를 따른다.
