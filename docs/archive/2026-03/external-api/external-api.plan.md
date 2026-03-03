# Plan: external-api

## 요약
외부 REST API를 통해 레코드 CRUD를 제공하고, API 토큰 관리 페이지에서 토큰별 세분화된 권한(워크스페이스/폴더/파티션 범위 + 조회/생성/편집·삭제 작업)을 설정할 수 있게 한다.

## 현재 상태
- `apiTokens` 테이블: 이미 존재 (schema.ts L287-301) — orgId, name, token, createdBy, lastUsedAt, expiresAt, isActive
- `verifyApiToken()`, `authenticateRequest()`: auth.ts에 구현됨
- **문제**: 현재 토큰에 권한(scope) 개념 없음, 관리 UI 없음, 외부 API 엔드포인트 없음
- 레코드 CRUD: `src/app/api/partitions/[id]/records/route.ts` + `src/app/api/records/[id]/route.ts`에 JWT 기반으로 존재

## 변경 사항

### 1. DB 스키마 — 토큰 권한 테이블
기존 `apiTokens`에 권한 컬럼을 추가하거나 별도 테이블 생성. **별도 테이블** 방식 선택 (N:M 관계, 유연성):

```
apiTokenScopes 테이블:
- id (serial PK)
- tokenId (FK → apiTokens.id, cascade)
- scopeType: "workspace" | "folder" | "partition"
- scopeId: number (워크스페이스/폴더/파티션 ID)
- permissions: jsonb — { read: bool, create: bool, update: bool, delete: bool }
```

- 토큰 1개에 여러 scope 가능 (예: 파티션 A 읽기전용 + 파티션 B 전체권한)
- scopeType이 "workspace"면 해당 워크스페이스 전체, "folder"면 폴더 하위 전체, "partition"면 해당 파티션만

### 2. API 토큰 관리 API
`/api/api-tokens` — 토큰 CRUD (JWT 인증, owner/admin만)
- **GET** `/api/api-tokens` — 목록 조회 (orgId 기반)
- **POST** `/api/api-tokens` — 토큰 생성 (name, scopes, expiresAt)
  - `crypto.randomBytes(32).toString('hex')` 로 토큰 생성
  - 생성 시에만 평문 토큰 반환 (이후 재조회 불가 — 앞 8자만 표시)
- **PUT** `/api/api-tokens/[id]` — 수정 (name, scopes, isActive)
- **DELETE** `/api/api-tokens/[id]` — 삭제

### 3. 외부 REST API — `/api/v1/records`
Bearer 토큰 인증, 토큰 scope에 따라 접근 제어:

| Method | Endpoint | 설명 | 필요 권한 |
|--------|----------|------|-----------|
| GET | `/api/v1/records?partitionId=N` | 레코드 목록 조회 | read |
| GET | `/api/v1/records/[id]` | 레코드 상세 조회 | read |
| POST | `/api/v1/records` | 레코드 생성 | create |
| PUT | `/api/v1/records/[id]` | 레코드 수정 | update |
| DELETE | `/api/v1/records/[id]` | 레코드 삭제 | delete |

**인증 흐름**:
1. `Authorization: Bearer <token>` 헤더에서 토큰 추출
2. `apiTokens` 테이블에서 토큰 검증 (isActive, expiresAt)
3. `apiTokenScopes`에서 해당 토큰의 권한 조회
4. 요청 대상 파티션이 scope에 포함되는지 + 해당 작업 권한 있는지 확인

**Scope 확인 로직**:
- partition scope: partitionId 직접 매칭
- folder scope: 해당 폴더에 속한 파티션인지 확인
- workspace scope: 해당 워크스페이스에 속한 파티션인지 확인

### 4. API 토큰 관리 UI — 조직 설정 탭 추가
`/settings/organization?tab=api-tokens`

- 토큰 목록: 이름, 토큰 앞 8자, 생성일, 마지막 사용, 만료일, 활성 상태
- 토큰 생성 다이얼로그:
  - 토큰 이름 입력
  - 만료일 선택 (없음/30일/90일/1년)
  - 권한 범위 설정: 워크스페이스/폴더/파티션 트리에서 체크박스 선택
  - 선택한 항목별 권한 설정: 조회/생성/편집/삭제 체크박스
- 토큰 생성 후: 평문 토큰 1회 표시 (복사 버튼 포함, 다시 볼 수 없음 경고)
- 토큰 수정: 이름, 권한 변경, 활성/비활성 토글
- 토큰 삭제: 확인 다이얼로그

### 5. auth.ts 수정
- `verifyApiToken()` → 토큰 검증 시 scopes도 함께 반환
- 새 함수: `verifyApiTokenAccess(token, partitionId, permission)` — 특정 파티션+권한 확인
- App Router 호환: `getApiTokenFromNextRequest(req: NextRequest)` 추가

## 파일 변경 목록

| # | 파일 | 작업 |
|---|------|------|
| 1 | `src/lib/db/schema.ts` | `apiTokenScopes` 테이블 추가 |
| 2 | `drizzle/0014_api_token_scopes.sql` | 마이그레이션 |
| 3 | `src/lib/auth.ts` | 토큰 권한 검증 함수 추가/수정 |
| 4 | `src/app/api/api-tokens/route.ts` | 토큰 CRUD API (GET, POST) |
| 5 | `src/app/api/api-tokens/[id]/route.ts` | 토큰 CRUD API (PUT, DELETE) |
| 6 | `src/app/api/v1/records/route.ts` | 외부 레코드 조회/생성 API |
| 7 | `src/app/api/v1/records/[id]/route.ts` | 외부 레코드 상세/수정/삭제 API |
| 8 | `src/hooks/useApiTokens.ts` | SWR 훅 |
| 9 | `src/components/settings/ApiTokensTab.tsx` | 토큰 관리 UI |
| 10 | `src/components/settings/ApiTokenCreateDialog.tsx` | 토큰 생성 다이얼로그 |
| 11 | `src/app/settings/organization/page.tsx` | 탭 추가 |

## 구현 순서

| # | 작업 | 검증 |
|---|------|------|
| 1 | schema.ts + migration | drizzle-kit push |
| 2 | auth.ts 토큰 권한 검증 | 타입 에러 없음 |
| 3 | `/api/api-tokens` CRUD API | 타입 에러 없음 |
| 4 | `/api/v1/records` 외부 API | 타입 에러 없음 |
| 5 | useApiTokens 훅 | — |
| 6 | ApiTokensTab + ApiTokenCreateDialog | — |
| 7 | settings/organization 탭 추가 | — |
| 8 | `pnpm build` 통과 | 빌드 성공 |

## 검증
- `pnpm build` 성공
- 토큰 생성 → 외부 API로 레코드 CRUD 가능
- scope 범위 밖 파티션 접근 시 403 반환
- 권한 없는 작업(예: read-only 토큰으로 POST) 시 403 반환
- 토큰 비활성화 시 401 반환
