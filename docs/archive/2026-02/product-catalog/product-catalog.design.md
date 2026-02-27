# Design: 제품/서비스 카탈로그

> Plan 참조: `docs/01-plan/features/product-catalog.plan.md`

## 1. 데이터 모델

### 1.1 products 테이블

```typescript
// src/lib/db/schema.ts 에 추가

export const products = pgTable("products", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    summary: varchar("summary", { length: 500 }),
    description: text("description"),
    category: varchar("category", { length: 100 }),
    price: varchar("price", { length: 100 }),
    imageUrl: varchar("image_url", { length: 500 }),
    isActive: integer("is_active").default(1).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

// 타입
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
```

### 1.2 DB export

`src/lib/db/index.ts`에 `products` 테이블 export 추가.

## 2. API 설계

### 2.1 GET /api/products (`src/pages/api/products/index.ts`)

```
Query Parameters:
  - search?: string (이름/한줄소개/카테고리 검색)
  - category?: string (카테고리 필터)
  - activeOnly?: "true" (활성 제품만)

Response: { success: true, data: Product[] }

인증: getUserFromRequest() — 모든 멤버 조회 가능
```

**구현 상세**:
- `ilike`로 name, summary, category 검색
- category가 있으면 `eq(products.category, category)` 추가
- `orderBy(products.sortOrder, products.createdAt)`
- orgId 필터 필수

### 2.2 POST /api/products (`src/pages/api/products/index.ts`)

```
Body: { name, summary?, description?, category?, price?, imageUrl? }
Response: { success: true, data: Product }

인증: owner/admin만 (role !== "member")
Validation: name 필수
```

### 2.3 PUT /api/products/[id] (`src/pages/api/products/[id].ts`)

```
Body: { name?, summary?, description?, category?, price?, imageUrl?, isActive?, sortOrder? }
Response: { success: true, data: Product }

인증: owner/admin만
Validation: 해당 제품이 같은 orgId인지 확인
```

### 2.4 DELETE /api/products/[id] (`src/pages/api/products/[id].ts`)

```
Response: { success: true }

인증: owner/admin만
Validation: 해당 제품이 같은 orgId인지 확인
```

## 3. SWR 훅

### 3.1 useProducts (`src/hooks/useProducts.ts`)

```typescript
interface UseProductsOptions {
    search?: string;
    category?: string;
}

export function useProducts(options?: UseProductsOptions) {
    // SWR key: /api/products?search=&category=
    // 반환: { products, isLoading, error, mutate, createProduct, updateProduct, deleteProduct }
}
```

**패턴**: `useWorkspaces`와 동일 — fetcher + mutation 함수 + mutate()

## 4. UI 컴포넌트

### 4.1 페이지 구조 (`src/pages/products.tsx`)

```
WorkspaceLayout
└── PageContainer
    ├── PageHeader (title="제품/서비스", actions=추가 버튼)
    ├── 필터 영역
    │   ├── Input (검색)
    │   └── Select (카테고리 필터)
    └── 본문
        ├── 로딩: Skeleton 그리드
        ├── 빈 상태: 안내 + 추가 유도
        └── 카드 그리드 (grid-cols-1 sm:grid-cols-2 lg:grid-cols-3)
            └── ProductCard × N
```

### 4.2 ProductCard (`src/components/products/ProductCard.tsx`)

```
Card
├── CardHeader
│   ├── 이름
│   └── DropdownMenu (수정/삭제) — hover시 표시
├── CardContent
│   ├── 한줄 소개 (text-muted-foreground, line-clamp-2)
│   ├── 카테고리 Badge (있을 때만)
│   └── 가격 (있을 때만)
└── CardFooter
    └── 활성/비활성 Badge
```

- 카드 클릭 → ProductDialog(수정 모드) 열기
- 우측 상단 MoreHorizontal 아이콘 → 수정/삭제 드롭다운

### 4.3 ProductDialog (`src/components/products/ProductDialog.tsx`)

