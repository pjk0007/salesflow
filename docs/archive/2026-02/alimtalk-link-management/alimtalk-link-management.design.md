# Design: alimtalk-link-management — 알림톡 연결 관리 UI

## 1. 아키텍처

### 변경 범위
UI 전용 (신규 2 + 수정 1). 백엔드(DB, API, 훅)는 이미 구현 완료.

### 컴포넌트 의존 관계
```
alimtalk.tsx (페이지)
  └── AlimtalkTemplateLinkList (신규)
        ├── useAlimtalkTemplateLinks (기존 훅)
        └── AlimtalkTemplateLinkDialog (신규)
              ├── useAlimtalkTemplateLinks (기존 훅)
              ├── useAlimtalkSenders (기존 훅)
              └── useAlimtalkTemplates (기존 훅, senderKey 종속)
```

### 이메일 대비 알림톡 차이점
| 항목 | 이메일 | 알림톡 |
|------|--------|--------|
| 템플릿 식별 | `emailTemplateId` (DB serial) | `templateCode` (NHN Cloud string) |
| 발신자 | 없음 (config에서 고정) | `senderKey` Select 필요 |
| 템플릿 fetch | `useEmailTemplates()` 무조건 | `useAlimtalkTemplates(senderKey)` senderKey 종속 |
| 변수 패턴 | `##변수명##` | `#{변수명}` |
| 수신 필드 placeholder | "email" | "phone" |

## 2. 상세 설계

### 2.1 AlimtalkTemplateLinkList.tsx (신규)

EmailTemplateLinkList.tsx와 동일한 구조로 알림톡 버전 생성.

#### 변경 1: import 구성
- `useAlimtalkTemplateLinks` from `@/hooks/useAlimtalkTemplateLinks`
- `AlimtalkTemplateLinkDialog` (신규 컴포넌트)
- UI: Button, Badge, Table*, Select*, Label, Skeleton, Plus/Pencil/Trash2, toast
- type: `AlimtalkTemplateLink` from `@/lib/db`, `FieldDefinition` from `@/types`

#### 변경 2: Props 인터페이스
```typescript
interface Partition { id: number; name: string; }
interface AlimtalkTemplateLinkListProps {
    partitions: Partition[];
    fields: FieldDefinition[];
}
```

#### 변경 3: TRIGGER_LABELS 상수
```typescript
const TRIGGER_LABELS: Record<string, string> = {
    manual: "수동",
    on_create: "생성 시",
    on_update: "수정 시",
};
```

#### 변경 4: 컴포넌트 상태
- `selectedPartitionId`: `number | null` — 초기값 `partitions[0]?.id ?? null`
- `dialogOpen`: `boolean`
- `editingLink`: `AlimtalkTemplateLink | null`
- `useAlimtalkTemplateLinks(selectedPartitionId)` → `{ templateLinks, isLoading, deleteLink }`

#### 변경 5: 핸들러
- `handleCreate()`: editingLink=null, dialogOpen=true
- `handleEdit(link)`: editingLink=link, dialogOpen=true
- `handleDelete(id)`: confirm → deleteLink(id) → toast

#### 변경 6: JSX 구조
- 헤더: "연결 관리" h3 + "새 연결" Button (disabled if !selectedPartitionId)
- 파티션 Select: w-[250px], partitions.map
- 로딩: Skeleton 2개
- 빈 상태: "등록된 연결이 없습니다." py-12
- 테이블: 이름(font-medium), 수신 필드(text-muted-foreground), 발송 방식(Badge), 상태(Badge), 작업(편집+삭제 ghost buttons)
- AlimtalkTemplateLinkDialog: open, onOpenChange, partitionId, link, fields props

### 2.2 AlimtalkTemplateLinkDialog.tsx (신규)

EmailTemplateLinkDialog.tsx 기반이지만 알림톡 고유 차이 반영.

#### 변경 7: import 구성
- `useAlimtalkSenders` from `@/hooks/useAlimtalkSenders`
- `useAlimtalkTemplates` from `@/hooks/useAlimtalkTemplates`
- `useAlimtalkTemplateLinks` from `@/hooks/useAlimtalkTemplateLinks`
- UI: Dialog*, Button, Input, Label, Switch, Select*, Loader2, toast
- `TriggerConditionForm` from `@/components/alimtalk/TriggerConditionForm`
- `RepeatConfigForm` from `@/components/alimtalk/RepeatConfigForm`
- type: `AlimtalkTemplateLink` from `@/lib/db`, `FieldDefinition` from `@/types`

#### 변경 8: Props 인터페이스
```typescript
interface AlimtalkTemplateLinkDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    partitionId: number;
    link: AlimtalkTemplateLink | null;
    fields: FieldDefinition[];
}
```

#### 변경 9: 훅 사용
- `useAlimtalkSenders()` → `{ senders }` (발신프로필 목록)
- `useAlimtalkTemplates(senderKey)` → `{ templates }` (senderKey 종속)
- `useAlimtalkTemplateLinks(partitionId)` → `{ createLink, updateLink }`

#### 변경 10: 컴포넌트 상태
- `saving`: boolean
- `name`: string
- `senderKey`: string (이메일에 없는 알림톡 고유 필드)
- `templateCode`: string (이메일의 emailTemplateId 대신)
- `recipientField`: string
- `variableMappings`: Record<string, string>
- `triggerType`: string (기본값 "manual")
- `triggerCondition`: any
- `useRepeat`: boolean
- `repeatConfig`: any

#### 변경 11: useEffect (편집 모드 데이터 로드)
- link가 있으면: name, senderKey, templateCode, recipientField, variableMappings, triggerType, triggerCondition, useRepeat, repeatConfig 세팅
- link가 없으면: 모든 상태 초기화
- 의존성: `[link, open]`

