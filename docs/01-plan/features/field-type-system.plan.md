# Plan: 속성 타입 시스템 (Field Type System)

## 1. 개요

현재 속성(필드)은 워크스페이스 단위로 관리됩니다. 동일한 속성 세트를 여러 워크스페이스/파티션에서 재사용할 방법이 없고, 워크스페이스 설정의 "워크스페이스 관리"와 "속성 관리"가 사실상 같은 대상을 다루고 있어 혼란을 줍니다.

**"속성 타입"**이라는 개념을 도입하여 속성 세트를 독립적으로 정의하고, 이를 워크스페이스/파티션에 부여하는 구조로 변경합니다.

## 2. 현재 구조 (AS-IS)

```
Organization
  └── Workspace (워크스페이스)
        ├── FieldDefinitions[] (속성들 - 워크스페이스에 직접 귀속)
        └── Partitions[] (파티션들)
              └── visibleFields: string[] (보여줄 필드 key 목록)
```

### 현재 데이터 현황

| 워크스페이스 | 파티션 수 | 속성 수 | 비고 |
|-------------|----------|---------|------|
| 테스트 DB | 2 | 10 | 마켓, 업체명, 전화번호, 대표자명, 사업자번호... |
| WEDLY | 0 | 9 | 회사명, 담당자명, 직책, 전화번호, 이메일... |
| 마케팅email | 5 | 9 | WEDLY와 동일한 속성 구조 |
| 영업관리 | 4 | 9 | WEDLY, 마케팅email과 동일한 속성 구조 |
| 디하 회원관리 | 1 | 15 | 가입일, 회사명, 매칭단계, 플랜... (고유 구조) |

**문제점:**
- WEDLY, 마케팅email, 영업관리가 **동일한 9개 속성**을 각각 별도로 관리 중
- 속성 변경 시 각 워크스페이스를 개별로 수정해야 함
- 파티션별로 다른 속성 세트를 적용할 수 없음

## 3. 목표 구조 (TO-BE)

```
Organization
  └── FieldTypes[] (속성 타입 - 조직 단위로 관리)
        └── FieldDefinitions[] (속성들 - 타입에 귀속)

  └── Workspace (워크스페이스)
        ├── defaultFieldTypeId (기본 속성 타입)
        └── Partitions[] (파티션들)
              ├── fieldTypeId (개별 속성 타입 - nullable)
              │     → null이면 워크스페이스의 defaultFieldTypeId 사용
              └── visibleFields: string[] (보여줄 필드 key 목록)
```

### 속성 타입 결정 우선순위

```
파티션의 fieldTypeId가 있으면 → 해당 타입 사용
파티션의 fieldTypeId가 null이면 → 워크스페이스의 defaultFieldTypeId 사용
```

## 4. 요구사항

### FR-01: field_types 테이블 생성

새로운 `field_types` 테이블을 만들어 속성 타입을 관리합니다.

```
field_types
├── id: serial (PK)
├── orgId: uuid (FK → organizations)
├── name: varchar(100) - 타입 이름 (예: "기업 CRM", "스토어 관리")
├── description: text - 타입 설명
├── icon: varchar(50) - 아이콘
├── createdAt: timestamptz
├── updatedAt: timestamptz
└── UNIQUE(orgId, name)
```

### FR-02: field_definitions 소속 변경

`field_definitions.workspaceId` → `field_definitions.fieldTypeId`로 변경합니다.

**현재:**
```
field_definitions.workspaceId → workspaces.id
```

**변경 후:**
```
field_definitions.fieldTypeId → field_types.id
```

- 기존 `workspaceId` 컬럼은 유지하되 nullable로 변경 (마이그레이션 중 호환)
- 새로운 `fieldTypeId` 컬럼 추가
- unique 제약도 `(workspaceId, key)` → `(fieldTypeId, key)` 로 변경

### FR-03: workspaces에 defaultFieldTypeId 추가

