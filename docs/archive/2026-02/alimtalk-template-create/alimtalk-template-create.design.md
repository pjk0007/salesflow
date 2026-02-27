# Design: 알림톡 템플릿 생성 (Template Creation via NHN Cloud API)

## 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────┐
│                    /alimtalk 페이지 (기존)                        │
│  ┌──────────┐ ┌──────────┐ ┌───────────────┐ ┌────────┐ ┌────┐│
│  │ 대시보드  │ │발신프로필│ │   템플릿 탭    │ │발송이력│ │설정││
│  └──────────┘ └──────────┘ └───────┬───────┘ └────────┘ └────┘│
└────────────────────────────────────┼──────────────────────────┘
                                     │
                   ┌─────────────────┼────────────────────┐
                   │                 │                     │
          ┌────────┴───────┐ ┌──────┴───────┐ ┌──────────┴──────────┐
          │  TemplateList  │ │TemplateDetail│ │TemplateCreateDialog  │
          │  (기존 수정)    │ │Dialog(기존)  │ │    (신규)             │
          │ +등록/수정/삭제 │ │ +수정/삭제   │ │ ┌────────┬─────────┐ │
          │  버튼 추가     │ │  버튼 추가   │ │ │FormEdit│ Preview │ │
          └────────┬───────┘ └──────────────┘ │ │  or    │         │ │
                   │                           │ │  +Btn  │ KakaoTk│ │
                   │                           │ │  +QR   │  style │ │
                   │                           │ └────────┴─────────┘ │
                   │                           └──────────┬──────────┘
                   │                                      │
          ┌────────┴──────────────────────────────────────┴─────────┐
          │              SWR Hooks                                   │
          │  useAlimtalkTemplates (기존)                              │
          │  useAlimtalkTemplateManage (신규: create/update/delete)  │
          │  useAlimtalkTemplateCategories (신규)                     │
          └────────┬──────────────────────────────────────┬─────────┘
                   │                                      │
          ┌────────┴──────────────────────────────────────┴─────────┐
          │                  Next.js API Routes                      │
          │  GET    /api/alimtalk/templates           (기존)         │
          │  GET    /api/alimtalk/templates/[code]    (기존)         │
          │  POST   /api/alimtalk/templates           (신규: 등록)   │
          │  PUT    /api/alimtalk/templates/[code]    (신규: 수정)   │
          │  DELETE /api/alimtalk/templates/[code]    (신규: 삭제)   │
          │  POST   /api/alimtalk/templates/[code]/comments (신규)  │
          │  GET    /api/alimtalk/template-categories  (신규)        │
          └────────┬────────────────────────────────────────────────┘
                   │
          ┌────────┴──────────────┐
          │  NHN Cloud API Client │
          │  (nhn-alimtalk.ts)    │
          │  + 5개 메서드 추가     │
          └───────────────────────┘
```

---

## 1. NHN Cloud API 클라이언트 확장 (`src/lib/nhn-alimtalk.ts`)

### 신규 타입 정의

```typescript
// 기존 NhnTemplateButton에 필드 추가
export interface NhnTemplateButton {
    ordering: number;
    type: string;
    name: string;
    linkMo?: string;
    linkPc?: string;
    schemeIos?: string;
    schemeAndroid?: string;
    bizFormId?: number;     // 추가
    pluginId?: string;      // 추가
    telNumber?: string;     // 추가
}

// 기존 NhnTemplateQuickReply에 필드 추가
export interface NhnTemplateQuickReply {
    ordering: number;
    type: string;
    name: string;
    linkMo?: string;
    linkPc?: string;
    schemeIos?: string;     // 추가
    schemeAndroid?: string; // 추가
    bizFormId?: number;     // 추가
}