#### 변경 12: 변수 추출 로직
선택된 템플릿의 `templateContent`에서 `#{변수명}` 패턴 추출:
```typescript
const selectedTemplate = templates.find((t) => t.templateCode === templateCode);
const variables = selectedTemplate
    ? [...new Set(selectedTemplate.templateContent.match(/#\{([^}]+)\}/g) || [])]
          .map((v) => v.slice(2, -1))
    : [];
```

#### 변경 13: senderKey 변경 핸들러
senderKey 변경 시 templateCode 초기화 (템플릿 목록이 senderKey에 종속):
```typescript
const handleSenderKeyChange = (key: string) => {
    setSenderKey(key);
    setTemplateCode("");
    setVariableMappings({});
};
```

#### 변경 14: handleSave
- 필수값 검증: `!name || !senderKey || !templateCode || !recipientField`
- createLink 데이터: `{ partitionId, name, senderKey, templateCode, templateName: selectedTemplate?.templateName, recipientField, variableMappings, triggerType, triggerCondition, repeatConfig }`
- updateLink 데이터: `{ name, recipientField, variableMappings, triggerType, triggerCondition, repeatConfig }`
- toast: "연결이 생성/수정되었습니다."

#### 변경 15: JSX 구조 — 다이얼로그 폼
순서대로:
1. **연결 이름** Input — placeholder "고객 가입 알림"
2. **발신프로필** Select — `senders.map()`, value=senderKey, onValueChange=handleSenderKeyChange
3. **알림톡 템플릿** Select — `templates.map()`, value=templateCode, disabled if !senderKey
4. **수신 전화번호 필드** Input — placeholder "phone"
5. **변수 매핑** — variables.length > 0일 때, 각 변수에 대해 `변수명 → Input(필드명)` 형태
6. **자동 발송 설정** (border-t 구분)
   - 발송 방식 Select (manual/on_create/on_update)
   - triggerType !== "manual"일 때: TriggerConditionForm + Switch(반복 발송) + RepeatConfigForm
7. **DialogFooter**: 취소 + 저장 버튼 (disabled: saving || !name || !senderKey || !templateCode || !recipientField)

### 2.3 alimtalk.tsx (수정)

#### 변경 16: import 추가
```typescript
import { useMemo } from "react";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { usePartitions } from "@/hooks/usePartitions";
import { useFields } from "@/hooks/useFields";
import AlimtalkTemplateLinkList from "@/components/alimtalk/AlimtalkTemplateLinkList";
```

#### 변경 17: 훅 호출 (email.tsx 패턴)
```typescript
const { workspaces } = useWorkspaces();
const firstWorkspaceId = workspaces?.[0]?.id ?? null;
const { partitionTree } = usePartitions(firstWorkspaceId);
const { fields } = useFields(firstWorkspaceId);

const partitions = useMemo(() => {
    if (!partitionTree) return [];
    const all = [
        ...partitionTree.ungrouped,
        ...partitionTree.folders.flatMap((f) => f.partitions),
    ];
    return all.map((p) => ({ id: p.id, name: p.name }));
}, [partitionTree]);
```

#### 변경 18: "연결 관리" 탭 추가
기존 탭 순서에서 "템플릿"과 "발송 이력" 사이에 추가:
```tsx
<TabsTrigger value="links">연결 관리</TabsTrigger>
```
```tsx
<TabsContent value="links" className="mt-6">
    <AlimtalkTemplateLinkList partitions={partitions} fields={fields} />
</TabsContent>
```

## 3. 구현 순서

| # | 작업 | 파일 | 의존성 |
|---|------|------|--------|
| 1 | AlimtalkTemplateLinkDialog 생성 | `src/components/alimtalk/AlimtalkTemplateLinkDialog.tsx` | 없음 |
| 2 | AlimtalkTemplateLinkList 생성 | `src/components/alimtalk/AlimtalkTemplateLinkList.tsx` | #1 |
| 3 | alimtalk.tsx 탭 추가 | `src/pages/alimtalk.tsx` | #2 |

## 4. Edge Cases

### EC-01: 발신프로필이 없는 경우
- senders 빈 배열 → Select에 옵션 없음 → 사용자가 발신프로필 탭에서 먼저 등록 유도

### EC-02: 선택한 senderKey에 템플릿이 없는 경우
- templates 빈 배열 → Select에 옵션 없음 → 사용자가 템플릿 탭에서 먼저 등록 유도

### EC-03: senderKey 변경 시 templateCode 초기화
- 발신프로필 변경하면 기존 선택 템플릿 무효 → templateCode, variableMappings 초기화

### EC-04: 파티션이 없는 경우
- partitions 빈 배열 → Select 비활성 → "새 연결" 버튼 비활성

### EC-05: 템플릿에 변수가 없는 경우
- variables 빈 배열 → 변수 매핑 섹션 미표시

## 5. 변경하지 않는 파일 (검증용)

| 파일 | 이유 |
|------|------|
| `src/hooks/useAlimtalkTemplateLinks.ts` | 기존 훅 그대로 사용 |
| `src/hooks/useAlimtalkSenders.ts` | 기존 훅 그대로 사용 |
| `src/hooks/useAlimtalkTemplates.ts` | 기존 훅 그대로 사용 |
| `src/pages/api/alimtalk/template-links/index.ts` | 기존 API 그대로 사용 |
| `src/pages/api/alimtalk/template-links/[id].ts` | 기존 API 그대로 사용 |
| `src/components/alimtalk/TriggerConditionForm.tsx` | 공유 컴포넌트 변경 없음 |
| `src/components/alimtalk/RepeatConfigForm.tsx` | 공유 컴포넌트 변경 없음 |
| `src/lib/db/schema.ts` | DB 스키마 변경 없음 |
