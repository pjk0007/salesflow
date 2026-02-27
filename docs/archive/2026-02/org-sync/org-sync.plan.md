# Plan: org-sync

> 애디온으로부터 조직정보를 받아와서 애디온처럼 보여주기

## 1. 개요

### 1.1 목적
Sales 프로젝트의 조직 설정 페이지를 Adion 프로젝트 수준으로 업그레이드한다.
현재 Sales의 OrgSettingsTab은 기본적인 조직 정보(이름, 회사명, 브랜드 컬러 등)만 표시하지만,
Adion처럼 조직 일반정보 + 팀 멤버 관리를 체계적으로 보여준다.

### 1.2 사용자 요청
"애디온으로부터 조직정보를 받아와서 애디온처럼 보여주면 좋겠다"

### 1.3 범위 결정

**포함 (In Scope)**:
- 조직 설정 탭 UI를 Adion 스타일로 리뉴얼 (OrgGeneralTab + OrgTeamTab 분리)
- OrgGeneralTab: 조직명, slug, 플랜 배지, 위험 영역(소유권 이전, 조직 삭제)
- OrgTeamTab: 멤버 목록, 역할 관리, 초대 시스템
- 관련 API 엔드포인트 추가/수정

**제외 (Out of Scope)**:
- 멀티 조직 지원 / OrganizationSwitcher (현재 Sales는 단일 조직 구조, 추후 별도 PDCA)
- 결제/플랜 시스템 (Adion의 planId, billingEmail 등)
- 소유권 이전 기능 (복잡도 높음, 추후 별도)

## 2. 현재 상태 분석

### 2.1 Adion 조직 구조
| 항목 | 내용 |
|------|------|
| DB 테이블 | organizations: id, name, slug, planId, billingEmail, isActive, settings(jsonb) |
| 멤버 테이블 | organizationMembers: orgId, userId, role(owner/admin/member/viewer) |
| 초대 테이블 | organizationInvitations: orgId, email, role, token, expiresAt, status |
| API | 6개 엔드포인트 (CRUD + switch + invite) |
| UI - 일반 | OrgGeneralTab: 조직명, slug, 플랜 배지, 위험 영역 |
| UI - 팀 | OrgTeamTab: 멤버 테이블, 역할 변경 드롭다운, 초대 다이얼로그 |
| RBAC | viewer(1) → member(2) → admin(3) → owner(4) |

### 2.2 Sales 현재 구조
| 항목 | 내용 |
|------|------|
| DB 테이블 | organizations: id, name, slug, branding(jsonb), integratedCodePrefix, integratedCodeSeq, settings(jsonb) |
| 멤버 테이블 | users: orgId, role(owner/admin/member) |
| API | GET/PATCH /api/org/settings (owner만 수정) |
| UI | OrgSettingsTab: 이름, 회사명, 브랜드컬러, 통합코드, 시간대, 로케일, 날짜형식 |
| RBAC | member → admin → owner (3단계) |
| 세션 | JWT에 orgId, role 포함, SessionContext로 제공 |

### 2.3 핵심 차이점
1. **UI 구조**: Adion은 OrgGeneralTab + OrgTeamTab 분리 / Sales는 단일 OrgSettingsTab
2. **멤버 관리**: Adion은 초대 시스템 + 역할 변경 UI / Sales는 UsersTab에 기본 목록만
3. **조직 정보**: Adion은 slug, 플랜 배지 표시 / Sales는 branding 중심
4. **RBAC**: Adion 4단계 / Sales 3단계 (viewer 없음)

## 3. 구현 계획

### 3.1 작업 목록

#### Task 1: OrgGeneralTab 리뉴얼
- **현재**: OrgSettingsTab에 모든 설정이 한 곳에
- **변경**: Adion 스타일의 OrgGeneralTab으로 교체
  - 조직명 + slug 표시/편집
  - Sales 고유 설정 유지: branding, integratedCodePrefix, timezone, locale, dateFormat
  - 위험 영역 섹션: 조직 삭제 (소유권 이전은 제외)
- **파일**: `src/components/settings/OrgSettingsTab.tsx` → `OrgGeneralTab.tsx`

#### Task 2: OrgTeamTab 신규 생성
- **현재**: 설정 페이지에 UsersTab이 이미 존재
- **변경**: Adion 스타일의 OrgTeamTab으로 리뉴얼
  - 멤버 목록 테이블 (이름, 이메일, 역할, 가입일)
  - 역할 변경 드롭다운 (admin만 가능)
  - 멤버 초대 다이얼로그 (이메일 + 역할 선택)
  - 멤버 제거 기능
- **파일**: `src/components/settings/OrgTeamTab.tsx` (신규)

#### Task 3: 초대 시스템 API
- **신규 API**:
  - `POST /api/org/invitations` — 초대 생성 (admin+)
  - `GET /api/org/invitations` — 초대 목록 조회
  - `DELETE /api/org/invitations/[id]` — 초대 취소
  - `POST /api/org/invitations/accept` — 초대 수락 (토큰 기반)
