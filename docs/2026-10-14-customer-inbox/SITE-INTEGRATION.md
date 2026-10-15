# 실제 서비스 저장소의 상담 연결

2026-10-15 · 사용자가 실제 운영/서버 반영 없이 별도 브랜치에서 작업 중인지 확인했고 그 범위를 유지한다. 샌드비는 `dev`, 실제 세 서비스 저장소는 각각 `codex/sendb-support-integration`이다. 실제 서버 설정/배포·운영 기본 브랜치 병합·운영 DB 접근은 수행하지 않는다.

| 저장소 | 현재 구현/검증 | 상태 |
|---|---|---|
| `pjk0007/salesflow` | 고객/회원/위젯·상담·CRM·권한 API 계약, 가상 사이트 예제 | dev, 초안 PR14 |
| `matches-plan/designer-hire-server` | Firebase 로그인/서버 고객 문서→사업 고객 upsert→짧은 상담 인증 교환 | `a546d56c251f5f2b7b9beb8d087c0df8d5b9b4e3`, [초안 PR1](https://github.com/matches-plan/designer-hire-server/pull/1), master 미병합 |
| `matches-plan/new-designer-hire` | 기존 문의 CTA·SDK 공급자 선택·Firebase uid 인증 교환·회원 전환/실패 UI·중첩 숨김 | `03e864e12939b8248692e15233e043df0f7430f8`, [초안 PR25](https://github.com/matches-plan/new-designer-hire/pull/25), main 미병합 |
| `matches-plan/back-office-lab` | 비회원 상담·신청 후 입력 정보/초안·기존 문장 보존·재신청 없는 재연결 | `ad32e4555725272fe2851430a3b5cbeea272bac2`, [초안 PR2](https://github.com/matches-plan/back-office-lab/pull/2), main 미병합 |

## 디하 서버 경로

기존 Firebase HTTPS 함수의 Express 앱에 `POST /support/identity`를 추가했다. 프런트는 Firebase 클라이언트 ID 토큰을 `Authorization: Bearer …`로 전달한다. 서버는 `verifyIdToken(token,true)`와 `users/{검증 uid}`의 `userType=client`를 확인한다. 요청 본문의 uid/이메일/사업 번호를 사용하지 않는다. 파트너·관리자·회수/비활성 로그인·미등록 사이트는 거절한다.

이름·이메일·전화·회사명은 확인한 회원 문서에서 읽어 서버에 고정한 사업으로 동기화한다. 회사명만으로 회사 ID의 동일성을 추정하지 않는다. 서버 서비스 토큰으로 샌드비 고객 API와 `/api/v1/inbox/sessions`를 호출하며 응답은 짧은 인증·만료·공개 채널 키다. no-store, 제한 시간, 리다이렉트 거절과 응답 검증을 적용한다. 모든 설정은 `SENDB_SUPPORT_*`에 명시하며 운영 주소 기본값은 없다.

두 HTTP 호출은 하나의 트랜잭션이 아니므로 동기화 후 인증 발급만 실패할 수 있다. 같은 uid의 재시도는 같은 고객을 재사용한다. CRM 보관은 계정 정지가 아니라는 기존 정책에 따라 보관 고객도 같은 상담을 이어갈 수 있고 CRM 보관은 해제하지 않는다. 내부 표시를 false로 임의 덮어쓰지 않는다.

## 확인한 증거

- 서버 신규 검사15: 설정/출처·헤더·회수 오류·회원 역할·서버 문서/uid·위조 본문 무시·no-store·공급자 오류/응답·HTTP·실제 라우터의 Firebase 회수 확인 조립.
- 기존 포함 서버 단위95, 전체 TypeScript 컴파일, 신규 기능 ESLint 통과.
- 샌드비 교차 SQL/API8: 실제 고객 upsert/JWT/프로필·빈 상담 없음, 갱신 멱등, 같은 Firebase uid의 두 사업 격리, 읽기 키·타 사업 채널 차단, 실제 회원 문의의 동일 고객 저장, CRM 보관/상담 이력 보존, 꺼진 채널 차단. 기존 플랫폼 API11도 함께 통과했다.
- Firebase/Firestore 로그인 문서와 공급자는 가상 대체했다. 샌드비 저장 로직은 실제 API/SQL을 PGlite에서 실행했다. 실제 Firebase/운영 DB·실제 고객/메일/SMS·실제 서버는 호출하지 않았다. `evidence-manifest.json`의 `siteIdentityQa`에 파일/로그 해시를 기록한다.

교차 검사는 디하 서버에서 `pnpm exec tsc --outDir lib-test --module commonjs --skipLibCheck`로 컴파일한 뒤 샌드비 저장소에서 실행한다. 인자는 컴파일한 서버 저장소의 절대 경로다. 원본 Firebase entrypoint나 환경/credential 파일을 실행하지 않고 순수 어댑터에 가상 API transport를 주입한다.

```sh
node --import tsx scripts/check-designer-hire-identity.cjs F:/Dev/sendb-sites/designer-hire-server
```

## 프런트 연결과 남은 설치 검수

디하 정적 웹의 서버 교환·SDK 설정·로그인 대기·익명→회원·계정 전환·로그아웃·인증 갱신/실패·기존 CTA·채팅/가이드 중첩 숨김을 구현했다. 신규17/전체67·타입·기능 lint·격리 전체 정적 빌드/30페이지 export와 실제 어댑터를 실행한 Chrome 송수신 QA를 확인했다. Firebase는 가상이며 전체 사업 페이지/운영 검수는 아니다. [디하 연결 UX·설정·검증](DESIGNER-SITE.md)과 `designerFrontendQa` 증거를 따른다.

백오랩은 기존 신청 저장 성공→비회원 정보 갱신→신청 초안→고객 직접 전송을 연결했다. 기존 문장을 보존하고 사람의 교체 선택을 제공하며 접수 후 연결 실패는 재신청 없이 복구한다. 신규9·앱/테스트 타입·기능 lint·가상 환경 전체 빌드/10정적 페이지, 실제 폼/hook/문의 API와 가상 저장/SMS를 연결한 Chrome QA를 확인했다. SDK1.3 VM7·비회원 SQL/API8(플랫폼11 포함)·회원 연결12·상담22 회귀도 통과했다. [백오랩 UX·설정·검증](BACKOFFICE-SITE.md)과 최신 `backofficeFrontendQa` 증거를 따른다. 실제 도메인/배포 커밋 매핑·키/출처 설정·전체 업무/팀 검수와 자료 이전/전환은 남아 있다.

이 문서는 서버 교환과 두 웹 프런트 구현의 진척이며 실제 사이트 설치·전체 서비스 대체 완료를 뜻하지 않는다. 현재 서버·두 웹·샌드비 PR은 모두 초안이다. 실제 운영 반영 요청으로 해석하지 않는다.
