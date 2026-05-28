# Design: external-alimtalk-api (외부 프로젝트용 알림톡 발송 API)

## 1. 개요

샌드비 외부의 프로젝트(예: 디자이너하이어어드민)가 자기 org의 알림톡을 발송할 수 있는 공개 API 2개를 추가한다.
인증은 기존 `apiTokens` 테이블 + `resolveApiToken()`을 재사용하고, NHN 호출은 기존 `getAlimtalkClient(orgId)` + `NhnAlimtalkClient`를 재사용한다.

## 2. 디렉토리 구조

```
src/app/api/v1/alimtalk/
├── templates/
│   └── route.ts          # GET 핸들러 (템플릿 목록)
└── send/
    └── route.ts          # POST 핸들러 (발송)

src/lib/alimtalk/
├── send-service.ts       # (신규) 발송 공통 로직
└── external-auth.ts      # (선택) 외부 API 인증 헬퍼
```

> `src/lib/alimtalk/send-service.ts`는 내부(`/api/alimtalk/send`)와 외부(`/api/v1/alimtalk/send`)가 공유하는 발송 함수.
> 단, 내부는 `templateLinkId` + `recordIds` 기반이고 외부는 `templateCode` + 직접 `recipients` 입력이라 입력 모양은 다름.
> 공통화는 **NHN 호출 + 로그 저장 부분만** 함수로 추출. 입력 정규화는 각 라우트가 책임.

## 3. 인증 (공통)

### 헬퍼: `authenticateExternalAlimtalk(req)`

```ts
// src/lib/alimtalk/external-auth.ts
import type { NextRequest } from "next/server";
import { getApiTokenFromNextRequest, resolveApiToken } from "@/lib/auth";
import type { ApiTokenInfo } from "@/lib/auth";

export async function authenticateExternalAlimtalk(req: NextRequest): Promise<ApiTokenInfo | null> {
    const tokenStr = getApiTokenFromNextRequest(req);
    if (!tokenStr) return null;
    return resolveApiToken(tokenStr);
}
```

- `Authorization: Bearer {token}` 또는 `x-api-key: {token}` 헤더 둘 다 허용 (기존 `getApiTokenFromNextRequest` 동작)
- 토큰의 `scopes`는 partition/folder/workspace 단위라 알림톡 org-level 권한 체크에는 사용하지 않음
- 토큰의 `orgId`만 추출해서 사용

## 4. 엔드포인트 스펙

### 4.1 GET `/api/v1/alimtalk/templates`

**Query Parameters**

| 이름 | 타입 | 필수 | 기본 | 설명 |
|------|------|------|------|------|
| `senderKey` | string | X | `alimtalkConfigs.defaultSenderKey` | NHN 발신프로필 키 |

**처리 흐름**
1. `authenticateExternalAlimtalk(req)` → `tokenInfo` 또는 401
2. `getAlimtalkClient(tokenInfo.orgId)` → 없으면 404 ("알림톡 설정이 없습니다.")
3. `senderKey` 확정 — 쿼리 없으면 `alimtalkConfigs.defaultSenderKey` 조회
   - 둘 다 없으면 400 ("senderKey가 필요합니다.")
4. `client.listTemplates(senderKey)` 호출
5. `header.isSuccessful === false`면 502 + NHN 메시지 전달
6. 응답 정형화 후 반환

**응답 (성공)**
```json
{
  "success": true,
  "data": {
    "senderKey": "abc...",
    "totalCount": 12,
    "templates": [
      {
        "templateCode": "WELCOME_001",
        "templateName": "회원가입 환영",
        "templateContent": "#{고객명}님 가입을 환영합니다.",
        "templateMessageType": "BA",
        "templateEmphasizeType": "TEXT",
        "templateTitle": "환영합니다",
        "templateSubtitle": null,
        "templateHeader": null,
        "templateImageUrl": null,
        "templateExtra": null,
        "templateItem": null,
        "templateItemHighlight": null,
        "templateRepresentLink": null,
        "buttons": [
          { "ordering": 1, "type": "WL", "name": "홈으로", "linkMo": "https://..." }
        ],
        "quickReplies": [],
        "status": "APR",
        "statusName": "승인",
        "categoryCode": "..."
      }
    ]
  }
}
```

> **NHN 원본 필드를 그대로 노출.** 디하에서 본문/버튼/이미지 미리보기 UI를 자유롭게 그릴 수 있음.
> 변수 치환(`#{변수}` → 실제값)은 디하 클라이언트 측에서 처리.

