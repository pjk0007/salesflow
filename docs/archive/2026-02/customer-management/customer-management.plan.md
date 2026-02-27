# Plan: Customer Management (고객 관리)

> 작성일: 2026-02-12
> 상태: Draft
> 레벨: Dynamic

---

## 1. 개요 (Overview)

Sales Manager 애플리케이션에서 **고객(레코드) 데이터를 CRUD 방식으로 관리**하는 핵심 기능을 구현한다.
기존 DB 스키마의 `records` 테이블(JSONB 기반)과 `fieldDefinitions`(커스텀 필드)를 활용하여,
워크스페이스/파티션 단위로 고객 데이터를 조회, 등록, 수정, 삭제할 수 있는 UI와 API를 제공한다.

## 2. 배경 및 목적 (Background & Goals)

### 배경
- 현재 DB 스키마(organizations, workspaces, partitions, records, fieldDefinitions 등)는 정의되어 있으나 API/UI가 구현되지 않음
- 인증(login/signup/logout) 및 레이아웃(WorkspaceLayout) 기반 구조는 완료된 상태
- 실제 영업 데이터를 관리할 수 있는 고객 관리 기능이 필요

### 목적
- **고객 레코드 CRUD**: 워크스페이스/파티션 내 레코드 생성, 조회, 수정, 삭제
- **테이블 뷰 UI**: 스프레드시트 형태의 데이터 테이블로 레코드 관리
- **커스텀 필드 지원**: fieldDefinitions에 정의된 다양한 필드 타입 렌더링
- **검색 및 필터**: 키워드 검색, 필드 기반 필터링
- **페이지네이션**: 대량 데이터 처리를 위한 페이징

## 3. 사용자 스토리 (User Stories)

### US-01: 고객 목록 조회
- **As** 영업 담당자
- **I want** 파티션 내 고객 레코드를 테이블 형태로 조회하고 싶다
- **So that** 담당 고객의 현황을 한눈에 파악할 수 있다
- **Acceptance Criteria**:
  - 파티션 선택 시 해당 레코드 목록이 테이블로 표시됨
  - 필드 정의에 따른 컬럼 자동 생성
  - 페이지네이션 지원 (기본 50건)
  - 로딩 상태 표시

### US-02: 고객 등록
- **As** 영업 담당자
- **I want** 새 고객 레코드를 등록하고 싶다
- **So that** 신규 고객 정보를 시스템에 기록할 수 있다
- **Acceptance Criteria**:
  - 등록 다이얼로그에서 필드 정의에 따른 입력 폼 생성
  - 필수 필드 유효성 검사
  - 통합코드(integratedCode) 자동 생성
  - 분배순서(distributionOrder) 지원
  - 중복 체크 필드 기반 중복 경고

### US-03: 고객 정보 수정
- **As** 영업 담당자
- **I want** 기존 고객 레코드의 정보를 수정하고 싶다
- **So that** 변경된 고객 정보를 반영할 수 있다
- **Acceptance Criteria**:
  - 테이블 셀 인라인 편집 (editable 셀 타입)
  - 수정 시 자동 저장 (debounce 적용)
  - 수정 이력 표시 (updatedAt)

### US-04: 고객 삭제
- **As** 영업 관리자
- **I want** 불필요한 고객 레코드를 삭제하고 싶다
- **So that** 데이터를 정리할 수 있다
- **Acceptance Criteria**:
  - 단건/다건 선택 삭제 지원
  - 삭제 확인 다이얼로그
  - 삭제 시 연관 메모도 함께 삭제 (cascade)

### US-05: 고객 검색 및 필터
- **As** 영업 담당자
- **I want** 고객을 키워드로 검색하고 필드별 필터를 적용하고 싶다
- **So that** 원하는 고객을 빠르게 찾을 수 있다
- **Acceptance Criteria**:
  - 키워드 통합 검색 (이름, 전화번호 등)
  - 필드별 필터링 (select, date range 등)
  - 분배순서별 필터링
  - 필터 초기화

## 4. 기능 범위 (Scope)

### In-Scope (이번 구현 범위)

