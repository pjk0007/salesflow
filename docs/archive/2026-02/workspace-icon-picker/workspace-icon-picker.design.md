# Design: 워크스페이스 아이콘 피커

## 참조
- Plan: `docs/01-plan/features/workspace-icon-picker.plan.md`

---

## 변경 사항 (총 3개 파일)

### 변경 #1: `src/components/ui/icon-picker.tsx` (신규)

**목적**: Popover 기반 아이콘 그리드 선택 컴포넌트

**Props 인터페이스**:
```typescript
interface IconPickerProps {
    value: string;          // 현재 선택된 아이콘 이름 (예: "Briefcase")
    onChange: (icon: string) => void;  // "" 전달 시 아이콘 제거
}
```

**큐레이션 아이콘 목록** (25개, 카테고리별 그룹):
```typescript
const ICON_OPTIONS: { name: string; icon: LucideIcon }[] = [
    // 비즈니스 (5)
    { name: "Briefcase", icon: Briefcase },
    { name: "Building2", icon: Building2 },
    { name: "Store", icon: Store },
    { name: "Landmark", icon: Landmark },
    { name: "Factory", icon: Factory },
    // 사람 (4)
    { name: "Users", icon: Users },
    { name: "UserRound", icon: UserRound },
    { name: "Contact", icon: Contact },
    { name: "HeartHandshake", icon: HeartHandshake },
    // 커뮤니케이션 (4)
    { name: "Phone", icon: Phone },
    { name: "Mail", icon: Mail },
    { name: "MessageSquare", icon: MessageSquare },
    { name: "Megaphone", icon: Megaphone },
    // 데이터 (4)
    { name: "BarChart3", icon: BarChart3 },
    { name: "PieChart", icon: PieChart },
    { name: "TrendingUp", icon: TrendingUp },
    { name: "Target", icon: Target },
    // 일반 (8)
    { name: "Home", icon: Home },
    { name: "Star", icon: Star },
    { name: "Globe", icon: Globe },
    { name: "Rocket", icon: Rocket },
    { name: "Zap", icon: Zap },
    { name: "Shield", icon: Shield },
    { name: "Crown", icon: Crown },
    { name: "Gem", icon: Gem },
];
```

**UI 구조**:
```
┌─────────────────────────────────┐
│ [트리거 버튼]                     │
│  ┌──────┐                        │
│  │ Icon │  아이콘 선택            │
│  └──────┘         (또는 "없음")   │
└─────────────────────────────────┘
         │ click
         ▼
┌─────────────────────────────────┐
│ ┌────┐┌────┐┌────┐┌────┐┌────┐ │
│ │ 🏢 ││ 🏗 ││ 🏪 ││ 🏛 ││ 🏭 │ │  비즈니스
│ └────┘└────┘└────┘└────┘└────┘ │
│ ┌────┐┌────┐┌────┐┌────┐      │
│ │ 👥 ││ 👤 ││ 📇 ││ 🤝 │      │  사람
│ └────┘└────┘└────┘└────┘      │
│ ┌────┐┌────┐┌────┐┌────┐      │
│ │ 📞 ││ ✉️ ││ 💬 ││ 📢 │      │  커뮤니케이션
│ └────┘└────┘└────┘└────┘      │
│ ┌────┐┌────┐┌────┐┌────┐      │
│ │ 📊 ││ 🥧 ││ 📈 ││ 🎯 │      │  데이터
│ └────┘└────┘└────┘└────┘      │
│ ┌────┐┌────┐┌────┐┌────┐      │
│ │ 🏠 ││ ⭐ ││ 🌐 ││ 🚀 │      │  일반
│ └────┘└────┘└────┘└────┘      │
│ ┌────┐┌────┐┌────┐┌────┐      │
│ │ ⚡ ││ 🛡 ││ 👑 ││ 💎 │      │
│ └────┘└────┘└────┘└────┘      │
│                                 │
│ [없음]                          │  아이콘 제거 버튼
└─────────────────────────────────┘
```

