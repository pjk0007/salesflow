# 실제 서비스 저장소의 상담 연결

2026-10-15 · 사용자가 실제 운영/서버 반영 없이 별도 브랜치에서 작업 중인지 확인했고 그 범위를 유지한다. 샌드비는 `dev`, 실제 세 서비스 저장소는 각각 `codex/sendb-support-integration`이다. 실제 서버 설정/배포·운영 기본 브랜치 병합·운영 DB 접근은 수행하지 않는다.

| 저장소 | 현재 구현/검증 | 상태 |
|---|---|---|
| `pjk0007/salesflow` | 고객/회원/위젯·상담·CRM·권한 API 계약, 가상 사이트 예제 | dev, 초안 PR14 |
| `matches-plan/designer-hire-server` | Firebase 로그인/서버 고객 문서→사업 고객 upsert→짧은 상담 인증 교환 | `a546d56c251f5f2b7b9beb8d087c0df8d5b9b4e3`, [초안 PR1](https://github.com/matches-plan/designer-hire-server/pull/1), master 미병합 |
| `matches-plan/new-designer-hire` | Firebase/기존 채널톡 호출 지점과 여정 트래커 확인 | 분리 브랜치 준비, 프런트 구현 미완료 |
| `matches-plan/back-office-lab` | Next 서버·문의 저장·채널톡/CTA 지점 확인 | 분리 브랜치 준비, 프런트 구현 미완료 |

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

## 남은 설치 흐름

디하 정적 웹은 서버 교환 경로와 공개 SDK 설정을 연결하고, 로그인 대기·익명→회원·계정 전환·로그아웃·인증 갱신/실패를 구현해야 한다. 기존 채팅 페이지의 버튼 숨김과 여러 문의 CTA, 여정 트래커를 보존해야 한다. 백오랩은 익명 상담/문의 후 CTA·프로필 안내를 같은 상담으로 연결해야 한다. 이후 가상 두 사이트 브라우저 QA, 실제 배포 커밋 매핑·키/출처 설정 검토·팀 검수를 진행한다.

이 문서는 서버 교환 구현의 진척이며 두 사이트 설치·전체 서비스 대체 완료를 뜻하지 않는다. 현재 서버 PR과 샌드비 PR은 초안이다. 실제 운영 반영 요청으로 해석하지 않는다.