// 기존 NhnTemplate에 필드 추가
export interface NhnTemplate {
    // ... 기존 필드 유지
    templateExtra?: string;           // 추가
    templateTitle?: string;           // 추가
    templateSubtitle?: string;        // 추가
    templateHeader?: string;          // 추가
    templateItem?: {                  // 추가
        list: Array<{ title: string; description: string }>;
        summary?: { title: string; description: string };
    };
    templateItemHighlight?: {         // 추가
        title: string;
        description: string;
        imageUrl?: string;
    };
    templateRepresentLink?: {         // 추가
        linkMo?: string;
        linkPc?: string;
        schemeIos?: string;
        schemeAndroid?: string;
    };
    securityFlag?: boolean;           // 추가
    categoryCode?: string;            // 추가
    comments?: Array<{                // 추가
        id: string;
        content: string;
        userName: string;
        createdAt: string;
        status: string;
    }>;
}

// 신규: 템플릿 등록 요청
export interface NhnRegisterTemplateRequest {
    templateCode: string;
    templateName: string;
    templateContent: string;
    templateMessageType?: string;
    templateEmphasizeType?: string;
    templateExtra?: string;
    templateTitle?: string;
    templateSubtitle?: string;
    templateHeader?: string;
    templateItem?: {
        list: Array<{ title: string; description: string }>;
        summary?: { title: string; description: string };
    };
    templateItemHighlight?: {
        title: string;
        description: string;
        imageUrl?: string;
    };
    templateRepresentLink?: {
        linkMo?: string;
        linkPc?: string;
        schemeIos?: string;
        schemeAndroid?: string;
    };
    templateImageName?: string;
    templateImageUrl?: string;
    securityFlag?: boolean;
    categoryCode?: string;
    buttons?: NhnTemplateButton[];
    quickReplies?: NhnTemplateQuickReply[];
}

// 신규: 템플릿 수정 요청 (templateCode 제외)
export type NhnUpdateTemplateRequest = Omit<NhnRegisterTemplateRequest, "templateCode">;

// 신규: 템플릿 카테고리
export interface NhnTemplateCategory {
    code: string;
    name: string;
    groupName: string;
    inclusion: string;
    exclusion: string;
}
```

### 신규 클라이언트 메서드 (NhnAlimtalkClient에 추가)

```typescript
// --- 템플릿 관리 ---

async getTemplateCategories() {
    const result = await this.request(
        "GET",
        "/alimtalk/v2.3/appkeys/{appkey}/template/categories"
    );
    return {
        header: result.header,
        categories: (result.categories ?? []) as NhnTemplateCategory[],
    };
}

async registerTemplate(senderKey: string, data: NhnRegisterTemplateRequest) {
    const result = await this.request(
        "POST",
        `/alimtalk/v2.3/appkeys/{appkey}/senders/${encodeURIComponent(senderKey)}/templates`,
        data
    );
    return { header: result.header };
}

async updateTemplate(senderKey: string, templateCode: string, data: NhnUpdateTemplateRequest) {
    const result = await this.request(
        "PUT",
        `/alimtalk/v2.3/appkeys/{appkey}/senders/${encodeURIComponent(senderKey)}/templates/${encodeURIComponent(templateCode)}`,
        data
    );
    return { header: result.header };
}

async deleteTemplate(senderKey: string, templateCode: string) {
    const result = await this.request(
        "DELETE",
        `/alimtalk/v2.3/appkeys/{appkey}/senders/${encodeURIComponent(senderKey)}/templates/${encodeURIComponent(templateCode)}`
    );
    return { header: result.header };
}

async commentTemplate(senderKey: string, templateCode: string, comment: string) {
    const result = await this.request(
        "POST",
        `/alimtalk/v2.3/appkeys/{appkey}/senders/${encodeURIComponent(senderKey)}/templates/${encodeURIComponent(templateCode)}/comments`,
        { comment }
    );
    return { header: result.header };
}
```

---

## 2. API 엔드포인트 상세 설계

### 2.1 템플릿 등록 — POST `/api/alimtalk/templates`

**파일**: `src/pages/api/alimtalk/templates/index.ts` (기존 파일에 POST 추가)

```typescript
// 기존 GET 핸들러 + 신규 POST 핸들러