생성/수정 겸용 다이얼로그.

```
Dialog
├── DialogHeader: "제품 추가" / "제품 수정"
├── DialogContent (space-y-4)
│   ├── Input: 이름 (필수)
│   ├── Input: 한줄 소개
│   ├── Textarea: 상세 설명 (rows=6, AI 활용 안내 텍스트)
│   ├── Input: 카테고리
│   ├── Input: 가격
│   └── Input: 이미지 URL
└── DialogFooter: 취소 + 저장 버튼
```

Props:
```typescript
interface ProductDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    product?: Product | null;  // null이면 생성, 있으면 수정
    onSubmit: (data: ProductFormData) => Promise<{ success: boolean; error?: string }>;
}
```

### 4.4 DeleteProductDialog (`src/components/products/DeleteProductDialog.tsx`)

기존 `DeleteConfirmDialog`와 유사한 패턴. 제품명 표시 + 확인 버튼.

```typescript
interface DeleteProductDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    productName: string;
    onConfirm: () => Promise<void>;
}
```

## 5. 사이드바 메뉴 추가

### 5.1 sidebar.tsx 수정

```typescript
// navItems 배열에 추가 (이메일 다음, 발송 이력 전)
import { Package } from "lucide-react";

const navItems = [
    { href: "/", label: "홈", icon: Home },
    { href: "/records", label: "레코드", icon: Table2 },
    { href: "/alimtalk", label: "알림톡", icon: MessageSquare },
    { href: "/email", label: "이메일", icon: Mail },
    { href: "/products", label: "제품 관리", icon: Package },  // 추가
    { href: "/logs", label: "발송 이력", icon: History },
];
```

## 6. 구현 순서

| 순서 | 파일 | 작업 | 의존성 |
|:----:|------|------|--------|
| 1 | `src/lib/db/schema.ts` | products 테이블 + 타입 정의 | - |
| 2 | `src/lib/db/index.ts` | products export 추가 | #1 |
| 3 | `src/pages/api/products/index.ts` | GET + POST API | #1, #2 |
| 4 | `src/pages/api/products/[id].ts` | PUT + DELETE API | #1, #2 |
| 5 | `src/hooks/useProducts.ts` | SWR 훅 | #3, #4 |
| 6 | `src/components/products/ProductCard.tsx` | 카드 컴포넌트 | - |
| 7 | `src/components/products/ProductDialog.tsx` | 생성/수정 다이얼로그 | - |
| 8 | `src/components/products/DeleteProductDialog.tsx` | 삭제 확인 다이얼로그 | - |
| 9 | `src/pages/products.tsx` | 페이지 조합 | #5, #6, #7, #8 |
| 10 | `src/components/dashboard/sidebar.tsx` | 메뉴 추가 | - |

## 7. 검증 항목 (Gap Analysis 기준)

| # | 항목 | 검증 방법 |
|---|------|-----------|
| V-01 | products 테이블 정의 | schema.ts에 products + 타입 존재 |
| V-02 | DB export | db/index.ts에 products export |
| V-03 | GET /api/products | 검색, 카테고리 필터, orgId 필터 |
| V-04 | POST /api/products | name 필수 검증, owner/admin 권한 체크 |
| V-05 | PUT /api/products/[id] | orgId 소유권 확인, 부분 업데이트 |
| V-06 | DELETE /api/products/[id] | orgId 소유권 확인 |
| V-07 | useProducts 훅 | SWR 패턴, CRUD 함수 |
| V-08 | ProductCard | 이름/소개/카테고리/가격/상태 표시 |
| V-09 | ProductDialog | 생성/수정 겸용, name 필수 |
| V-10 | DeleteProductDialog | 제품명 확인 + 삭제 |
| V-11 | products.tsx 페이지 | 검색/필터/그리드/빈상태/로딩 |
| V-12 | 사이드바 메뉴 | /products 링크 + Package 아이콘 |