| 번호 | 기능 | 우선순위 | 설명 |
|------|------|----------|------|
| F-01 | 워크스페이스/파티션 목록 API | P0 | 사이드바에 표시할 워크스페이스, 폴더, 파티션 트리 |
| F-02 | 레코드 목록 조회 API | P0 | 파티션별 레코드 페이지네이션 조회 |
| F-03 | 레코드 생성 API | P0 | 새 레코드 생성 (통합코드 자동 발번) |
| F-04 | 레코드 수정 API | P0 | 레코드 데이터 부분 업데이트 |
| F-05 | 레코드 삭제 API | P0 | 단건/다건 레코드 삭제 |
| F-06 | 필드 정의 조회 API | P0 | 워크스페이스별 필드 정의 목록 |
| F-07 | 파티션 사이드바 UI | P0 | 폴더/파티션 트리 네비게이션 |
| F-08 | 레코드 테이블 UI | P0 | 데이터 테이블 뷰 (컬럼 자동 생성) |
| F-09 | 레코드 생성 다이얼로그 | P0 | 필드 기반 동적 입력 폼 |
| F-10 | 인라인 셀 편집 | P1 | 테이블 셀 직접 편집 |
| F-11 | 검색 및 필터 | P1 | 키워드 검색, 필드별 필터 |
| F-12 | 다건 선택 삭제 | P1 | 체크박스 다건 선택 후 일괄 삭제 |

### Out-of-Scope (이번 구현 제외)

| 기능 | 사유 |
|------|------|
| 메모 관리 | 별도 기능으로 분리 |
| 엑셀 가져오기/내보내기 | 차후 별도 기능 |
| 필드 정의 CRUD (설정) | 워크스페이스 설정 기능으로 분리 |
| 권한 관리 | 별도 기능으로 분리 |
| 알림톡/이메일 발송 | 별도 기능으로 분리 |

## 5. 기술 스택 및 아키텍처 (Technical Stack)

### 기존 스택 활용
- **Frontend**: Next.js 16 (Pages Router), React 19, ShadCN UI, Tailwind CSS 4, SWR
- **Backend**: Next.js API Routes, Drizzle ORM
- **Database**: PostgreSQL (records.data JSONB 기반)
- **인증**: JWT (SessionContext)

### API 구조
```
GET    /api/workspaces                    → 워크스페이스 목록
GET    /api/workspaces/[id]/partitions    → 파티션 목록 (폴더 포함)
GET    /api/workspaces/[id]/fields        → 필드 정의 목록
GET    /api/partitions/[id]/records       → 레코드 목록 (페이지네이션)
POST   /api/partitions/[id]/records       → 레코드 생성
PATCH  /api/records/[id]                  → 레코드 수정
DELETE /api/records/[id]                  → 레코드 삭제
DELETE /api/records/bulk                  → 레코드 일괄 삭제
```

### 페이지 구조
```
src/pages/
  index.tsx                  → 메인 (파티션 선택 + 레코드 테이블)
```

## 6. 구현 순서 (Implementation Order)

1. **Phase 1 - API 기반 구축** (P0)
   - 워크스페이스/파티션/필드 조회 API
   - 레코드 CRUD API
   - API 미들웨어 (인증 검증)

2. **Phase 2 - UI 기본 구현** (P0)
   - 파티션 사이드바 (폴더/파티션 트리)
   - 레코드 테이블 컴포넌트
   - 레코드 생성 다이얼로그

3. **Phase 3 - 인터랙션 강화** (P1)
   - 인라인 셀 편집
   - 검색 및 필터 바
   - 다건 선택 삭제

## 7. 리스크 및 의존성 (Risks & Dependencies)

### 리스크
| 리스크 | 영향도 | 대응방안 |
|--------|--------|----------|
| JSONB 기반 필드라 타입 안전성 부족 | 중 | Zod 스키마로 런타임 검증 |
| 대량 레코드 시 테이블 성능 | 중 | 서버사이드 페이지네이션 + 가상 스크롤 고려 |
| 커스텀 필드 타입별 렌더링 복잡성 | 중 | 셀 렌더러 팩토리 패턴 적용 |

### 의존성
- DB 스키마 (이미 정의됨) ✅
- 인증 시스템 (이미 구현됨) ✅
- ShadCN UI 컴포넌트 (이미 설치됨) ✅
- 워크스페이스/파티션 seed 데이터 필요 (db:seed)

## 8. 성공 기준 (Success Criteria)

- [ ] 워크스페이스/파티션 목록이 사이드바에 정상 표시
- [ ] 파티션 선택 시 레코드 목록이 테이블로 표시
- [ ] 새 레코드 등록 후 목록에 즉시 반영
- [ ] 셀 인라인 편집 후 자동 저장
- [ ] 키워드 검색으로 레코드 필터링 가능
- [ ] 다건 선택 삭제 정상 동작
- [ ] 모든 API에 인증 검증 적용
