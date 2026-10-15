# 문의 목록·새 문의 병렬 작업

2026-10-15. 사용자가 ‘병렬 작업으로 속도 높이기’ 채팅에서 서브에이전트 3개를 요청한 원문을 확인하고 담당을 분리했다. 전체 대체 목표는 [REPLACEMENT.md](REPLACEMENT.md)의 R01~R16을 유지한다. 이번 작업은 고객 웹 문의 이력/새 문의의 API·SDK·위젯 연결이며 전체 전환 완료 선언이 아니다.

| 담당 | 수정 소유권 | 검증/통합 범위 |
|---|---|---|
| 총괄(root) | `ChatWidget.tsx`, 공통 route/fixture 조립, 이 문서·전체 기능 가이드 | 통합 브라우저 QA, 전체 회귀/타입/빌드, 검토 문서·dev 커밋/푸시·초안 PR |
| customer_history_api | `inbox-customer-history` 서버 모듈, 고객용 `sdk/messenger.ts`, 0112 DB 필드/인덱스/읽음, visitor 선택·회원 병합, `check-customer-history.cjs` | 원자성/멱등·동시성·사업/회원/파일 격리·읽음/병합·마이그레이션, 소유한 loopback PostgreSQL55439 |
| designer_history_sdk | `public/sendb-sdk.js`, 브라우저 SDK VM 검사, `CUSTOMER-HISTORY-SDK.md` | 문의 목록/새 문의/특정 문의 탐색과 준비/인증/계정 전환 경계, 기존 디하 웹·서버 연결의 관련 검사 |
| backoffice_history_ui | `components/customer-conversations` UI/API/hooks/types/utils, `useAttachmentDrafts.ts`의 그룹 이동 | 문의 목록/페이지/읽음과 문장·파일 보존에 필요한 공통 UI, 기존 백오랩 비회원 폼·SDK 호환 검사 |

사이트별 기능 브랜치는 그대로 유지한다. 별도 마스터 채팅은 디하 controller/types/loader와 관련 검사·문서/Windows 테스트 명령, AI 이관 `queue.ts`와 전용 회귀, 기존 데이터 업그레이드 검사·합성 데이터 성능 검사·채널톡 재이전의 원본 보존 수정을 맡았다. 디하 커밋 `23f27cc3`는 기존 기능 브랜치/초안 PR25에 반영했다. 마스터 측 소스 수정/검수가 끝나 공통 앱·검사 파일을 총괄에게 통합 인계했다.

## 고정한 공통 계약

- `GET /api/messenger/:key/conversations`: 서버가 확인한 회원의 웹 문의 50개와 커서·전체 미확인 답변 수. 직원 메모·가져온 과거 기록·이메일 상담은 제외한다.
- `POST /api/messenger/:key/conversations`: `{clientId,body,attachmentIds?}` 첫 메시지와 새 문의를 함께 저장한다. 같은 요청은 재사용하며 이전 문의의 상태/담당은 보존한다.
- 기존 messenger 조회/전송의 `?conversationId=...`: 소유한 문의를 선택한다. 선택하지 않은 기존 호출은 기본 문의로 계속 동작한다.
- `POST /api/messenger/:key/conversations/:id/read`: `{lastMessageId,readRevision?}`를 받고 원자적 `{lastMessageId,readRevision,unread}`를 반환한다. 목록의 `nextBefore`는 고정 시각+UUID의 불투명 문자열이다.
- 첨부의 `?conversationId=...` 또는 회원의 `?newConversation=1`: 선택 문의 또는 아직 생성하지 않은 새 문의에 연결한다. 소유권·기존 파일 제한을 유지한다.
- 임베디드 SDK `sendb:navigate`는 `view:list|new|thread`와 선택 UUID를 전달한다. 준비 전/인증 전환 중/비회원 호출은 거절하고 오래된 탐색을 계정 변경 후 재생하지 않는다.

## 작업·검증 원칙

최종 API PGlite26/독립 PostgreSQL26(각 기본 플랫폼11)·회원 연결12·기존 0111→0112 업그레이드12를 확인했다. UI/API/첨부 그룹14·SDK VM23·실제 디하 SDK 교차6·통합 단위1,119·타입/lint/격리 빌드와 파일/기존 이전/첨부 이전 회귀를 검수했다. Chrome 두 사업 문의/초안/읽음·회원 분리·비회원/회원 연결/재연결은 총괄이 확인했다. 세부 근거와 한계는 [CUSTOMER-HISTORY.md](CUSTOMER-HISTORY.md) 및 증거 manifest를 따른다. 전체 제품 전환 완료를 뜻하지 않는다.

SDK1.4는 configure마다 `configurationId`를 새로 보내고 위젯은 해당 설정의 새 조회 성공 후 같은 ID로 ACK한다. 현재 iframe을 보존하는 `reconnect()`로 첫 준비/identify 타임아웃 뒤 복구하며 계정 변경 뒤의 옛 응답은 수락하지 않는다. 디하 loader도 최소1.4.0과 reconnect를 확인한다.

추가 독립 검수: 합성1만 문의/100,170메시지의 PGlite/PG 전체 목록·커서·읽음·상세·검색/격리5군과7측정, 채널톡 재이전7개를 통과했다. 총괄 Chrome15개 흐름에는 실제 API503→준비 타임아웃→재연결 및 첫 상세10초 지연/문의 없는 회원의 초안 보존이 포함된다. PG 고유 시험 DB와 정확한 시험 서버의 정리도 확인했다. 운영 부하/실제 계정 전환 완료 선언은 하지 않는다.

각 담당은 자기 파일과 관련 검사만 수행한다. 전체 회귀·Next 빌드/타입은 조립이 끝난 뒤 총괄이 수행하며 실패/추가 변경이 있을 때 재검수한다. API/UI 포트3120/3121·Chrome·전체 빌드 출력은 총괄 소유이며 PostgreSQL55439는 API 담당과 총괄이 사용 시점을 조율한다. 커밋·푸시·PR 변경은 총괄만 한다.

운영 기본 브랜치 병합·배포, 실제 서버 설정·운영/개발 고객 DB·실제 고객 메시지/알림·R2 삭제는 수행하지 않는다. 가상 데이터와 격리 환경으로 검증하고 초안 PR을 유지한다.
