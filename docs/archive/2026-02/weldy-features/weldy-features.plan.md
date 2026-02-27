# Plan: weldy-features (Weldy 기능 이관)

## Overview
~/project/weldy 프로젝트에서 검증된 4개 핵심 기능을 sales 프로젝트에 이관.
Weldy의 구현을 참고하되, sales 프로젝트의 아키텍처(Next.js Pages Router, Drizzle ORM, SWR, ShadCN UI)에 맞게 재구현한다.

## Feature 1: 대시보드 위젯 시스템

### 목적
워크스페이스별 커스텀 대시보드. 드래그&드롭으로 위젯 배치, 실시간 데이터 집계 시각화.

### 범위
- **DB**: `dashboards`, `dashboard_widgets` 테이블 (orgId, workspaceId 기반)
- **위젯 타입**: scorecard(숫자카드), bar(막대), line(라인), donut(도넛), stacked-bar(누적), table(테이블)
- **레이아웃**: react-grid-layout으로 드래그&드롭 배치, 반응형(lg/md/sm 브레이크포인트)
- **데이터 소스**: records 테이블 집계 (COUNT, SUM, AVG + 필드별 GROUP BY)
- **차트 라이브러리**: Recharts
- **공유**: 대시보드 slug 기반 공유 링크 (읽기 전용)
- **자동 갱신**: 30초 주기 SWR revalidation

### Weldy 참고 구현
- `src/lib/db/schema.ts`: dashboards(id, orgId, workspaceId, name, slug, layout, isDefault, isPublic) + dashboardWidgets(id, dashboardId, widgetType, title, config, gridPosition)
- `src/components/dashboard/`: DashboardGrid, WidgetCard, WidgetConfigDialog, 차트 컴포넌트들
- `src/pages/api/dashboards/`: CRUD + `/[id]/data.ts` (집계 API)
- Widget config JSON: `{ dataSource, metric, groupByField, filterField, dateRange, chartOptions }`

### Sales 적응 사항
- partitions 테이블의 records에서 집계 (weldy는 partitions 개념 없음)
- 대시보드를 워크스페이스 단위 + 파티션 필터 가능하게 설계
- 기존 records.data JSONB 필드에서 동적 집계

### 예상 파일
| 카테고리 | 파일 |
|---------|------|
| Schema | `schema.ts` (+dashboards, +dashboardWidgets) |
| Migration | `drizzle/XXXX_dashboards.sql` |
| API | `pages/api/dashboards/index.ts`, `[id].ts`, `[id]/data.ts`, `[id]/widgets.ts` |
| Hook | `hooks/useDashboards.ts`, `hooks/useDashboardData.ts` |
| UI | `components/dashboard/DashboardGrid.tsx`, `WidgetCard.tsx`, `WidgetConfigDialog.tsx`, `charts/` |
| Page | `pages/dashboard.tsx`, `pages/dashboard/[slug].tsx` (공유) |
| Deps | `react-grid-layout`, `recharts` |

---

## Feature 2: 웹 폼 (리드 캡처)

### 목적
외부 노출 가능한 웹 폼 빌더. 잠재고객이 직접 정보를 입력하면 레코드로 자동 생성.

### 범위
- **DB**: `web_forms`, `web_form_fields` 테이블
- **폼 빌더**: 드래그&드롭 필드 순서 변경 (@dnd-kit/sortable)
- **필드 타입**: text, email, phone, textarea, select, checkbox, date (7종)
- **공개 폼**: `/f/[slug]` 경로로 인증 없이 접근
- **제출 → 레코드**: 폼 제출 시 지정된 partition에 record 자동 생성
- **커스터마이징**: 완료 화면 메시지, 리다이렉트 URL, 폼 제목/설명
- **임베드**: iframe embed 코드 생성

### Weldy 참고 구현
- `src/lib/db/schema.ts`: webForms(id, workspaceId, partitionId, name, slug, title, description, settings, isActive) + webFormFields(id, formId, label, fieldKey, fieldType, isRequired, options, sortOrder)
- `src/pages/f/[slug].tsx`: 공개 폼 렌더링 (no auth, layout 없음)
- `src/pages/api/web-forms/`: CRUD + `submit.ts` (공개 API)
- `src/components/web-forms/`: FormBuilder, FormFieldEditor, FormPreview, EmbedCodeDialog

### Sales 적응 사항
- fieldKey를 sales의 fieldDefinitions.key에 매핑 (records.data에 저장)
- 웹 폼 필드 추가 시 기존 워크스페이스 필드 정의에서 선택 가능
- distributionOrder 자동 할당 (partition의 라운드로빈 설정 활용)
- 통합코드(integratedCode) 자동 생성

### 예상 파일
| 카테고리 | 파일 |
|---------|------|
| Schema | `schema.ts` (+webForms, +webFormFields) |
| Migration | `drizzle/XXXX_web_forms.sql` |
| API | `pages/api/web-forms/index.ts`, `[id].ts`, `[id]/fields.ts`, `submit.ts` |
| Hook | `hooks/useWebForms.ts` |
| UI | `components/web-forms/FormBuilder.tsx`, `FormFieldEditor.tsx`, `FormPreview.tsx`, `EmbedCodeDialog.tsx` |
| Page | `pages/web-forms.tsx` (관리), `pages/f/[slug].tsx` (공개) |
| Deps | `@dnd-kit/core`, `@dnd-kit/sortable` |

