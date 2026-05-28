# Plan: external-alimtalk-api (외부 프로젝트용 알림톡 발송 API)

## 1. 개요

### 배경
샌드비는 멀티테넌트 SaaS로, 각 org가 자기네 NHN 알림톡 계정(appKey/secretKey/senderKey)을 등록해 사용 중.
외부 프로젝트(예: 디자이너하이어어드민)에서 자기 org 명의로 알림톡을 발송할 수 있도록 공개 API가 필요함.

기존 `/api/alimtalk/send`는 내부 세션 인증(getUserFromNextRequest)을 사용하므로 외부에서 호출 불가.
별도의 API Token 인증 기반 외부 엔드포인트를 추가한다.

### 목표
1. 외부 프로젝트가 API Token으로 자기 org의 **알림톡 템플릿 목록**을 조회
2. 외부 프로젝트가 API Token으로 자기 org의 senderKey로 **알림톡을 발송**
3. 다른 org의 템플릿/발신프로필은 절대 노출되지 않아야 함 (멀티테넌트 격리)

### 사용 시나리오 (디자이너하이어어드민 예시)
1. 어드민 사용자가 발송 버튼 클릭
2. 다이얼로그 오픈 → 샌드비에 `GET /api/v1/alimtalk/templates` 호출
3. 디하 org에 매핑된 API Token이므로 디하 템플릿만 반환됨 (본문/버튼/이미지까지 함께)
4. 사용자가 템플릿 선택 → 디하 화면에서 **본문/버튼 미리보기 카드** 표시
5. 사용자가 수신자 정보(+ 변수값) 입력 → 디하가 `#{변수}` 치환해서 발송 예시 표시
6. 발송 버튼 클릭 → 샌드비에 `POST /api/v1/alimtalk/send` 호출
7. 샌드비가 디하의 senderKey로 NHN에 발송 요청 → 발송로그 저장

## 2. 현재 상태 분석

### 재사용 가능한 자산 (이미 구현됨)
| 자산 | 위치 | 비고 |
|------|------|------|
| API Token 인증 | `src/lib/auth.ts:163-193` `resolveApiToken()` | `apiTokens` 테이블 (org 매핑됨) |
| NHN 클라이언트 | `src/lib/nhn-alimtalk.ts` `NhnAlimtalkClient` | listTemplates, sendMessages |
| Org별 NHN 설정 | `alimtalk_configs` 테이블 | appKey/secretKey/defaultSenderKey |
| 클라이언트 헬퍼 | `src/lib/nhn-alimtalk.ts:484-493` `getAlimtalkClient(orgId)` | org → client 변환 |
| 내부 발송 로직 | `src/app/api/alimtalk/send/route.ts` | 변수 치환 + 발송로그 저장 |

### 새로 만들어야 할 것
- `GET /api/v1/alimtalk/templates` — 외부용 템플릿 목록 조회
- `POST /api/v1/alimtalk/send` — 외부용 발송

## 3. 구현 범위

### 우선순위 HIGH
1. **`GET /api/v1/alimtalk/templates`**
   - 인증: `Authorization: Bearer {token}` → `resolveApiToken()` → orgId
   - 처리: `getAlimtalkClient(orgId)` → `client.listTemplates(senderKey)`
   - senderKey: 쿼리 파라미터 미지정 시 org의 `defaultSenderKey` 사용
   - **응답에 NHN 원본 필드 전부 포함** (디하에서 미리보기 UI 그릴 수 있도록):
     - `templateCode`, `templateName`, `templateContent` (본문, `#{변수}` 포함)
     - `templateMessageType`, `templateEmphasizeType`, `templateTitle`, `templateSubtitle`
     - `templateHeader`, `templateImageUrl`, `templateExtra`
     - `buttons[]`, `quickReplies[]`, `templateItem`, `templateItemHighlight`, `templateRepresentLink`
     - `status`, `inspectionStatus`, `categoryCode` 등 상태 필드
   - 변수 치환된 미리보기는 클라이언트(디하) 측 책임 — 별도 preview API 만들지 않음
   - 응답: `{ success: true, data: { templates: [...] } }`
   - 에러: 401(토큰 없음/유효하지 않음), 404(NHN 설정 없음), 500(NHN 호출 실패)

2. **`POST /api/v1/alimtalk/send`**
   - 인증: 위와 동일
   - body: `{ templateCode, senderKey?, recipients: [{ phoneNumber, templateParameter, resendSettings? }] }`
   - 처리: 변수 치환 → NHN `sendMessages` 호출 → `alimtalk_logs` 저장
   - 응답: `{ success: true, data: { messageIds: [...], requestId } }`

### 우선순위 LOW (선택 사항)
3. 발송 결과 조회 `GET /api/v1/alimtalk/results/:requestId`
4. 사용량/한도 조회

## 4. 변경 파일

| 파일 | 변경 |
|------|------|
| `src/app/api/v1/alimtalk/templates/route.ts` | 신규 — GET 핸들러 |
| `src/app/api/v1/alimtalk/send/route.ts` | 신규 — POST 핸들러 |
| `src/lib/alimtalk/send-service.ts` (선택) | 신규 — 내부/외부 발송 공통 로직 추출 |
| `src/lib/auth.ts` | 변경 없음 (resolveApiToken 재사용) |
| `src/lib/nhn-alimtalk.ts` | 변경 없음 (기존 함수 재사용) |

> 기존 `/api/alimtalk/send`의 발송 로직을 그대로 복사하지 않고,
> 공통 함수(`sendAlimtalkForOrg(orgId, params)`)로 추출해서 내부/외부가 모두 사용하도록 한다.

## 5. 인증/보안 요구사항

- API Token은 기존 `apiTokens` 테이블 사용 (별도 신규 테이블 X)
- 모든 응답은 토큰의 orgId에 해당하는 데이터만 반환 (cross-org 누수 차단)
- 토큰 만료/비활성 시 401
- org에 `alimtalk_configs`가 없거나 비활성이면 404 + "알림톡 설정이 없습니다"
- 발송 실패도 발송로그에 기록 (상태=FAIL)
- 외부 API는 한국어 에러 메시지 그대로 사용 (기존 컨벤션)

## 6. 검증

- [ ] `npx next build` 성공 + TypeScript 에러 0
- [ ] 유효한 API Token으로 `GET /api/v1/alimtalk/templates` → 해당 org의 템플릿만 반환됨
- [ ] 잘못된 토큰으로 호출 → 401
- [ ] 다른 org의 토큰으로 호출 → 다른 org의 템플릿만 반환됨 (격리 확인)
- [ ] `POST /api/v1/alimtalk/send` 정상 발송 + `alimtalk_logs`에 기록됨
- [ ] NHN 설정 없는 org 토큰으로 호출 → 404
- [ ] 발송 실패 케이스(잘못된 templateCode, 잘못된 수신자) → 실패 로그 저장 + 적절한 에러 응답

## 7. 디자이너하이어어드민 측 통합 가이드 (참고용)

```ts
// 템플릿 조회
const res = await fetch("https://sendb.example/api/v1/alimtalk/templates", {
  headers: { Authorization: `Bearer ${SENDB_API_TOKEN}` },
});

// 발송
await fetch("https://sendb.example/api/v1/alimtalk/send", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${SENDB_API_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    templateCode: "WELCOME_001",
    recipients: [
      { phoneNumber: "01012345678", templateParameter: { name: "홍길동" } },
    ],
  }),
});
```