**에러 응답**

| 상태 | 사유 | error |
|------|------|-------|
| 401 | 토큰 없음/유효하지 않음 | "유효하지 않은 API 토큰입니다." |
| 400 | senderKey 없음 (기본값도 없음) | "senderKey가 필요합니다." |
| 404 | org에 alimtalk_configs 없음/비활성 | "알림톡 설정이 없습니다." |
| 502 | NHN API 호출 실패 | `발송 실패: ${nhn.header.resultMessage}` |
| 500 | 그 외 | "템플릿 조회에 실패했습니다." |

### 4.2 POST `/api/v1/alimtalk/send`

**Request Body**
```ts
{
  templateCode: string;        // 필수
  senderKey?: string;          // 미지정 시 defaultSenderKey 사용
  recipients: Array<{
    phoneNumber: string;       // 필수, 하이픈 허용 (서버에서 정규화)
    templateParameter?: Record<string, string>;  // 예: { "고객명": "홍길동" }
  }>;
  requestDate?: string;        // NHN 형식: "yyyy-MM-dd HH:mm" (예약 발송용, 선택)
  triggerType?: string;        // 발송 출처 라벨 (예: "designer-hire-admin"), 로그용
}
```

**제약**
- `recipients.length`: 1 ~ 1000 (기존 내부 라우트와 동일)
- 전화번호는 `normalizePhoneNumber()`로 숫자만 추출 후 10자 미만이면 해당 수신자 skip + errors에 기록

**처리 흐름**
1. `authenticateExternalAlimtalk(req)` → `tokenInfo` 또는 401
2. body 검증 — `templateCode`, `recipients` 필수
3. `getAlimtalkClient(orgId)` → 없으면 404
4. `senderKey` 확정 (body > defaultSenderKey)
5. 수신자 정규화 — `normalizePhoneNumber`, 잘못된 번호는 `errors[]`로 분리
6. `client.getTemplate(senderKey, templateCode)` 호출 — 본문 가져오기 (로그용)
   - 없으면 404 ("템플릿을 찾을 수 없습니다.")
7. `client.sendMessages({ senderKey, templateCode, recipientList, requestDate })`
8. `header.isSuccessful === false`면 502 + 메시지
9. `alimtalk_send_logs`에 결과 저장 (per-recipient)
   - 내부 라우트와 달리 `templateLinkId`, `partitionId`, `recordId`는 null
   - `sentBy`도 null (외부 토큰이므로 user 정보 없음)
   - `triggerType`: body의 `triggerType` 또는 기본값 `"external_api"`
   - `content`: 본문에 `templateParameter` 치환한 값
10. 응답 반환

**응답 (성공)**
```json
{
  "success": true,
  "data": {
    "requestId": "abc-123",
    "totalCount": 5,
    "successCount": 4,
    "failCount": 1,
    "results": [
      { "phoneNumber": "01012345678", "recipientSeq": 1, "status": "sent", "resultCode": "0", "resultMessage": "success" },
      { "phoneNumber": "01098765432", "recipientSeq": 2, "status": "failed", "resultCode": "...", "resultMessage": "..." }
    ],
    "errors": [
      { "phoneNumber": "010", "error": "수신번호 형식 오류" }
    ]
  }
}
```

**에러 응답**

| 상태 | 사유 | error |
|------|------|-------|
| 401 | 토큰 없음/유효하지 않음 | "유효하지 않은 API 토큰입니다." |
| 400 | body 누락/형식 오류 | 구체적 메시지 (예: "templateCode는 필수입니다.") |
| 400 | recipients 0건 또는 1000건 초과 | "수신자는 1~1000건이어야 합니다." |
| 400 | 유효한 수신자 0건 | "유효한 수신자가 없습니다." (errors 포함) |
| 404 | NHN 설정 없음 | "알림톡 설정이 없습니다." |
| 404 | 템플릿 없음 | "템플릿을 찾을 수 없습니다." |
| 502 | NHN 발송 실패 | `발송 실패: ${message}` |
| 500 | 그 외 | "발송에 실패했습니다." |

## 5. 발송 로그 스키마 매핑

`alimtalk_send_logs` 테이블에 저장하는 필드 (외부 API 케이스):

