# Design: sender-category-picker — 발신프로필 카테고리 드롭다운 선택

## 1. 아키텍처

### 데이터 흐름
```
NHN Cloud API → /api/alimtalk/sender-categories (기존) → SWR 훅 → 다이얼로그 UI
                                                           ↓
                                                    categories[]
                                                           ↓
                                         ┌─────────────────┴─────────────────┐
                                         │                                   │
                                  [메인 Select]                      [서브 Select]
                                  depth=1 목록                 선택된 메인의 subCategories
                                         │                                   │
                                         └───────────► categoryCode ◄────────┘
```

### 컴포넌트 구조
```
SenderProfileRegisterDialog
├── useAlimtalkCategories()     ← 신규 SWR 훅
├── mainCategoryCode state      ← 신규 state
├── categoryCode state          ← 기존 state 재활용
├── [메인 카테고리 Select]       ← 신규 (Input 교체)
├── [서브 카테고리 Select]       ← 신규
└── (나머지 기존 UI 유지)
```

## 2. 상세 설계

### 2.1 SWR 훅: `useAlimtalkCategories`

**파일**: `src/hooks/useAlimtalkCategories.ts`

```typescript
import useSWR from "swr";
import { useAlimtalkConfig } from "./useAlimtalkConfig";
import type { NhnSenderCategory } from "@/lib/nhn-alimtalk";

interface CategoriesResponse {
    success: boolean;
    data?: NhnSenderCategory[];
    error?: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useAlimtalkCategories() {
    const { isConfigured } = useAlimtalkConfig();

    const { data, error, isLoading } = useSWR<CategoriesResponse>(
        isConfigured ? "/api/alimtalk/sender-categories" : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    return {
        categories: data?.success ? (data.data ?? []) : [],
        isLoading,
        error: error || (data && !data.success ? data.error : null),
    };
}
```

**설계 근거**:
- `useAlimtalkSenders` 패턴과 동일한 구조
- `isConfigured` 조건부 SWR key — 알림톡 미설정 시 fetch 하지 않음
- `revalidateOnFocus: false` — 카테고리 목록은 자주 변하지 않으므로 불필요한 재요청 방지
- API 응답의 `data`가 `NhnSenderCategory[]` 배열

### 2.2 다이얼로그 수정: `SenderProfileRegisterDialog`

**파일**: `src/components/alimtalk/SenderProfileRegisterDialog.tsx`

#### 변경 1: import 추가
```typescript
import { useAlimtalkCategories } from "@/hooks/useAlimtalkCategories";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
```

#### 변경 2: state + 훅 추가
```typescript
const { categories, isLoading: categoriesLoading } = useAlimtalkCategories();
const [mainCategoryCode, setMainCategoryCode] = useState("");
```

#### 변경 3: 파생 데이터 계산
```typescript
// 선택된 메인 카테고리의 서브 카테고리 목록
const subCategories = categories.find(
    (c) => c.code === mainCategoryCode
)?.subCategories ?? [];
```

#### 변경 4: 메인 카테고리 변경 핸들러
```typescript
const handleMainCategoryChange = (code: string) => {
    setMainCategoryCode(code);
    setCategoryCode(""); // 서브 카테고리 초기화
};
```

#### 변경 5: handleClose에 mainCategoryCode 초기화 추가
```typescript
const handleClose = () => {
    setStep(1);
    setPlusFriendId("");
    setPhoneNo("");
    setMainCategoryCode("");  // 추가
    setCategoryCode("");
    setToken("");
    onOpenChange(false);
};
```

#### 변경 6: Step 1 카테고리 영역 UI 교체

**기존** (제거):
```tsx
<div className="space-y-2">
    <Label htmlFor="categoryCode">카테고리 코드</Label>
    <Input
        id="categoryCode"
        value={categoryCode}
        onChange={(e) => setCategoryCode(e.target.value)}
        placeholder="카테고리 코드 (예: 01000)"
    />
    <p className="text-xs text-muted-foreground">
        NHN Cloud 콘솔에서 카테고리 코드를 확인할 수 있습니다.
    </p>
</div>
```

**신규** (교체):
```tsx
<div className="space-y-2">
    <Label>카테고리</Label>
    <Select
        value={mainCategoryCode}
        onValueChange={handleMainCategoryChange}
        disabled={categoriesLoading}
    >
        <SelectTrigger>
            <SelectValue placeholder={categoriesLoading ? "로딩 중..." : "메인 카테고리 선택"} />
        </SelectTrigger>
        <SelectContent>
            {categories.map((cat) => (
                <SelectItem key={cat.code} value={cat.code}>
                    {cat.name}
                </SelectItem>
            ))}
        </SelectContent>
    </Select>
</div>
{mainCategoryCode && subCategories.length > 0 && (
    <div className="space-y-2">
        <Label>서브 카테고리</Label>
        <Select
            value={categoryCode}
            onValueChange={setCategoryCode}
        >
            <SelectTrigger>
                <SelectValue placeholder="서브 카테고리 선택" />
            </SelectTrigger>
            <SelectContent>
                {subCategories.map((sub) => (
                    <SelectItem key={sub.code} value={sub.code}>
                        {sub.name}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    </div>
)}
```

## 3. 구현 순서

| # | 작업 | 파일 | 의존성 |
|---|------|------|--------|
| 1 | SWR 훅 생성 | `src/hooks/useAlimtalkCategories.ts` | 없음 |
| 2 | 다이얼로그 수정 | `src/components/alimtalk/SenderProfileRegisterDialog.tsx` | #1 |
| 3 | 빌드 검증 | - | #1, #2 |

## 4. 엣지 케이스

| 케이스 | 처리 |
|--------|------|
| 알림톡 미설정 | SWR key null → fetch 안 함, Select disabled |
| 카테고리 로딩 중 | Select disabled + "로딩 중..." placeholder |
| 서브 카테고리 없는 메인 | 서브 Select 미노출, 메인의 code가 categoryCode로 설정 |
| 메인 카테고리 변경 | 서브 선택값 초기화 (`setCategoryCode("")`) |
| API 에러 | categories=[], Select에 항목 없음 |

## 5. 변경하지 않는 파일

| 파일 | 이유 |
|------|------|
| `src/pages/api/alimtalk/sender-categories.ts` | 이미 구현 완료, 변경 불필요 |
| `src/lib/nhn-alimtalk.ts` | NhnSenderCategory 타입 + getSenderCategories() 이미 존재 |
| `src/hooks/useAlimtalkSenders.ts` | registerSender는 categoryCode string만 필요 |
| DB 스키마 | 카테고리 저장 불필요 |
