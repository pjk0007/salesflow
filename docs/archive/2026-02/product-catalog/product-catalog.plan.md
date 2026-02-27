# Plan: 제품/서비스 카탈로그

## 배경

현재 Sales Manager에서 알림톡과 이메일을 통해 홍보를 할 수 있지만, **홍보 대상이 되는 제품/서비스 정보를 관리하는 기능이 없다.** 향후 AI 이메일 자동 생성 시 제품 정보를 참고하여 맞춤형 홍보 문구를 만들어야 하므로, 제품/서비스 카탈로그가 필요하다.

## 목표

- 조직(organization)별 제품/서비스를 등록/수정/삭제할 수 있는 관리 페이지
- 제품명, 설명, 카테고리, 가격 등 핵심 정보 저장
- 알림톡/이메일 발송 시 제품 정보를 참조할 수 있는 구조
- 향후 AI 이메일 생성 시 컨텍스트로 활용 가능

## 기능 요구사항

### F-01: 제품/서비스 CRUD
- 조직별로 제품/서비스 목록 관리
- 필드: 이름, 한줄 소개, 상세 설명, 카테고리, 가격(선택), 이미지 URL(선택), 활성 상태
- 생성/수정/삭제 (owner/admin만)

### F-02: 제품 목록 페이지
- 사이드바에 "제품 관리" 메뉴 추가 (Package 아이콘)
- 카드 형태 그리드로 제품 목록 표시
- 검색 + 카테고리 필터
- 빈 상태 안내 메시지

### F-03: 제품 상세/수정 다이얼로그
- 제품 클릭 시 상세 정보 + 수정 가능한 다이얼로그
- 마크다운 또는 텍스트로 상세 설명 입력

### F-04: 알림톡/이메일 연동 대비
- 제품 테이블에 AI가 활용할 수 있는 충분한 텍스트 필드
- API에서 제품 목록을 조회할 수 있는 엔드포인트
- 향후 이메일 템플릿에서 제품 정보 삽입 가능한 구조

## 데이터 모델

### products 테이블 (신규)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | serial PK | |
| orgId | uuid FK(organizations) | 조직 |
| name | varchar(200) | 제품/서비스명 |
| summary | varchar(500) | 한줄 소개 |
| description | text | 상세 설명 (AI 활용) |
| category | varchar(100) | 카테고리 |
| price | varchar(100) | 가격 (자유형식: "월 9,900원", "무료" 등) |
| imageUrl | varchar(500) | 대표 이미지 URL (선택) |
| isActive | integer | 활성/비활성 (기본 1) |
| sortOrder | integer | 정렬 순서 |
| createdAt | timestamptz | |
| updatedAt | timestamptz | |

## 기술 구현

### 변경 파일 목록

| # | 파일 | 변경 유형 | 설명 |
|---|------|-----------|------|
| 1 | `src/lib/db/schema.ts` | 수정 | `products` 테이블 정의 추가 |
| 2 | `src/pages/api/products/index.ts` | 신규 | GET(목록) + POST(생성) |
| 3 | `src/pages/api/products/[id].ts` | 신규 | PUT(수정) + DELETE(삭제) |
| 4 | `src/hooks/useProducts.ts` | 신규 | SWR 훅 (CRUD) |
| 5 | `src/pages/products.tsx` | 신규 | 제품 관리 페이지 |
| 6 | `src/components/products/ProductCard.tsx` | 신규 | 제품 카드 컴포넌트 |
| 7 | `src/components/products/ProductDialog.tsx` | 신규 | 생성/수정 다이얼로그 |
| 8 | `src/components/products/DeleteProductDialog.tsx` | 신규 | 삭제 확인 다이얼로그 |
| 9 | `src/components/dashboard/sidebar.tsx` | 수정 | "제품 관리" 메뉴 추가 |

### API 설계

**GET /api/products**
- Query: `?search=&category=`
- Response: `{ success: true, data: Product[] }`

**POST /api/products**
- Body: `{ name, summary, description, category, price?, imageUrl? }`
- Response: `{ success: true, data: Product }`

**PUT /api/products/[id]**
- Body: 수정할 필드
- Response: `{ success: true, data: Product }`

**DELETE /api/products/[id]**
- Response: `{ success: true }`

### UI 설계

- 레이아웃: `WorkspaceLayout` 사용 (사이드바 포함)
- 상단: 검색바 + 카테고리 필터 + "제품 추가" 버튼
- 본문: 카드 그리드 (반응형 2~4열)
- 카드: 이름, 한줄 소개, 카테고리 Badge, 가격, 활성 상태
- 다이얼로그: 폼 기반 생성/수정

## 검증 기준

- [ ] `pnpm build` 성공
- [ ] 제품 CRUD 정상 동작
- [ ] 사이드바에 "제품 관리" 메뉴 표시
- [ ] 검색/카테고리 필터 동작
- [ ] 빈 상태 + 로딩 상태 처리

## 참고

- 기존 패턴: `useWorkspaces`, `useFields` 등 SWR 훅 구조 동일
- 제품은 워크스페이스가 아닌 **조직(org) 레벨**에서 관리 (모든 워크스페이스에서 공유)
- 향후 확장: AI 이메일 생성 시 `GET /api/products` 호출하여 컨텍스트 제공