| 필드 | 값 |
|------|-----|
| `orgId` | tokenInfo.orgId |
| `templateLinkId` | null |
| `partitionId` | null |
| `recordId` | null |
| `senderKey` | 요청 senderKey |
| `templateCode` | 요청 templateCode |
| `templateName` | NHN 템플릿 상세에서 가져온 값 (없으면 빈 문자열) |
| `recipientNo` | NHN 응답 recipientNo |
| `requestId` | NHN 응답 requestId |
| `recipientSeq` | NHN 응답 recipientSeq |
| `status` | "sent" \| "failed" |
| `resultCode` | NHN resultCode |
| `resultMessage` | NHN resultMessage |
| `content` | 본문에 templateParameter 치환된 결과 |
| `triggerType` | body의 triggerType 또는 "external_api" |
| `sentBy` | null |

> `templateLinkId/partitionId/recordId`가 nullable인지 스키마 확인 필요. nullable이 아니면 마이그레이션으로 nullable 변경.

## 6. 공통 발송 함수 (선택적 리팩터)

```ts
// src/lib/alimtalk/send-service.ts
export interface SendAlimtalkInput {
    orgId: string;
    senderKey: string;
    templateCode: string;
    recipients: Array<{
        phoneNumber: string;
        templateParameter?: Record<string, string>;
        // 내부용 메타 (외부에서는 모두 undefined)
        recordId?: number;
        templateLinkId?: number;
        partitionId?: number;
    }>;
    triggerType: string;
    sentBy?: string | null;
    requestDate?: string;
}

export interface SendAlimtalkResult {
    requestId: string;
    successCount: number;
    failCount: number;
    results: Array<{
        phoneNumber: string;
        recipientSeq: number;
        status: "sent" | "failed";
        resultCode: string;
        resultMessage: string;
    }>;
}

export async function sendAlimtalkForOrg(input: SendAlimtalkInput): Promise<
    | { ok: true; data: SendAlimtalkResult }
    | { ok: false; status: number; error: string }
>;
```

내부 라우트(`/api/alimtalk/send`)는 기존 입력 정규화를 마친 뒤 이 함수를 호출하도록 점진적으로 리팩터.
**이번 작업에서는 내부 라우트 리팩터는 하지 않고**, 외부 라우트만 새 함수 사용. 내부 라우트는 그대로 둠 (YAGNI + 리스크 최소화).

## 7. 변경 파일 목록

| 파일 | 변경 |
|------|------|
| `src/lib/alimtalk/external-auth.ts` | 신규 — `authenticateExternalAlimtalk()` |
| `src/lib/alimtalk/send-service.ts` | 신규 — `sendAlimtalkForOrg()` |
| `src/app/api/v1/alimtalk/templates/route.ts` | 신규 — GET 핸들러 |
| `src/app/api/v1/alimtalk/send/route.ts` | 신규 — POST 핸들러 |
| `drizzle/{next}_external_alimtalk_log_nullable.sql` | (조건부) `alimtalk_send_logs`의 templateLinkId/partitionId/recordId nullable 처리 |
| `drizzle/schema.ts` | (조건부) 위 컬럼 타입 갱신 |

> 스키마 확인 후 이미 nullable이면 마이그레이션 파일 불필요.

## 8. 검증 체크리스트

- [ ] `npx next build` 성공, TypeScript 에러 0
- [ ] 정상 토큰 + senderKey 미지정 → `defaultSenderKey`로 템플릿 목록 반환
- [ ] 정상 토큰 + 명시 senderKey → 해당 senderKey 템플릿 반환
- [ ] 잘못된 토큰 → 401
- [ ] alimtalk_configs 없는 org 토큰 → 404
- [ ] 다른 org 토큰으로 호출해도 그 org 데이터만 반환 (cross-tenant 격리)
- [ ] POST 발송 정상 케이스 → `alimtalk_send_logs`에 per-recipient 로그 저장됨
- [ ] 잘못된 전화번호 섞여 있어도 정상 번호는 발송되고 errors[]에 따로 반환
- [ ] templateParameter 치환된 본문이 로그에 저장됨
- [ ] templateCode 없는 케이스 → 404
- [ ] NHN 호출 실패 → 502 + 메시지

## 9. 보안/운영 고려

- API Token은 평문 비교 (기존 방식 그대로). 토큰 발급 시 충분히 긴 랜덤 문자열을 사용.
- 향후 rate limiting이 필요하다면 미들웨어 레벨에서 추가. **이번 작업 범위 아님.**
- `console.error` 로그에 토큰 값 절대 노출 금지. orgId/requestId만 기록.
- 발송 실패도 `alimtalk_send_logs`에 기록되므로 운영에서 사후 추적 가능.
