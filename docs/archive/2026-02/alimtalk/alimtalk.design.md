# Design: 알림톡 (KakaoTalk 알림톡 via NHN Cloud)

## 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────┐
│                        /alimtalk 페이지                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐│
│  │ 대시보드  │ │발신프로필│ │  템플릿  │ │발송 이력 │ │  설정  ││
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └───┬────┘│
└───────┼────────────┼────────────┼────────────┼────────────┼─────┘
        │            │            │            │            │
   SWR Hooks: useAlimtalkConfig, useAlimtalkSenders,
              useAlimtalkTemplates, useAlimtalkTemplateLinks,
              useAlimtalkLogs, useAlimtalkStats
        │            │            │            │            │
┌───────┴────────────┴────────────┴────────────┴────────────┴─────┐
│                     Next.js API Routes                           │
│  /api/alimtalk/config       설정 CRUD                            │
│  /api/alimtalk/senders      발신프로필 Proxy                      │
│  /api/alimtalk/templates    템플릿 Proxy                          │
│  /api/alimtalk/template-links  로컬 연결 CRUD                    │
│  /api/alimtalk/send         발송                                 │
│  /api/alimtalk/logs         이력 조회                             │
│  /api/alimtalk/stats        통계                                 │
└───────┬────────────┬────────────────────────────┬───────────────┘
        │            │                            │
   ┌────┴────┐  ┌────┴──────────┐           ┌────┴────┐
   │ Drizzle │  │ NHN Cloud API │           │ Drizzle │
   │   ORM   │  │   (외부 API)   │           │   ORM   │
   └────┬────┘  └───────────────┘           └────┬────┘
        │                                        │
   alimtalk_configs                    alimtalk_template_links
                                       alimtalk_send_logs
```

---

## 1. NHN Cloud API 클라이언트 (`src/lib/nhn-alimtalk.ts`)

### 인터페이스 정의

```typescript
// NHN Cloud 공통 응답
interface NhnApiResponse<T = unknown> {
  header: {
    resultCode: number;    // 0: 성공
    resultMessage: string;
    isSuccessful: boolean;
  };
  body?: T;
}

// 발신프로필
interface NhnSenderProfile {
  plusFriendId: string;
  senderKey: string;
  categoryCode: string;
  status: string;           // YSC(정상), YSC(차단) 등
  statusName: string;
  kakaoStatus: string;
  kakaoStatusName: string;
  kakaoProfileStatus: string;
  alimtalk: boolean;
  friendtalk: boolean;
  createDate: string;
}

// 발신프로필 카테고리
interface NhnSenderCategory {
  parentCode: string;
  depth: number;
  code: string;
  name: string;
  subCategories: NhnSenderCategory[];
}

// 템플릿
interface NhnTemplate {
  senderKey: string;
  templateCode: string;
  templateName: string;
  templateMessageType: string;  // BA(기본), EX(부가), AD(광고), MI(복합)
  templateEmphasizeType: string;
  templateContent: string;
  templateUrl: string;
  templateStatus: string;       // APR(승인), REJ(반려), REQ(요청) 등
  templateStatusName: string;
  buttons?: NhnTemplateButton[];
  quickReplies?: NhnTemplateQuickReply[];
  createDate: string;
  updateDate: string;
}

interface NhnTemplateButton {
  ordering: number;
  type: string;     // WL(웹링크), AL(앱링크), BK(봇키워드), MD(배송조회) 등
  name: string;
  linkMo?: string;
  linkPc?: string;
  schemeIos?: string;
  schemeAndroid?: string;
}

interface NhnTemplateQuickReply {
  ordering: number;
  type: string;
  name: string;
  linkMo?: string;
  linkPc?: string;
}

// 발송 요청
interface NhnSendRequest {
  senderKey: string;
  templateCode: string;
  recipientList: Array<{
    recipientNo: string;
    templateParameter?: Record<string, string>;
  }>;
  requestDate?: string;   // 예약 발송 시 (yyyy-MM-dd HH:mm)
}