- **DB 변경**: `organization_invitations` 테이블 추가
  - orgId, email, role, token, expiresAt, status(pending/accepted/expired), invitedBy, createdAt

#### Task 4: 멤버 관리 API
- **신규/수정 API**:
  - `GET /api/org/members` — 멤버 목록 (역할 포함)
  - `PATCH /api/org/members/[id]` — 역할 변경 (admin+)
  - `DELETE /api/org/members/[id]` — 멤버 제거 (admin+, 자신은 불가)
- **기존 API 유지**: `/api/users` (워크스페이스 수준 사용자 관리)

#### Task 5: settings.tsx 탭 구조 변경
- **현재 탭**: 워크스페이스 | 조직 | 사용자 | 속성 관리
- **변경 탭**: 워크스페이스 | 조직 일반 | 조직 팀 | 속성 관리
  - "조직" → "조직 일반" (OrgGeneralTab)
  - "사용자" → "조직 팀" (OrgTeamTab)
  - 또는: 조직 탭 내부에서 서브탭으로 일반/팀 구분 (Adion 방식)

#### Task 6: SWR 훅 추가
- `useOrgMembers()` — 멤버 목록 + 역할 변경/제거 mutation
- `useOrgInvitations()` — 초대 목록 + 생성/취소 mutation

### 3.2 구현 순서
```
Task 3 (초대 DB/API) → Task 4 (멤버 API) → Task 6 (SWR 훅)
  → Task 1 (OrgGeneralTab) → Task 2 (OrgTeamTab) → Task 5 (탭 구조)
```

### 3.3 예상 변경 파일
| 파일 | 변경 유형 |
|------|-----------|
| `src/lib/db/schema.ts` | 수정 — organizationInvitations 테이블 추가 |
| `src/pages/api/org/members.ts` | 신규 — 멤버 목록 API |
| `src/pages/api/org/members/[id].ts` | 신규 — 멤버 역할변경/제거 API |
| `src/pages/api/org/invitations.ts` | 신규 — 초대 목록/생성 API |
| `src/pages/api/org/invitations/[id].ts` | 신규 — 초대 취소 API |
| `src/pages/api/org/invitations/accept.ts` | 신규 — 초대 수락 API |
| `src/components/settings/OrgGeneralTab.tsx` | 신규 — 조직 일반 탭 (기존 OrgSettingsTab 대체) |
| `src/components/settings/OrgTeamTab.tsx` | 신규 — 조직 팀 탭 |
| `src/hooks/useOrgMembers.ts` | 신규 — 멤버 SWR 훅 |
| `src/hooks/useOrgInvitations.ts` | 신규 — 초대 SWR 훅 |
| `src/pages/settings.tsx` | 수정 — 탭 구조 변경 |
| `src/components/settings/OrgSettingsTab.tsx` | 삭제 또는 리네임 |
| `src/components/settings/UsersTab.tsx` | 삭제 (OrgTeamTab으로 대체) |

### 3.4 예상 LOC
- DB 스키마: ~20줄
- API 엔드포인트 (6개): ~300줄
- SWR 훅 (2개): ~80줄
- UI 컴포넌트 (2개): ~400줄
- settings.tsx 수정: ~10줄
- **총 ~810줄**

## 4. 기술 결정

### 4.1 RBAC 유지
- Sales의 3단계 RBAC(owner/admin/member) 유지
- Adion의 viewer 역할은 도입하지 않음 (Sales에서 불필요)

### 4.2 초대 시스템
- 이메일 기반 초대 (UUID 토큰)
- 만료기간: 7일
- 초대 수락 시 users 테이블에 자동 추가
- 이메일 발송은 현재 범위 외 (토큰 링크를 복사하는 방식)

### 4.3 기존 UsersTab 처리
- OrgTeamTab이 UsersTab의 기능을 흡수
- UsersTab 파일은 삭제

## 5. 위험 요소

| 위험 | 영향 | 대응 |
|------|------|------|
| 초대 시스템이 이메일 발송 없이 불편 | 중간 | 토큰 링크 복사 UI 제공, 이메일 발송은 추후 |
| 기존 UsersTab 사용 중인 코드 영향 | 낮음 | settings.tsx에서만 사용, 교체 용이 |
| DB 마이그레이션 필요 | 낮음 | 테이블 추가만 (기존 테이블 변경 없음) |

## 6. 성공 기준

- [ ] 조직 일반 정보가 Adion 스타일로 표시됨
- [ ] 멤버 목록이 역할과 함께 표시됨
- [ ] admin 이상이 멤버 역할을 변경할 수 있음
- [ ] 초대 생성/취소/수락이 동작함
- [ ] owner가 조직을 삭제할 수 있음
- [ ] 기존 설정(branding, timezone 등)이 유지됨
- [ ] Build 에러 없음