```
workspaces
├── ... (기존 컬럼)
└── defaultFieldTypeId: integer (FK → field_types.id) - nullable
```

- 워크스페이스 생성/수정 시 기본 속성 타입 선택
- 기존 워크스페이스는 마이그레이션으로 자동 타입 생성 후 연결

### FR-04: partitions에 fieldTypeId 추가

```
partitions
├── ... (기존 컬럼)
└── fieldTypeId: integer (FK → field_types.id) - nullable
```

- null이면 워크스페이스의 `defaultFieldTypeId`를 따라감
- 값이 있으면 해당 타입의 속성 사용

### FR-05: 속성 조회 로직 변경

현재 `GET /api/workspaces/[id]/fields`로 워크스페이스 단위 조회하는 것을:

1. `GET /api/field-types/[id]/fields` - 타입 단위 조회 (신규)
2. `GET /api/partitions/[id]/resolved-fields` - 파티션에 적용된 실제 필드 조회 (신규)
   - 파티션의 fieldTypeId 확인 → null이면 워크스페이스의 defaultFieldTypeId → 해당 타입의 필드 반환

기존 API는 호환성을 위해 유지하되, 내부적으로 타입 기반으로 리다이렉트.

### FR-06: 데이터 마이그레이션

기존 데이터를 새 구조로 마이그레이션합니다.

**Step 1: 동일 구조 타입 통합**
- WEDLY, 마케팅email, 영업관리 → 동일한 9개 속성 → **"영업 기본"** 타입으로 통합
- 테스트 DB → **"스토어 DB"** 타입 생성
- 디하 회원관리 → **"디하 CRM"** 타입 생성

**Step 2: field_definitions 마이그레이션**
- 동일 구조의 워크스페이스 속성은 하나의 타입으로 통합 (중복 제거)
- 각 field_definition의 `fieldTypeId`를 해당 타입 ID로 설정

**Step 3: 워크스페이스 연결**
- 각 워크스페이스의 `defaultFieldTypeId`를 해당 타입으로 설정

**Step 4: 기존 field_definitions 정리**
- 통합된 중복 속성 행 삭제
- `workspaceId` 컬럼 제거 (또는 deprecated 표시)

### FR-07: UI 변경 - 속성 타입 관리 페이지

**설정 페이지 탭 구조 변경:**

현재:
```
워크스페이스 관리 | 속성 관리 | 자동화
```

변경:
```
워크스페이스 관리 | 속성 타입 관리 | 자동화
```

**속성 타입 관리 탭:**
- 타입 목록 (카드 형태)
- 타입 생성/수정/삭제
- 타입 내 속성 관리 (기존 FieldManagementTab의 속성 테이블 + DnD 순서 변경)

### FR-08: UI 변경 - 워크스페이스 설정

워크스페이스 관리에서:
- 기본 속성 타입 선택 드롭다운 추가
- 워크스페이스 생성 시 타입 선택 필수

### FR-09: UI 변경 - 파티션 설정

파티션 생성/수정 시:
- 속성 타입 선택 (선택사항)
- "워크스페이스 기본 타입 사용" 옵션 (기본값)
- 또는 특정 타입 선택

### FR-10: 레코드 테이블 필드 조회 변경

`RecordTable`과 관련 컴포넌트에서:
- `useFields(workspaceId)` → 파티션의 resolved fieldTypeId 기반으로 변경
- 파티션 전환 시 해당 파티션의 타입에 맞는 필드로 동적 전환

## 5. 영향 범위

### DB 변경
| 테이블 | 변경 |
|--------|------|
| `field_types` (신규) | 조직별 속성 타입 관리 |
| `field_definitions` | `fieldTypeId` 추가, `workspaceId` deprecated |
| `workspaces` | `defaultFieldTypeId` 추가 |
| `partitions` | `fieldTypeId` 추가 |

