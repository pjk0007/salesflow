# Plan: codebase-refactor (전체 프로젝트 리펙토링)

## 현황 분석

| 항목 | 값 |
|------|-----|
| 총 파일 수 | 352 (.ts/.tsx) |
| 총 LOC | 45,807 |
| 200줄 이상 파일 | 40개 |
| 최대 파일 | ai.ts (1,095 LOC) |
| 타입 안전성 | any 없음 (양호) |

## 핵심 문제 3가지

### 1. 코드 중복 (Critical)

**SWR fetcher 중복** — 45개 이상의 hook에서 동일한 fetcher 함수 반복 정의
```typescript
const fetcher = (url: string) => fetch(url).then((r) => r.json());
```

**API 에러 핸들링 중복** — 250개 이상의 API route에서 동일한 인증/에러 패턴 반복
```typescript
const user = getUserFromNextRequest(req);
if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
// ... try/catch ...
```

**자동화 로직 중복** — 쿨다운 체크, 변수 매핑이 alimtalk-automation.ts / email-automation.ts에서 반복

### 2. 대형 파일 분리 필요

| 파일 | LOC | 문제 |
|------|-----|------|
| `src/lib/ai.ts` | 1,095 | 이메일/알림톡/상품/위젯/검색/쿼터 모두 한 파일 |
| `src/app/dashboards/page.tsx` | 612 | CRUD + 위젯설정 + AI생성 + 그리드 |
| `src/components/email/EmailConfigForm.tsx` | 510 | API설정 + 발신자 + 서명 3개 Dialog |
| `src/components/email/AutoPersonalizedEmailConfig.tsx` | 500 | 규칙 CRUD + 폼 |
| `src/components/records/ImportDialog.tsx` | 445 | 3단계 import wizard |
| `src/app/records/page.tsx` | 430 | 8개 이상 dialog state |

### 3. 패턴 비일관성

- Hook 반환값 구조가 제각각 (data/total/page 등)
- 컴포넌트 파일명 PascalCase / kebab-case 혼재
- 메모이제이션 사용률 29% (useMemo/React.memo)

## 리펙토링 범위 (3단계)

### Phase 1: 공통 유틸리티 추출 (중복 제거)

| # | 작업 | 신규 파일 | 영향 범위 |
|---|------|-----------|-----------|
| 1 | SWR fetcher 통합 | `src/lib/swr-fetcher.ts` | 45+ hooks |
| 2 | API handler wrapper | `src/lib/api-handler.ts` | 모든 API routes |
| 3 | 자동화 공통 로직 추출 | `src/lib/automation-shared.ts` | 2 automation files |
| 4 | 변수 매핑 공통화 | `src/lib/variable-mapper.ts` | 3 files |

### Phase 2: 대형 파일 분리

| # | 작업 | 대상 | 분리 결과 |
|---|------|------|-----------|
| 5 | ai.ts 분리 | `src/lib/ai.ts` (1,095) | ai/email.ts, ai/alimtalk.ts, ai/product.ts, ai/widget.ts, ai/search.ts, ai/quota.ts |
| 6 | dashboards 분리 | `src/app/dashboards/page.tsx` (612) | DashboardSelector, DashboardEditor, WidgetManager |
| 7 | EmailConfigForm 분리 | EmailConfigForm.tsx (510) | SenderProfileManager, SignatureManager, ConfigSection |
| 8 | ImportDialog 분리 | ImportDialog.tsx (445) | Step1/Step2/Step3 컴포넌트 |

### Phase 3: 품질 개선

| # | 작업 | 설명 |
|---|------|------|
| 9 | Dialog 상태 관리 훅 | `useDialogManager()` — 멀티 dialog 컴포넌트용 |
| 10 | deprecated 코드 정리 | ai.ts SearchClient alias 등 |
| 11 | 메모이제이션 추가 | 테이블 row, 비싼 계산에 useMemo/React.memo |

## 범위 밖 (이번에 안 함)

- DB 스키마 변경 (마이그레이션 리스크)
- UI/UX 변경 (기능 동일 유지)
- 새 기능 추가
- 테스트 코드 작성
- 가상화(react-virtual) 도입

## 우선순위

**Phase 1 → Phase 2 → Phase 3** 순서로 진행.
Phase 1이 가장 영향 범위가 넓고, Phase 2는 가독성/유지보수성, Phase 3은 품질 개선.

## 검증

- 각 단계 후 `npx next build` 성공 확인
- 기존 기능 동작 변경 없음 (리펙토링만)
- git diff로 변경 범위 확인

## 예상 변경량

- 신규 파일: ~10개
- 수정 파일: ~60개 (주로 import 변경)
- 삭제 파일: 0개 (기존 파일은 분리만)
- 순수 LOC 변경: 약 -500 (중복 제거분)