// 발송 응답
interface NhnSendResponse {
  requestId: string;
  statusCode: string;
  sendResults: Array<{
    recipientNo: string;
    resultCode: number;
    resultMessage: string;
    recipientSeq: number;
  }>;
}

// 메시지 조회 결과
interface NhnMessageResult {
  requestId: string;
  recipientSeq: number;
  plusFriendId: string;
  senderKey: string;
  templateCode: string;
  recipientNo: string;
  content: string;
  requestDate: string;
  receiveDate: string;
  createDate: string;
  resultCode: string;
  resultCodeName: string;
  buttons?: NhnTemplateButton[];
}
```

### 클라이언트 클래스

```typescript
// src/lib/nhn-alimtalk.ts

export class NhnAlimtalkClient {
  private baseUrl = "https://api-alimtalk.cloud.toast.com";
  private appKey: string;
  private secretKey: string;

  constructor(appKey: string, secretKey: string) {
    this.appKey = appKey;
    this.secretKey = secretKey;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<NhnApiResponse<T>> {
    const url = `${this.baseUrl}${path.replace("{appkey}", this.appKey)}`;
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Secret-Key": this.secretKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  }

  // --- 발신프로필 ---
  getSenderCategories(): Promise<NhnApiResponse<{ categories: NhnSenderCategory[] }>>
  listSenders(params?: { pageNum?: number; pageSize?: number }): Promise<NhnApiResponse<{ senders: NhnSenderProfile[]; totalCount: number }>>
  getSender(senderKey: string): Promise<NhnApiResponse<NhnSenderProfile>>
  registerSender(data: { plusFriendId: string; phoneNo: string; categoryCode: string }): Promise<NhnApiResponse>
  authenticateSenderToken(data: { plusFriendId: string; token: string }): Promise<NhnApiResponse>
  deleteSender(senderKey: string): Promise<NhnApiResponse>

  // --- 템플릿 ---
  listTemplates(senderKey: string): Promise<NhnApiResponse<{ templates: NhnTemplate[]; totalCount: number }>>
  getTemplate(senderKey: string, templateCode: string): Promise<NhnApiResponse<NhnTemplate>>

  // --- 발송 ---
  sendMessages(data: NhnSendRequest): Promise<NhnApiResponse<NhnSendResponse>>
  cancelMessage(requestId: string): Promise<NhnApiResponse>

  // --- 조회 ---
  listMessages(params: { requestId?: string; startRequestDate?: string; endRequestDate?: string; pageNum?: number; pageSize?: number }): Promise<NhnApiResponse<{ messages: NhnMessageResult[]; totalCount: number }>>
  getMessage(requestId: string, recipientSeq: number): Promise<NhnApiResponse<NhnMessageResult>>
  getMessageResults(params: { startUpdateDate: string; endUpdateDate: string; pageNum?: number; pageSize?: number }): Promise<NhnApiResponse<{ messageResults: Array<{ requestId: string; recipientSeq: number; resultCode: string; resultCodeName: string; receiveDate: string }> }>>
}
```

### 헬퍼 함수

```typescript
// src/lib/nhn-alimtalk.ts (하단)

// DB에서 설정을 읽어 클라이언트 생성
export async function getAlimtalkClient(orgId: number): Promise<NhnAlimtalkClient | null> {
  const config = await db.select().from(alimtalkConfigs)
    .where(and(eq(alimtalkConfigs.orgId, orgId), eq(alimtalkConfigs.isActive, 1)))
    .limit(1);
  if (config.length === 0) return null;
  return new NhnAlimtalkClient(config[0].appKey, config[0].secretKey);
}

// 전화번호 정규화 (010-1234-5678 → 01012345678)
export function normalizePhoneNumber(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}
```

---

## 2. API 엔드포인트 상세 설계

### 2.1 설정 API

#### GET/POST `/api/alimtalk/config`

**파일**: `src/pages/api/alimtalk/config.ts`

```typescript
// GET: 설정 조회
Request: (없음, 세션에서 orgId 추출)
Response: {
  success: true,
  data: {
    id: number;
    appKey: string;
    secretKey: string;       // 마스킹: "abc***xyz"
    defaultSenderKey: string | null;
    isActive: number;
  } | null
}

// POST: 설정 등록/수정 (upsert)
Request Body: {
  appKey: string;           // required, max 200
  secretKey: string;        // required, max 200
}
Response: {
  success: true,
  data: { id: number }
}
```

#### POST `/api/alimtalk/config/test`

**파일**: `src/pages/api/alimtalk/config/test.ts`

```typescript
// NHN Cloud 연결 테스트 (발신프로필 목록 조회로 검증)
Request Body: {
  appKey: string;
  secretKey: string;
}
Response: {
  success: true,
  data: { connected: true, senderCount: number }
}
// 또는 실패:
{ success: false, error: "NHN Cloud 연결에 실패했습니다. API 키를 확인해주세요." }
```

#### PUT `/api/alimtalk/config/default-sender`

**파일**: `src/pages/api/alimtalk/config/default-sender.ts`

```typescript
Request Body: {
  senderKey: string;        // required
}
Response: {
  success: true,
  message: "기본 발신프로필이 설정되었습니다."
}
```

### 2.2 발신프로필 Proxy API

#### GET/POST `/api/alimtalk/senders`

**파일**: `src/pages/api/alimtalk/senders/index.ts`

```typescript
// GET: 발신프로필 목록 조회
Query: { pageNum?: string; pageSize?: string }
Response: {
  success: true,
  data: {
    senders: NhnSenderProfile[];
    totalCount: number;
  }
}

// POST: 발신프로필 등록
Request Body: {
  plusFriendId: string;     // @카카오채널ID
  phoneNo: string;          // 관리자 핸드폰 번호
  categoryCode: string;     // 카테고리 코드
}
Response: {
  success: true,
  message: "발신프로필 등록 요청이 완료되었습니다. 인증 토큰을 입력해주세요."
}
```

#### POST `/api/alimtalk/senders/token`

**파일**: `src/pages/api/alimtalk/senders/token.ts`

```typescript
Request Body: {
  plusFriendId: string;
  token: string;            // 6자리 인증번호
}
Response: {
  success: true,
  message: "발신프로필 인증이 완료되었습니다."
}
```

#### DELETE `/api/alimtalk/senders/[senderKey]`

**파일**: `src/pages/api/alimtalk/senders/[senderKey].ts`

```typescript
Response: {
  success: true,
  message: "발신프로필이 삭제되었습니다."
}
```

#### GET `/api/alimtalk/sender-categories`

**파일**: `src/pages/api/alimtalk/sender-categories.ts`

```typescript
Response: {
  success: true,
  data: NhnSenderCategory[]
}
```

### 2.3 템플릿 Proxy API

#### GET `/api/alimtalk/templates`

**파일**: `src/pages/api/alimtalk/templates/index.ts`

```typescript
Query: { senderKey: string }   // required
Response: {
  success: true,
  data: {
    templates: NhnTemplate[];
    totalCount: number;
  }
}
```

#### GET `/api/alimtalk/templates/[templateCode]`

**파일**: `src/pages/api/alimtalk/templates/[templateCode].ts`

```typescript
Query: { senderKey: string }   // required
Response: {
  success: true,
  data: NhnTemplate
}
```

### 2.4 템플릿 연결 (로컬) API

#### GET/POST `/api/alimtalk/template-links`

**파일**: `src/pages/api/alimtalk/template-links/index.ts`

```typescript
// GET: 파티션별 템플릿 연결 목록
Query: { partitionId: string }   // required
Response: {
  success: true,
  data: AlimtalkTemplateLink[]
}

// POST: 템플릿 연결 생성
Request Body: {
  partitionId: number;
  name: string;                  // 연결 이름 (사용자 지정)
  senderKey: string;
  templateCode: string;
  templateName?: string;
  recipientField: string;        // 수신번호 필드 키
  variableMappings?: Record<string, string>;  // { "#{변수명}": "필드키" }
  triggerType?: "manual";        // 현재는 manual만
}
Response: {
  success: true,
  data: { id: number }
}
```

#### PUT/DELETE `/api/alimtalk/template-links/[id]`

**파일**: `src/pages/api/alimtalk/template-links/[id].ts`

```typescript
// PUT: 템플릿 연결 수정
Request Body: {
  name?: string;
  recipientField?: string;
  variableMappings?: Record<string, string>;
  isActive?: number;
}
Response: {
  success: true,
  message: "템플릿 연결이 수정되었습니다."
}

// DELETE: 템플릿 연결 삭제
Response: {
  success: true,
  message: "템플릿 연결이 삭제되었습니다."
}
```

### 2.5 발송 API

#### POST `/api/alimtalk/send`

**파일**: `src/pages/api/alimtalk/send.ts`

```typescript
Request Body: {
  templateLinkId: number;        // 템플릿 연결 ID
  recordIds: number[];           // 발송할 레코드 ID 목록 (최대 1000건)
}

// 처리 로직:
// 1. templateLinkId로 연결 정보 조회 (senderKey, templateCode, recipientField, variableMappings)
// 2. recordIds로 레코드 조회 → 각 레코드에서 recipientField, variableMappings로 치환 데이터 구성
// 3. NHN Cloud 치환 발송 API 호출
// 4. 결과를 alimtalk_send_logs에 저장

Response: {
  success: true,
  data: {
    requestId: string;
    totalCount: number;
    successCount: number;
    failCount: number;
    results: Array<{
      recordId: number;
      recipientNo: string;
      resultCode: number;
      resultMessage: string;
    }>;
  }
}
```

### 2.6 발송 이력 API

#### GET `/api/alimtalk/logs`

**파일**: `src/pages/api/alimtalk/logs/index.ts`

```typescript
Query: {
  partitionId?: string;
  templateLinkId?: string;
  status?: string;               // pending | sent | failed
  startDate?: string;            // YYYY-MM-DD
  endDate?: string;              // YYYY-MM-DD
  page?: string;                 // default: 1
  pageSize?: string;             // default: 50
}
Response: {
  success: true,
  data: AlimtalkSendLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
```

#### GET `/api/alimtalk/logs/[id]`

**파일**: `src/pages/api/alimtalk/logs/[id].ts`

```typescript
Response: {
  success: true,
  data: AlimtalkSendLog
}
```

#### POST `/api/alimtalk/logs/sync`

**파일**: `src/pages/api/alimtalk/logs/sync.ts`

```typescript
// NHN Cloud 결과 업데이트 API를 호출하여 로컬 DB 동기화
// pending 상태인 로그의 requestId/recipientSeq로 NHN Cloud 조회 → status 업데이트
Request Body: {
  logIds?: number[];             // 특정 로그만 동기화 (없으면 최근 pending 전체)
}
Response: {
  success: true,
  data: {
    synced: number;              // 동기화된 건수
    updated: number;             // 상태 변경된 건수
  }
}
```

### 2.7 통계 API

#### GET `/api/alimtalk/stats`

**파일**: `src/pages/api/alimtalk/stats.ts`

```typescript
Query: {
  period?: string;               // today | week | month (default: today)
}
Response: {
  success: true,
  data: {
    total: number;
    sent: number;
    failed: number;
    pending: number;
    recentLogs: AlimtalkSendLog[];  // 최근 10건
  }
}
```

---

## 3. SWR 훅 설계

### 3.1 `useAlimtalkConfig`

**파일**: `src/hooks/useAlimtalkConfig.ts`

```typescript
export function useAlimtalkConfig() {
  const { data, error, isLoading, mutate } = useSWR<ConfigResponse>(
    "/api/alimtalk/config",
    fetcher
  );

  const saveConfig = async (config: { appKey: string; secretKey: string }) => Promise<ApiResult>;
  const testConnection = async (config: { appKey: string; secretKey: string }) => Promise<ApiResult>;
  const setDefaultSender = async (senderKey: string) => Promise<ApiResult>;

  return {
    config: data?.data ?? null,
    isConfigured: !!data?.data?.appKey,
    isLoading, error, mutate,
    saveConfig, testConnection, setDefaultSender,
  };
}
```

### 3.2 `useAlimtalkSenders`

**파일**: `src/hooks/useAlimtalkSenders.ts`

```typescript
export function useAlimtalkSenders() {
  const { config } = useAlimtalkConfig();
  const { data, error, isLoading, mutate } = useSWR<SendersResponse>(
    config ? "/api/alimtalk/senders" : null,
    fetcher
  );

  const registerSender = async (data: RegisterSenderData) => Promise<ApiResult>;
  const authenticateToken = async (data: AuthTokenData) => Promise<ApiResult>;
  const deleteSender = async (senderKey: string) => Promise<ApiResult>;

  return {
    senders: data?.data?.senders ?? [],
    totalCount: data?.data?.totalCount ?? 0,
    isLoading, error, mutate,
    registerSender, authenticateToken, deleteSender,
  };
}
```

### 3.3 `useAlimtalkTemplates`

**파일**: `src/hooks/useAlimtalkTemplates.ts`

```typescript
export function useAlimtalkTemplates(senderKey: string | null) {
  const { data, error, isLoading, mutate } = useSWR<TemplatesResponse>(
    senderKey ? `/api/alimtalk/templates?senderKey=${senderKey}` : null,
    fetcher
  );

  return {
    templates: data?.data?.templates ?? [],
    totalCount: data?.data?.totalCount ?? 0,
    isLoading, error, mutate,
  };
}
```

### 3.4 `useAlimtalkTemplateLinks`

**파일**: `src/hooks/useAlimtalkTemplateLinks.ts`

```typescript
export function useAlimtalkTemplateLinks(partitionId: number | null) {
  const { data, error, isLoading, mutate } = useSWR<TemplateLinksResponse>(
    partitionId ? `/api/alimtalk/template-links?partitionId=${partitionId}` : null,
    fetcher
  );

  const createLink = async (linkData: CreateTemplateLinkData) => Promise<ApiResult>;
  const updateLink = async (id: number, linkData: UpdateTemplateLinkData) => Promise<ApiResult>;
  const deleteLink = async (id: number) => Promise<ApiResult>;

  return {
    templateLinks: data?.data ?? [],
    isLoading, error, mutate,
    createLink, updateLink, deleteLink,
  };
}
```

### 3.5 `useAlimtalkLogs`

**파일**: `src/hooks/useAlimtalkLogs.ts`

```typescript
interface UseAlimtalkLogsParams {
  partitionId?: number | null;
  templateLinkId?: number | null;
  status?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

export function useAlimtalkLogs(params: UseAlimtalkLogsParams) {
  // 쿼리스트링 빌드 후 SWR 키 생성
  const { data, error, isLoading, mutate } = useSWR<LogsResponse>(key, fetcher);

  const syncResults = async (logIds?: number[]) => Promise<ApiResult>;

  return {
    logs: data?.data ?? [],
    total: data?.total ?? 0,
    page: data?.page ?? 1,
    pageSize: data?.pageSize ?? 50,
    totalPages: data?.totalPages ?? 0,
    isLoading, error, mutate,
    syncResults,
  };
}
```

### 3.6 `useAlimtalkStats`

**파일**: `src/hooks/useAlimtalkStats.ts`

```typescript
export function useAlimtalkStats(period: "today" | "week" | "month" = "today") {
  const { data, error, isLoading } = useSWR<StatsResponse>(
    `/api/alimtalk/stats?period=${period}`,
    fetcher,
    { refreshInterval: 30000 }  // 30초마다 자동 갱신
  );

  return {
    stats: data?.data ?? { total: 0, sent: 0, failed: 0, pending: 0, recentLogs: [] },
    isLoading, error,
  };
}
```

### 3.7 `useAlimtalkSend`

**파일**: `src/hooks/useAlimtalkSend.ts`

```typescript
export function useAlimtalkSend() {
  const sendAlimtalk = async (data: {
    templateLinkId: number;
    recordIds: number[];
  }) => Promise<SendResult>;

  return { sendAlimtalk };
}
```

---

## 4. 컴포넌트 설계

### 4.1 `AlimtalkPage` (메인 페이지)

**파일**: `src/pages/alimtalk.tsx`

```typescript
// 탭 기반 레이아웃
// Tabs: 대시보드 | 발신프로필 | 템플릿 | 발송 이력 | 설정

interface AlimtalkPageState {
  activeTab: "dashboard" | "senders" | "templates" | "logs" | "settings";
}

// WorkspaceLayout 내부, 설정 미완료 시 설정 탭으로 자동 이동
// useAlimtalkConfig().isConfigured로 판단
```

### 4.2 `AlimtalkConfigForm` (설정 탭)

**파일**: `src/components/alimtalk/AlimtalkConfigForm.tsx`

```typescript
interface AlimtalkConfigFormProps {
  // 없음 - 내부에서 useAlimtalkConfig 사용
}

// UI 구성:
// - appKey 입력 (Input)
// - secretKey 입력 (Input, type=password)
// - [연결 테스트] 버튼 → 성공 시 초록색 체크 표시
// - [저장] 버튼
// - 현재 기본 발신프로필 표시 (설정된 경우)
```

### 4.3 `SenderProfileList` (발신프로필 탭)

**파일**: `src/components/alimtalk/SenderProfileList.tsx`

```typescript
interface SenderProfileListProps {
  // 없음 - 내부에서 useAlimtalkSenders, useAlimtalkConfig 사용
}

// UI 구성:
// - 카드 그리드 레이아웃
// - 각 카드: 카카오채널 ID, senderKey, 상태 배지, 알림톡/친구톡 아이콘
// - 기본 발신프로필 배지 (★ 기본)
// - [기본으로 설정] 드롭다운 메뉴
// - [삭제] 드롭다운 메뉴 (확인 다이얼로그)
// - 우측 상단 [발신프로필 등록] 버튼
```

### 4.4 `SenderProfileRegisterDialog` (발신프로필 등록)

**파일**: `src/components/alimtalk/SenderProfileRegisterDialog.tsx`

```typescript
interface SenderProfileRegisterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// 2단계 스텝 다이얼로그:
// Step 1: 카카오채널 ID, 핸드폰 번호, 카테고리 선택 → [등록] 버튼
// Step 2: 인증번호(토큰) 6자리 입력 → [인증] 버튼
// 카테고리 선택: sender-categories API 조회 → 트리 구조 Select
```

### 4.5 `TemplateList` (템플릿 탭)

**파일**: `src/components/alimtalk/TemplateList.tsx`

```typescript
interface TemplateListProps {
  // 없음 - 내부에서 useAlimtalkSenders, useAlimtalkTemplates 사용
}

// UI 구성:
// - 상단: 발신프로필 Select (senders 목록)
// - 선택된 발신프로필의 템플릿 목록 테이블
//   - 컬럼: 템플릿코드, 템플릿명, 메시지타입, 상태, 등록일
//   - 각 행: [상세보기] → TemplateDetailDialog
//   - 각 행: [파티션에 연결] → TemplateLinkDialog
// - 승인(APR) 상태만 연결 가능, 나머지는 비활성화
```

### 4.6 `TemplateDetailDialog` (템플릿 상세)

**파일**: `src/components/alimtalk/TemplateDetailDialog.tsx`

```typescript
interface TemplateDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  senderKey: string;
  templateCode: string;
}

// UI 구성:
// - 카카오톡 메시지 미리보기 스타일 (노란색 말풍선)
// - 템플릿 내용 (변수: #{변수명} 하이라이트)
// - 버튼 목록
// - 빠른 응답 목록
// - 메타정보: 코드, 타입, 상태, 등록일
```

### 4.7 `TemplateLinkDialog` (템플릿-파티션 연결)

**파일**: `src/components/alimtalk/TemplateLinkDialog.tsx`

```typescript
interface TemplateLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  senderKey: string;
  templateCode: string;
  templateName: string;
  templateContent: string;
  mode: "create" | "edit";
  existingLink?: AlimtalkTemplateLink;
}

// UI 구성:
// - 연결 이름 입력
// - 파티션 Select (usePartitions로 조회)
// - 수신번호 필드 Select (useFields로 해당 파티션의 phone 타입 필드 목록)
// - 변수 매핑: VariableMappingEditor
// - [저장] 버튼
```

### 4.8 `VariableMappingEditor` (변수 매핑)

**파일**: `src/components/alimtalk/VariableMappingEditor.tsx`

```typescript
interface VariableMappingEditorProps {
  templateContent: string;          // #{변수명} 추출용
  fields: FieldDefinition[];        // 매핑 가능한 필드 목록
  value: Record<string, string>;    // 현재 매핑: { "#{변수명}": "필드키" }
  onChange: (mappings: Record<string, string>) => void;
}

// UI 구성:
// - templateContent에서 #{...} 패턴 추출
// - 각 변수별 행: [변수명 라벨] ← → [필드 Select]
// - 미리보기: 예시 데이터로 치환된 결과 표시
```

### 4.9 `SendAlimtalkDialog` (발송 다이얼로그)

**파일**: `src/components/alimtalk/SendAlimtalkDialog.tsx`

```typescript
interface SendAlimtalkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partitionId: number;
  recordIds: number[];              // 선택된 레코드 ID 목록
}

// UI 구성:
// - 상단: 발송 대상 수 표시 ("{n}건의 레코드에 발송")
// - 템플릿 연결 Select (해당 파티션의 template-links)
// - 선택된 템플릿의 미리보기 (첫 번째 레코드 기준 변수 치환)
// - 수신번호 미리보기 목록 (번호 누락/형식 오류 경고)
// - [발송] 버튼 → 확인 다이얼로그 → 발송 실행
// - 발송 결과 요약 표시 (성공 n건, 실패 n건)
```

### 4.10 `SendLogTable` (발송 이력 탭)

**파일**: `src/components/alimtalk/SendLogTable.tsx`

```typescript
interface SendLogTableProps {
  // 없음 - 내부에서 useAlimtalkLogs 사용
}

// UI 구성:
// - 필터: 기간(DateRange), 상태(Select), 파티션(Select)
// - 테이블 컬럼: 발송일시, 수신번호, 템플릿명, 상태 배지, 결과 메시지
// - 상태 배지 색상: pending(노랑), sent(초록), failed(빨강)
// - 페이지네이션 (기존 RecordTable 패턴 동일)
// - [결과 동기화] 버튼 → syncResults 호출
// - 행 클릭 시 상세 팝오버
```

### 4.11 `AlimtalkDashboard` (대시보드 탭)

**파일**: `src/components/alimtalk/AlimtalkDashboard.tsx`

```typescript
interface AlimtalkDashboardProps {
  // 없음 - 내부에서 useAlimtalkStats 사용
}

// UI 구성:
// - 기간 Select (오늘/이번주/이번달)
// - 통계 카드 4개: 전체 발송, 성공, 실패, 대기중
//   - Card + 큰 숫자 + 아이콘 + 색상
// - 최근 발송 이력 테이블 (최근 10건, 간략)
// - 설정 미완료 시: 안내 메시지 + 설정 탭 이동 버튼
```

---

## 5. 타입 정의 추가

**파일**: `src/types/index.ts` (기존 파일에 추가)

```typescript
// NHN Cloud 발신프로필
export interface SenderProfile {
  plusFriendId: string;
  senderKey: string;
  categoryCode: string;
  status: string;
  statusName: string;
  kakaoStatus: string;
  alimtalk: boolean;
  friendtalk: boolean;
  createDate: string;
}

// NHN Cloud 템플릿
export interface AlimtalkTemplate {
  senderKey: string;
  templateCode: string;
  templateName: string;
  templateMessageType: string;
  templateContent: string;
  templateStatus: string;
  templateStatusName: string;
  buttons?: Array<{
    ordering: number;
    type: string;
    name: string;
    linkMo?: string;
    linkPc?: string;
  }>;
  createDate: string;
}

// 발송 결과
export interface AlimtalkSendResult {
  requestId: string;
  totalCount: number;
  successCount: number;
  failCount: number;
  results: Array<{
    recordId: number;
    recipientNo: string;
    resultCode: number;
    resultMessage: string;
  }>;
}

// 발송 통계
export interface AlimtalkStats {
  total: number;
  sent: number;
  failed: number;
  pending: number;
  recentLogs: AlimtalkSendLog[];
}
```

---

## 6. 구현 체크리스트

### Phase 1: 기반 (설정 + NHN Cloud 클라이언트)
- [ ] `src/lib/nhn-alimtalk.ts` — NHN Cloud API 클라이언트 클래스
- [ ] `src/pages/api/alimtalk/config.ts` — 설정 GET/POST API
- [ ] `src/pages/api/alimtalk/config/test.ts` — 연결 테스트 API
- [ ] `src/pages/api/alimtalk/config/default-sender.ts` — 기본 발신프로필 설정 API
- [ ] `src/hooks/useAlimtalkConfig.ts` — 설정 SWR 훅
- [ ] `src/components/alimtalk/AlimtalkConfigForm.tsx` — 설정 폼 컴포넌트

### Phase 2: 발신프로필
- [ ] `src/pages/api/alimtalk/senders/index.ts` — 발신프로필 목록/등록 API
- [ ] `src/pages/api/alimtalk/senders/token.ts` — 토큰 인증 API
- [ ] `src/pages/api/alimtalk/senders/[senderKey].ts` — 발신프로필 삭제 API
- [ ] `src/pages/api/alimtalk/sender-categories.ts` — 카테고리 조회 API
- [ ] `src/hooks/useAlimtalkSenders.ts` — 발신프로필 SWR 훅
- [ ] `src/components/alimtalk/SenderProfileList.tsx` — 발신프로필 목록
- [ ] `src/components/alimtalk/SenderProfileRegisterDialog.tsx` — 등록 다이얼로그

### Phase 3: 템플릿
- [ ] `src/pages/api/alimtalk/templates/index.ts` — 템플릿 목록 API
- [ ] `src/pages/api/alimtalk/templates/[templateCode].ts` — 템플릿 상세 API
- [ ] `src/pages/api/alimtalk/template-links/index.ts` — 연결 목록/생성 API
- [ ] `src/pages/api/alimtalk/template-links/[id].ts` — 연결 수정/삭제 API
- [ ] `src/hooks/useAlimtalkTemplates.ts` — 템플릿 SWR 훅
- [ ] `src/hooks/useAlimtalkTemplateLinks.ts` — 연결 SWR 훅
- [ ] `src/components/alimtalk/TemplateList.tsx` — 템플릿 목록
- [ ] `src/components/alimtalk/TemplateDetailDialog.tsx` — 상세 다이얼로그
- [ ] `src/components/alimtalk/TemplateLinkDialog.tsx` — 연결 다이얼로그
- [ ] `src/components/alimtalk/VariableMappingEditor.tsx` — 변수 매핑 에디터

### Phase 4: 전송 + 이력
- [ ] `src/pages/api/alimtalk/send.ts` — 발송 API
- [ ] `src/pages/api/alimtalk/logs/index.ts` — 이력 목록 API
- [ ] `src/pages/api/alimtalk/logs/[id].ts` — 이력 상세 API
- [ ] `src/pages/api/alimtalk/logs/sync.ts` — 결과 동기화 API
- [ ] `src/hooks/useAlimtalkLogs.ts` — 이력 SWR 훅
- [ ] `src/hooks/useAlimtalkSend.ts` — 발송 훅
- [ ] `src/components/alimtalk/SendAlimtalkDialog.tsx` — 발송 다이얼로그
- [ ] `src/components/alimtalk/SendLogTable.tsx` — 이력 테이블

### Phase 5: 대시보드 + 통합
- [ ] `src/pages/api/alimtalk/stats.ts` — 통계 API
- [ ] `src/hooks/useAlimtalkStats.ts` — 통계 SWR 훅
- [ ] `src/components/alimtalk/AlimtalkDashboard.tsx` — 대시보드
- [ ] `src/pages/alimtalk.tsx` — 메인 페이지 (탭 통합)
- [ ] `src/types/index.ts` — 타입 추가
- [ ] RecordToolbar에 알림톡 발송 버튼 추가 연동