// POST: 템플릿 등록
Request Body: {
    senderKey: string;           // required — 발신프로필 키
    templateCode: string;        // required
    templateName: string;        // required
    templateContent: string;     // required
    templateMessageType?: string;
    templateEmphasizeType?: string;
    templateExtra?: string;
    templateTitle?: string;
    templateSubtitle?: string;
    templateHeader?: string;
    securityFlag?: boolean;
    categoryCode?: string;
    buttons?: NhnTemplateButton[];
    quickReplies?: NhnTemplateQuickReply[];
}
Response: {
    success: true,
    message: "템플릿이 등록되었습니다."
}
// 또는 실패:
{ success: false, error: "..." }
```

### 2.2 템플릿 수정 — PUT `/api/alimtalk/templates/[templateCode]`

**파일**: `src/pages/api/alimtalk/templates/[templateCode].ts` (기존 파일에 PUT 추가)

```typescript
// 기존 GET 핸들러 + 신규 PUT/DELETE 핸들러

// PUT: 템플릿 수정
Request Body: {
    senderKey: string;           // required — query 또는 body
    templateName: string;        // required
    templateContent: string;     // required
    templateMessageType?: string;
    templateEmphasizeType?: string;
    templateExtra?: string;
    templateTitle?: string;
    templateSubtitle?: string;
    templateHeader?: string;
    securityFlag?: boolean;
    categoryCode?: string;
    buttons?: NhnTemplateButton[];
    quickReplies?: NhnTemplateQuickReply[];
}
Response: {
    success: true,
    message: "템플릿이 수정되었습니다."
}
```

### 2.3 템플릿 삭제 — DELETE `/api/alimtalk/templates/[templateCode]`

**파일**: `src/pages/api/alimtalk/templates/[templateCode].ts` (위와 동일 파일)

```typescript
// DELETE: 템플릿 삭제
Query: { senderKey: string }   // required
Response: {
    success: true,
    message: "템플릿이 삭제되었습니다."
}
```

### 2.4 템플릿 문의(검수요청) — POST `/api/alimtalk/templates/[templateCode]/comments`

**파일**: `src/pages/api/alimtalk/templates/[templateCode]/comments.ts` (신규)

```typescript
// POST: 검수 요청/문의
Request Body: {
    senderKey: string;   // required
    comment: string;     // required
}
Response: {
    success: true,
    message: "검수 요청이 완료되었습니다."
}
```

### 2.5 템플릿 카테고리 — GET `/api/alimtalk/template-categories`

**파일**: `src/pages/api/alimtalk/template-categories.ts` (신규)

```typescript
// GET: 카테고리 목록
Response: {
    success: true,
    data: NhnTemplateCategory[]
}
```

---

## 3. SWR 훅 설계

### 3.1 `useAlimtalkTemplateManage` (신규)

**파일**: `src/hooks/useAlimtalkTemplateManage.ts`

```typescript
export function useAlimtalkTemplateManage(senderKey: string | null) {
    // useAlimtalkTemplates의 mutate를 가져와서 CRUD 후 목록 갱신
    const { mutate } = useAlimtalkTemplates(senderKey);

    const createTemplate = async (data: {
        senderKey: string;
        templateCode: string;
        templateName: string;
        templateContent: string;
        templateMessageType?: string;
        templateEmphasizeType?: string;
        templateExtra?: string;
        templateTitle?: string;
        templateSubtitle?: string;
        templateHeader?: string;
        securityFlag?: boolean;
        categoryCode?: string;
        buttons?: NhnTemplateButton[];
        quickReplies?: NhnTemplateQuickReply[];
    }) => {
        const res = await fetch("/api/alimtalk/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateTemplate = async (
        templateCode: string,
        data: {
            senderKey: string;
            templateName: string;
            templateContent: string;
            templateMessageType?: string;
            templateEmphasizeType?: string;
            templateExtra?: string;
            templateTitle?: string;
            templateSubtitle?: string;
            templateHeader?: string;
            securityFlag?: boolean;
            categoryCode?: string;
            buttons?: NhnTemplateButton[];
            quickReplies?: NhnTemplateQuickReply[];
        }
    ) => {
        const res = await fetch(`/api/alimtalk/templates/${encodeURIComponent(templateCode)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteTemplate = async (templateCode: string, senderKey: string) => {
        const res = await fetch(
            `/api/alimtalk/templates/${encodeURIComponent(templateCode)}?senderKey=${encodeURIComponent(senderKey)}`,
            { method: "DELETE" }
        );
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const commentTemplate = async (templateCode: string, senderKey: string, comment: string) => {
        const res = await fetch(
            `/api/alimtalk/templates/${encodeURIComponent(templateCode)}/comments`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ senderKey, comment }),
            }
        );
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return { createTemplate, updateTemplate, deleteTemplate, commentTemplate };
}
```

### 3.2 `useAlimtalkTemplateCategories` (신규)

**파일**: `src/hooks/useAlimtalkTemplateCategories.ts`

```typescript
const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useAlimtalkTemplateCategories() {
    const { data, isLoading } = useSWR<{
        success: boolean;
        data?: NhnTemplateCategory[];
    }>("/api/alimtalk/template-categories", fetcher);

    return {
        categories: data?.data ?? [],
        isLoading,
    };
}
```

---

## 4. 컴포넌트 설계

### 4.1 `TemplateCreateDialog` (신규 — 메인 다이얼로그)

**파일**: `src/components/alimtalk/TemplateCreateDialog.tsx`

```typescript
interface TemplateCreateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    senderKey: string;
    mode: "create" | "edit";
    template?: NhnTemplate;    // edit 모드 시 기존 데이터
}

// 상태 관리:
interface TemplateFormState {
    templateCode: string;
    templateName: string;
    templateContent: string;
    templateMessageType: "BA" | "EX" | "AD" | "MI";
    templateEmphasizeType: "NONE" | "TEXT" | "IMAGE" | "ITEM_LIST";
    templateExtra: string;
    templateTitle: string;
    templateSubtitle: string;
    templateHeader: string;
    securityFlag: boolean;
    categoryCode: string;
    buttons: NhnTemplateButton[];
    quickReplies: NhnTemplateQuickReply[];
    interactionType: "buttons" | "quickReplies";  // 토글
}

// UI 레이아웃: Dialog (sm:max-w-5xl)
// 2-column 레이아웃:
//   좌측 (w-1/2): TemplateFormEditor
//   우측 (w-1/2): TemplatePreview
// 하단: [취소] [등록/수정] 버튼
```

### 4.2 `TemplateFormEditor` (신규 — 폼 영역)

**파일**: `src/components/alimtalk/TemplateFormEditor.tsx`

```typescript
interface TemplateFormEditorProps {
    value: TemplateFormState;
    onChange: (state: TemplateFormState) => void;
    mode: "create" | "edit";
}

// UI 구성 (위→아래 순서):
// 1. 템플릿 코드 (Input, create 모드만 editable, edit 모드 disabled)
// 2. 템플릿 이름 (Input)
// 3. 메시지 유형 (Select: BA/EX/AD/MI)
// 4. 강조 유형 (Select: NONE/TEXT/IMAGE/ITEM_LIST)
//    - TEXT 선택 시: 타이틀 + 서브타이틀 필드 노출
// 5. 헤더 (Input, 최대 16자)
// 6. 본문 (Textarea, 글자수 카운터 표시 0/1300)
// 7. 부가정보 (Textarea, EX/MI 유형일 때만 노출)
// 8. 보안 템플릿 (Checkbox)
// 9. 카테고리 (Select, useAlimtalkTemplateCategories 사용)
// 10. 상호작용 토글: [버튼] / [빠른 응답] (RadioGroup)
// 11. 버튼 모드: ButtonEditor
//     빠른 응답 모드: QuickReplyEditor
```

### 4.3 `TemplatePreview` (신규 — 카카오톡 미리보기)

**파일**: `src/components/alimtalk/TemplatePreview.tsx`

```typescript
interface TemplatePreviewProps {
    templateContent: string;
    templateMessageType: string;
    templateEmphasizeType: string;
    templateTitle?: string;
    templateSubtitle?: string;
    templateHeader?: string;
    templateExtra?: string;
    buttons: NhnTemplateButton[];
    quickReplies: NhnTemplateQuickReply[];
    interactionType: "buttons" | "quickReplies";
}

// UI 구성 (카카오톡 채팅방 스타일):
// ┌────────────────────────────┐
// │  bg-[#B2C7D9] (카카오 배경) │
// │  ┌──────────────────────┐  │
// │  │  bg-white (말풍선)    │  │
// │  │                      │  │
// │  │  [헤더] (bold, 14자)  │  │
// │  │  ─────────────────── │  │
// │  │  [타이틀] (TEXT 시)   │  │
// │  │  [서브타이틀]         │  │
// │  │  ─────────────────── │  │
// │  │  메시지 본문           │  │
// │  │  #{변수} 하이라이트    │  │
// │  │  ─────────────────── │  │
// │  │  [부가정보] (EX/MI)   │  │
// │  │                      │  │
// │  │  ┌────────────────┐  │  │
// │  │  │   버튼 1        │  │  │
// │  │  │   버튼 2        │  │  │
// │  │  └────────────────┘  │  │
// │  └──────────────────────┘  │
// │  또는                       │
// │  [빠른1] [빠른2] [빠른3]    │
// └────────────────────────────┘
//
// 기존 TemplateDetailDialog의 미리보기 패턴 재활용:
// - bg-[#B2C7D9] 배경
// - bg-white rounded-lg 말풍선
// - highlightVariables 함수로 #{변수} 하이라이트
// - 버튼: border rounded bg-gray-50 text-blue-600
```

### 4.4 `ButtonEditor` (신규 — 버튼 편집기)

**파일**: `src/components/alimtalk/ButtonEditor.tsx`

```typescript
interface ButtonEditorProps {
    buttons: NhnTemplateButton[];
    onChange: (buttons: NhnTemplateButton[]) => void;
    messageType: string;   // AD/MI 시 AC 버튼 강제
}

// UI 구성:
// - [+ 버튼 추가] (최대 5개일 때 비활성화)
// - 각 버튼 행:
//   [순서] [타입 Select] [이름 Input] [타입별 추가 필드] [삭제 X]
//
// 타입별 추가 필드:
//   WL → linkMo (필수), linkPc (선택)
//   AL → schemeIos (필수), schemeAndroid (필수)
//   DS, BK, MD, BC, BT → 추가 필드 없음
//   AC → name="채널 추가" 고정, ordering=1 고정
//   BF → bizFormId (필수)
//   TN → telNumber (필수)
//
// AD/MI 유형일 경우:
//   - 1번 버튼이 AC가 아니면 자동으로 AC 추가
//   - AC 버튼 삭제 불가
```

### 4.5 `QuickReplyEditor` (신규 — 빠른 응답 편집기)

**파일**: `src/components/alimtalk/QuickReplyEditor.tsx`

```typescript
interface QuickReplyEditorProps {
    quickReplies: NhnTemplateQuickReply[];
    onChange: (quickReplies: NhnTemplateQuickReply[]) => void;
}

// UI 구성:
// - [+ 빠른 응답 추가] (최대 5개일 때 비활성화)
// - 각 행: [순서] [타입 Select] [이름 Input] [타입별 추가 필드] [삭제 X]
//
// 타입별 추가 필드:
//   WL → linkMo (필수), linkPc (선택)
//   AL → schemeIos, schemeAndroid
//   BK, BC, BT → 추가 필드 없음
//   BF → bizFormId
```

### 4.6 `TemplateList` (기존 수정)

**파일**: `src/components/alimtalk/TemplateList.tsx`

변경 내용:
```typescript
// 추가할 state
const [createDialogOpen, setCreateDialogOpen] = useState(false);
const [editTemplate, setEditTemplate] = useState<NhnTemplate | null>(null);

// 상단 영역에 "템플릿 등록" 버튼 추가
<Button onClick={() => setCreateDialogOpen(true)}>
    <Plus className="h-4 w-4 mr-1" /> 템플릿 등록
</Button>

// 테이블 액션 컬럼에 DropdownMenu 추가 (기존 Eye, Link2 아이콘 + 추가 메뉴):
//   - 수정 (Pencil) — 상태가 TSC/APR/REJ일 때만 활성화
//   - 삭제 (Trash) — 상태가 TSC/REQ/REJ일 때만 활성화
//   - 검수 요청 (Send) — 상태가 TSC/REJ일 때만 활성화
//
// 삭제 시 확인 AlertDialog 표시
// 검수 요청 시 comment 입력 Dialog 표시

// STATUS_BADGE에 TSC 상태 추가
TSC: { label: "생성", variant: "outline" },
```

### 4.7 `TemplateDetailDialog` (기존 수정)

**파일**: `src/components/alimtalk/TemplateDetailDialog.tsx`

변경 내용:
```typescript
// Props 확장
interface TemplateDetailDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    senderKey: string;
    templateCode: string;
    onEdit?: (template: NhnTemplate) => void;    // 추가
    onDelete?: (templateCode: string) => void;   // 추가
}

// 하단에 액션 버튼 추가:
// [수정] — 상태에 따라 활성화
// [삭제] — 상태에 따라 활성화
// 기존 미리보기 UI는 유지
```

---

## 5. 구현 체크리스트

### Phase 1: API 기반
- [ ] `src/lib/nhn-alimtalk.ts` — NhnTemplateButton/QuickReply/Template 타입 확장
- [ ] `src/lib/nhn-alimtalk.ts` — NhnRegisterTemplateRequest, NhnUpdateTemplateRequest, NhnTemplateCategory 타입 추가
- [ ] `src/lib/nhn-alimtalk.ts` — getTemplateCategories() 메서드 추가
- [ ] `src/lib/nhn-alimtalk.ts` — registerTemplate() 메서드 추가
- [ ] `src/lib/nhn-alimtalk.ts` — updateTemplate() 메서드 추가
- [ ] `src/lib/nhn-alimtalk.ts` — deleteTemplate() 메서드 추가
- [ ] `src/lib/nhn-alimtalk.ts` — commentTemplate() 메서드 추가
- [ ] `src/pages/api/alimtalk/templates/index.ts` — POST 핸들러 추가
- [ ] `src/pages/api/alimtalk/templates/[templateCode].ts` — PUT, DELETE 핸들러 추가
- [ ] `src/pages/api/alimtalk/templates/[templateCode]/comments.ts` — 신규 파일
- [ ] `src/pages/api/alimtalk/template-categories.ts` — 신규 파일

### Phase 2: 미리보기 + 편집기 컴포넌트
- [ ] `src/components/alimtalk/TemplatePreview.tsx` — 신규 (카카오톡 스타일)
- [ ] `src/components/alimtalk/ButtonEditor.tsx` — 신규
- [ ] `src/components/alimtalk/QuickReplyEditor.tsx` — 신규

### Phase 3: 메인 폼 + 다이얼로그
- [ ] `src/components/alimtalk/TemplateFormEditor.tsx` — 신규
- [ ] `src/components/alimtalk/TemplateCreateDialog.tsx` — 신규
- [ ] `src/hooks/useAlimtalkTemplateManage.ts` — 신규
- [ ] `src/hooks/useAlimtalkTemplateCategories.ts` — 신규

### Phase 4: 기존 UI 통합
- [ ] `src/components/alimtalk/TemplateList.tsx` — 등록/수정/삭제/검수 버튼 추가
- [ ] `src/components/alimtalk/TemplateDetailDialog.tsx` — 수정/삭제 버튼 추가