---

## Feature 3: 실시간 SSE 동기화

### 목적
레코드 CRUD 시 같은 파티션을 보고 있는 다른 사용자에게 실시간 반영.

### 범위
- **서버**: Next.js API route에서 SSE 엔드포인트 (`/api/sse`)
- **클라이언트 구독**: partition 단위 이벤트 수신
- **이벤트 타입**: record:created, record:updated, record:deleted, record:moved
- **연결 관리**: in-memory Map으로 클라이언트 관리, 30초 heartbeat
- **재연결**: 지수 백오프 (1s→2s→4s→8s→16s, max 5회)
- **SWR 연동**: SSE 이벤트 수신 시 해당 쿼리 키 mutate() 호출
- **Debounce**: 벌크 작업 시 500ms 디바운스

### Weldy 참고 구현
- `src/pages/api/sse.ts`: global Map<string, Set<Response>>, partition 기반 broadcast
- `src/hooks/useSSE.ts`: EventSource 래퍼, 재연결 로직, onMessage 콜백
- `src/lib/sse.ts`: `broadcastToPartition(partitionId, event, data)` 서버 유틸
- 레코드 API (create/update/delete)에서 broadcast 호출

### Sales 적응 사항
- 기존 records API (`pages/api/records/`)에 broadcast 호출 추가
- SWR의 mutate를 SSE 이벤트로 트리거 → 데이터 자동 갱신
- 현재 사용자 세션은 자기 자신의 이벤트 무시 (sessionId 기반)

### 예상 파일
| 카테고리 | 파일 |
|---------|------|
| API | `pages/api/sse.ts` |
| Lib | `lib/sse.ts` (broadcastToPartition) |
| Hook | `hooks/useSSE.ts` |
| 수정 | `pages/api/records/*.ts` (broadcast 호출 추가) |

---

## Feature 4: 배분/라운드로빈 할당

### 목적
레코드 생성 시 담당자를 자동으로 순번 배정. 파티션 단위 라운드로빈.

### 범위
- **DB**: partitions 테이블에 이미 존재하는 컬럼 활용
  - `useDistributionOrder`, `maxDistributionOrder`, `lastAssignedOrder`, `distributionDefaults`
- **원자적 할당**: PostgreSQL UPDATE + RETURNING으로 `(lastAssignedOrder % maxDistributionOrder) + 1` 계산
- **배분 기본값**: 순번별 기본 필드값 설정 (예: 순번1→담당자A, 순번2→담당자B)
- **설정 UI**: 파티션 설정에서 배분 활성화/비활성화, 순번 수, 기본값 매핑
- **통합코드 연동**: 이미 존재하는 `integratedCode` 시스템과 함께 동작

### Weldy 참고 구현
- `src/pages/api/records/index.ts` POST 핸들러에서 원자적 라운드로빈:
  ```sql
  UPDATE partitions
  SET last_assigned_order = (last_assigned_order % max_distribution_order) + 1
  WHERE id = ? AND use_distribution_order = 1
  RETURNING last_assigned_order
  ```
- distributionDefaults 적용: 순번에 매핑된 기본값을 record.data에 병합
- `src/components/partitions/DistributionSettings.tsx`: 순번 수 설정, 순번별 기본값 편집

### Sales 적응 사항
- Schema 컬럼은 이미 존재 (partitions 테이블 L146-L151)
- API 로직만 구현 필요: records POST에서 라운드로빈 + defaults 적용
- 파티션 설정 UI에 배분 설정 탭/섹션 추가
- 웹 폼 제출 시에도 동일 로직 적용

### 예상 파일
| 카테고리 | 파일 |
|---------|------|
| API 수정 | `pages/api/records/index.ts` (POST에 라운드로빈 로직) |
| Lib | `lib/distribution.ts` (원자적 할당 함수) |
| UI | `components/partitions/DistributionSettings.tsx` |
| 수정 | 파티션 설정 UI에 배분 설정 섹션 통합 |

---

## 구현 우선순위

| 순서 | Feature | 이유 |
|------|---------|------|
| 1 | 배분/라운드로빈 | Schema 이미 존재, 변경 최소, 즉시 실용성 |
| 2 | 실시간 SSE | 인프라 레벨, 이후 기능들(대시보드 자동갱신, 폼 제출 알림)에 활용 |
| 3 | 웹 폼 | 배분 로직 + SSE 활용, 리드 획득의 핵심 |
| 4 | 대시보드 | 가장 큰 규모, 외부 의존성(react-grid-layout, recharts) 필요, 데이터 축적 후 가치 극대화 |

## 의존성 추가
```
pnpm add react-grid-layout recharts @dnd-kit/core @dnd-kit/sortable
pnpm add -D @types/react-grid-layout
```

## 비기능 요구사항
- 모든 테이블/API는 orgId 기반 멀티테넌트 격리
- 공개 엔드포인트(웹 폼 제출, 대시보드 공유)는 rate limiting 고려
- SSE 연결 수 모니터링 (메모리 누수 방지)
- 대시보드 집계 쿼리 성능: 인덱스 활용, 필요 시 캐싱
