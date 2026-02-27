# Plan: field-templates — 속성 템플릿

## 1. 개요

### 배경
현재 새 워크스페이스를 만들면 속성(필드)이 비어있어 사용자가 하나하나 수동으로 추가해야 한다.
세일즈 업무에 필요한 필드(회사명, 담당자, 전화번호, 이메일, 상태, 금액 등)를 매번 직접 설정하는 것은 번거롭다.

### 기존 인프라
- **fieldDefinitions 테이블**: key, label, fieldType, category, sortOrder, isRequired, isSystem, options(JSONB)
- **지원 fieldType**: text, number, date, datetime, select, phone, textarea, checkbox, file, currency, formula, user_select, email
- **필드 생성 API**: `POST /api/workspaces/:id/fields` — key, label, fieldType, category, isRequired, options
- **파티션 생성 시**: 해당 워크스페이스의 모든 필드 key를 visibleFields로 자동 설정
- **useFieldManagement 훅**: createField, updateField, deleteField, reorderFields

### 목표
1. 세일즈 업무에 맞는 **사전 정의 템플릿** 제공 (B2B 영업, B2C 영업, 부동산, 인력 관리 등)
2. 워크스페이스 생성 시 또는 설정 페이지에서 **템플릿 선택 → 속성 일괄 생성**
3. 기존 속성이 있는 워크스페이스에도 템플릿 적용 가능 (병합/덮어쓰기 선택)

### 범위
- 클라이언트 사이드 템플릿 정의 (JSON 상수) — DB 저장 불필요
- 템플릿 선택 UI (다이얼로그)
- 기존 필드 생성 API를 순차 호출하여 일괄 생성 (새 API 최소화)
- 워크스페이스 생성 직후 + 설정 페이지 속성 관리 탭에서 접근

### 범위 제외
- 사용자 커스텀 템플릿 저장/관리 (향후 확장)
- 템플릿 공유 기능
- 기존 속성 자동 백업/롤백
- 템플릿별 레코드 데이터 마이그레이션

## 2. 기능 요구사항

### FR-01: 템플릿 정의 (클라이언트 상수)
- 사전 정의 템플릿 4종:
  - **B2B 영업**: 회사명, 담당자명, 직책, 전화번호, 이메일, 회사주소, 영업단계(select), 예상금액(currency), 메모(textarea)
  - **B2C 영업**: 고객명, 전화번호, 이메일, 주소, 관심상품, 상태(select), 메모(textarea)
  - **부동산**: 고객명, 전화번호, 이메일, 관심지역, 예산(currency), 매물유형(select), 계약상태(select), 메모(textarea)
  - **인력 관리**: 이름, 전화번호, 이메일, 소속, 직급, 입사일(date), 상태(select), 메모(textarea)
- 각 템플릿은 `{ id, name, description, icon, fields: Array<{ key, label, fieldType, category?, isRequired?, options? }> }` 구조
- 템플릿에 정의된 속성은 isSystem=0 (사용자가 수정/삭제 가능)

### FR-02: 템플릿 선택 UI (TemplatePickerDialog)
- 다이얼로그 형태 — 4개 템플릿 카드 그리드
- 각 카드: 아이콘 + 이름 + 설명 + 포함 속성 미리보기 (속성명 리스트)
- 카드 선택 시 하이라이트 → "적용" 버튼 클릭
- "직접 설정" 옵션: 템플릿 없이 빈 상태로 시작

### FR-03: 속성 일괄 생성 API
- `POST /api/workspaces/:id/fields/bulk` (신규)
- body: `{ fields: Array<{ key, label, fieldType, category?, isRequired?, options? }> }`
- 트랜잭션 내에서 순차 생성 (sortOrder 자동 할당)
- 중복 key가 이미 존재하면 해당 필드는 skip
- 파티션 visibleFields 동기화 포함
- 응답: `{ success, data: { created: number, skipped: number, total: number } }`

### FR-04: 워크스페이스 생성 시 템플릿 선택
- 워크스페이스 생성 다이얼로그에 "템플릿" 단계 추가
- 워크스페이스 이름 입력 → 템플릿 선택(선택사항) → 생성
- 템플릿 선택 시 워크스페이스 생성 직후 bulk 필드 생성 호출

### FR-05: 설정 페이지에서 템플릿 적용
- FieldManagementTab에 "템플릿으로 시작" 버튼 추가
- 기존 속성이 있는 경우: 중복 key는 skip, 새 속성만 추가 (병합)
- 적용 후 결과 표시: "N개 속성이 추가되었습니다. M개는 이미 존재하여 건너뛰었습니다."

## 3. 기술 설계 방향

### 템플릿 데이터
- `src/lib/field-templates.ts`에 상수로 정의
- DB 저장 불필요 — 코드 배포로 관리
- 향후 사용자 커스텀 템플릿은 별도 테이블로 확장 가능

### Bulk 생성 API
- 기존 단건 생성 로직(cellType 매핑, sortOrder 할당, visibleFields 동기화)을 재사용
- 트랜잭션으로 감싸 원자성 보장
- 중복 key 감지: DB에서 기존 key 목록 조회 후 필터

### UI 흐름
```
[워크스페이스 생성] → [이름 입력] → [템플릿 선택 (선택사항)] → [생성 + bulk 필드 생성]
[설정 > 속성 관리] → [템플릿으로 시작 버튼] → [TemplatePickerDialog] → [bulk 필드 생성] → [테이블 갱신]
```

## 4. 변경 파일 목록

| # | 파일 | 변경 유형 | 설명 |
|---|------|-----------|------|
| 1 | `src/lib/field-templates.ts` | 신규 | 4종 템플릿 상수 정의 |
| 2 | `src/pages/api/workspaces/[id]/fields/bulk.ts` | 신규 | Bulk 필드 생성 API |
| 3 | `src/components/settings/TemplatePickerDialog.tsx` | 신규 | 템플릿 선택 다이얼로그 |
| 4 | `src/hooks/useFieldManagement.ts` | 수정 | applyTemplate 함수 추가 |
| 5 | `src/components/settings/FieldManagementTab.tsx` | 수정 | "템플릿으로 시작" 버튼 추가 |
| 6 | `src/components/settings/CreateWorkspaceDialog.tsx` | 수정 | 템플릿 선택 단계 추가 |

## 5. 의존성
- 신규 패키지 없음
- DB 스키마 변경 없음 (기존 fieldDefinitions 테이블 그대로 활용)

## 6. 검증 기준
- `npx next build` 성공
- 워크스페이스 생성 시 템플릿 선택 → 속성 일괄 생성 확인
- 설정 > 속성 관리에서 "템플릿으로 시작" → 속성 추가 확인
- 기존 속성이 있는 워크스페이스에 템플릿 적용 시 중복 skip 확인
- 빈 워크스페이스에서 각 4종 템플릿 적용 후 속성 개수 확인
- 일괄 생성 후 파티션 visibleFields에 새 필드 포함 확인