### API 변경
| API | 변경 |
|-----|------|
| `GET /api/field-types` (신규) | 타입 목록 조회 |
| `POST /api/field-types` (신규) | 타입 생성 |
| `PATCH /api/field-types/[id]` (신규) | 타입 수정 |
| `DELETE /api/field-types/[id]` (신규) | 타입 삭제 |
| `GET /api/field-types/[id]/fields` (신규) | 타입의 필드 목록 |
| `GET /api/workspaces/[id]/fields` | 내부적으로 타입 기반 리다이렉트 |
| `POST /api/workspaces` | `defaultFieldTypeId` 포함 |
| `POST /api/workspaces/[id]/partitions` | `fieldTypeId` 포함 |

### UI 변경
| 컴포넌트 | 변경 |
|----------|------|
| 설정 페이지 탭 구조 | "속성 관리" → "속성 타입 관리" |
| `FieldManagementTab` | 타입 단위로 속성 관리 |
| `WorkspaceSettingsTab` | 기본 타입 선택 추가 |
| 파티션 생성/수정 다이얼로그 | 타입 선택 옵션 |
| `useFields` 훅 | 타입 기반 필드 조회 |
| `RecordTable` | 파티션별 resolved 필드 사용 |

### 외부 API 영향
| API | 영향 |
|-----|------|
| `POST /api/v1/records` | 필드 유효성 검증 로직 변경 필요 |
| `PUT /api/v1/records/[id]` | 영향 없음 (data JSONB 구조 동일) |
| 알림톡/이메일 자동화 | 필드 조회 경로만 변경 |

## 6. 마이그레이션 전략

### Phase 1: 하위 호환 유지하며 신규 테이블 추가
- `field_types` 테이블 생성
- `field_definitions`에 `fieldTypeId` 컬럼 추가 (nullable)
- `workspaces`에 `defaultFieldTypeId` 컬럼 추가 (nullable)
- `partitions`에 `fieldTypeId` 컬럼 추가 (nullable)
- 기존 코드는 그대로 동작

### Phase 2: 데이터 마이그레이션 스크립트 실행
- 워크스페이스별 속성을 분석하여 타입 자동 생성
- 동일 구조 감지 및 통합
- `fieldTypeId` 채우기
- `defaultFieldTypeId` 채우기

### Phase 3: 코드 전환
- API/UI를 타입 기반으로 전환
- `workspaceId` 기반 조회를 `fieldTypeId` 기반으로 변경

### Phase 4: 정리
- `field_definitions.workspaceId` 컬럼 제거
- 중복 속성 행 정리

## 7. 리스크 및 고려사항

### 데이터 무결성
- 마이그레이션 중 기존 레코드의 data JSONB는 변경 없음 (키 유지)
- 타입 통합 시 동일한 key를 가진 속성만 통합 가능
- 통합 후 원본 속성 삭제 전 충분한 검증 필요

### 하위 호환성
- 외부 API(`/api/v1/records`)는 partitionId 기반이라 영향 최소
- 디하 서버의 Sendb 연동 코드는 변경 불필요 (recordId 기반 업데이트)
- 기존 알림톡/이메일 연결(template_links)은 파티션 단위라 영향 없음

### 타입 공유 시 주의사항
- 타입의 속성을 수정하면 해당 타입을 사용하는 모든 워크스페이스/파티션에 영향
- UI에서 "이 타입을 사용하는 워크스페이스/파티션 N개" 경고 표시 필요
- 타입 삭제 시 사용 중인 곳이 있으면 삭제 불가

## 8. 구현 순서 (예상)

1. DB 스키마 변경 (Phase 1)
2. 마이그레이션 스크립트 작성 및 실행 (Phase 2)
3. 타입 CRUD API 구현
4. 타입 관리 UI 구현
5. useFields 훅 변경
6. 워크스페이스/파티션 설정 UI 변경
7. 레코드 테이블 필드 조회 변경
8. 기존 코드 정리 (Phase 4)