**구현 상세**:
- `Popover` + `PopoverTrigger` + `PopoverContent` (ShadCN)
- 트리거: `Button variant="outline"` — 선택된 아이콘 + "아이콘 선택" 텍스트
- 그리드: `grid grid-cols-5 gap-1`
- 각 아이콘 셀: `Button variant="ghost" size="icon"`, 선택 시 `bg-accent` 하이라이트
- "없음" 버튼: 그리드 하단, `Button variant="ghost" size="sm"`, 클릭 시 `onChange("")`
- 아이콘 선택 시 Popover 자동 닫힘
- `ICON_OPTIONS`에서 name으로 아이콘 컴포넌트 lookup하는 헬퍼 함수 export:
  ```typescript
  export function getIconComponent(name: string): LucideIcon | null
  ```

---

### 변경 #2: `src/components/settings/WorkspaceSettingsTab.tsx`

**목적**: 아이콘 Input → IconPicker 교체 + 카드에 아이콘 표시

**변경 A — import 추가**:
```typescript
import IconPicker, { getIconComponent } from "@/components/ui/icon-picker";
```

**변경 B — 아이콘 Input 교체** (167~174줄):
기존:
```tsx
<div className="space-y-1.5">
    <Label>아이콘</Label>
    <Input
        value={icon}
        onChange={(e) => setIcon(e.target.value)}
        placeholder="아이콘 이름 (예: briefcase)"
    />
</div>
```
변경:
```tsx
<div className="space-y-1.5">
    <Label>아이콘</Label>
    <IconPicker value={icon} onChange={setIcon} />
</div>
```

**변경 C — 워크스페이스 카드에 아이콘 표시** (118~123줄):
기존:
```tsx
<CardContent className="p-4">
    <div className="font-medium truncate">{ws.name}</div>
    <div className="text-sm text-muted-foreground truncate mt-1">
        {ws.description || "설명 없음"}
    </div>
</CardContent>
```
변경:
```tsx
<CardContent className="p-4">
    <div className="flex items-center gap-2">
        {ws.icon && (() => {
            const Icon = getIconComponent(ws.icon);
            return Icon ? <Icon className="h-4 w-4 text-muted-foreground shrink-0" /> : null;
        })()}
        <div className="font-medium truncate">{ws.name}</div>
    </div>
    <div className="text-sm text-muted-foreground truncate mt-1">
        {ws.description || "설명 없음"}
    </div>
</CardContent>
```

---

### 변경 #3: `src/components/settings/CreateWorkspaceDialog.tsx`

**목적**: 아이콘 Input → IconPicker 교체

**변경 A — import 변경**:
기존:
```typescript
import { Building2, UserRound, Home, Users } from "lucide-react";
```
변경 (Building2, UserRound, Home, Users는 ICON_MAP에서 계속 사용하므로 유지):
```typescript
import { Building2, UserRound, Home, Users } from "lucide-react";
import IconPicker from "@/components/ui/icon-picker";
```

**변경 B — 아이콘 Input 교체** (147~154줄):
기존:
```tsx
<div className="space-y-1.5">
    <Label>아이콘</Label>
    <Input
        value={icon}
        onChange={(e) => setIcon(e.target.value)}
        placeholder="아이콘 이름 (예: briefcase)"
    />
</div>
```
변경:
```tsx
<div className="space-y-1.5">
    <Label>아이콘</Label>
    <IconPicker value={icon} onChange={setIcon} />
</div>
```

---

## 변경하지 않는 파일 (3개)

| 파일 | 이유 |
|------|------|
| `src/lib/db/schema.ts` | `workspaces.icon` varchar(50) 그대로 사용 |
| `src/pages/api/workspaces/index.ts` | API 변경 불필요 |
| `src/pages/api/workspaces/[id]/settings.ts` | API 변경 불필요 |

---

## 엣지 케이스

| # | 상황 | 처리 |
|---|------|------|
| 1 | DB에 이미 텍스트로 저장된 아이콘 이름이 큐레이션 목록에 없음 | `getIconComponent`가 null 반환 → 카드에 아이콘 미표시, 피커에서 선택 해제 상태 |
| 2 | 아이콘 없이 저장 (icon = "") | 정상 — DB에 null 저장, 카드에 아이콘 미표시 |
| 3 | Popover가 열린 상태에서 다이얼로그 스크롤 | Popover는 portal로 렌더링되므로 문제없음 |

---

## 구현 순서

1. `icon-picker.tsx` 생성 (ICON_OPTIONS + IconPicker + getIconComponent)
2. `WorkspaceSettingsTab.tsx` 수정 (IconPicker 교체 + 카드 아이콘)
3. `CreateWorkspaceDialog.tsx` 수정 (IconPicker 교체)
4. `pnpm build` 검증
