# Plan: 설정 페이지 통합 및 사이드바 개선

## 개요

### 목적

현재 사이드바에 "워크스페이스 설정"과 "조직 설정"이 각각 독립 메뉴로 존재하지만 페이지가 미구현 상태이다.
B2B SaaS 표준 패턴에 맞게 사이드바를 **업무/관리 영역으로 분리**하고, 설정 기능을 **단일 `/settings` 페이지의 탭 구조**로 통합 구현한다.

### 배경

- 사이드바에 `workspace-settings`, `org-settings` 두 메뉴가 등록되어 있으나 페이지 미존재
- 업무 메뉴(레코드, 알림톡)와 관리 메뉴(사용자, 설정)가 같은 레벨에 혼재
- member 역할 사용자에게 불필요한 관리 메뉴가 노출됨
- DB에 `organizations.settings`, `organizations.branding`, `workspaces.settings` JSONB 필드가 이미 존재

---

## 사용자 스토리

| ID | 역할 | 스토리 | 우선순위 |
|----|------|--------|----------|
| US-01 | 관리자 | 설정 페이지에서 워크스페이스 이름, 설명, 아이콘을 수정할 수 있다 | P0 |
| US-02 | owner | 조직명, 브랜딩(로고, 색상, 회사 표시명)을 수정할 수 있다 | P0 |
| US-03 | owner | 조직 설정(타임존, 로케일, 날짜 형식)을 수정할 수 있다 | P1 |
| US-04 | owner | 통합 코드 접두어(integratedCodePrefix)를 변경할 수 있다 | P1 |
| US-05 | 모든 사용자 | 사이드바에서 업무 메뉴와 관리 메뉴가 시각적으로 구분된다 | P0 |
| US-06 | member | 관리 메뉴(설정)가 사이드바에 보이지 않는다 | P0 |

---

## 기능 범위

### In-Scope (이번 구현)

| ID | 기능 | 설명 |
|----|------|------|
| F-01 | 사이드바 개선 | 업무/관리 영역 분리, 역할별 메뉴 표시 |
| F-02 | 설정 페이지 (`/settings`) | 탭 구조: "워크스페이스", "조직" |
| F-03 | 워크스페이스 설정 탭 | 이름, 설명, 아이콘 수정 폼 |
| F-04 | 조직 설정 탭 | 조직명, 브랜딩, 설정 수정 폼 |
| F-05 | 워크스페이스 설정 API | PATCH `/api/workspaces/[id]/settings` |
| F-06 | 조직 설정 API | GET/PATCH `/api/org/settings` |
| F-07 | 사용자 메뉴 설정 하위 이동 | `/users`를 설정 페이지의 "사용자" 탭으로 통합 |

### Out-of-Scope (향후)

- 워크스페이스 생성/삭제 기능 (별도 PDCA)
- 로고 이미지 업로드 (파일 저장소 연동 필요)
- API 토큰 관리 페이지 (apiTokens 테이블 존재하나 별도 PDCA)
- 이메일 설정 (emailConfigs 테이블 존재하나 별도 PDCA)
- 결제/플랜 관리

---

## 기술 스택 (기존 프로젝트 기준)

| 항목 | 기술 |
|------|------|
| Framework | Next.js 16 (Pages Router) |
| Language | TypeScript |
| UI | ShadCN UI (Tabs, Input, Select, Button) + Tailwind CSS 4 |
| Data Fetching | SWR |
| DB | PostgreSQL + Drizzle ORM |
| 인증 | JWT (cookie 기반, `getUserFromRequest()`) |

---

## DB 스키마 (기존 활용 - 변경 없음)

```sql
-- organizations 테이블 (이미 존재)
organizations (
  id                      SERIAL PRIMARY KEY,
  name                    VARCHAR(200) NOT NULL,
  slug                    VARCHAR(100) UNIQUE NOT NULL,
  branding                JSONB,        -- { logo?, primaryColor?, companyName? }
  integrated_code_prefix  VARCHAR(20) DEFAULT 'SALES' NOT NULL,
  integrated_code_seq     INTEGER DEFAULT 0 NOT NULL,
  settings                JSONB,        -- { timezone?, locale?, dateFormat? }
  created_at              TIMESTAMPTZ,
  updated_at              TIMESTAMPTZ
)

-- workspaces 테이블 (이미 존재)
workspaces (
  id              SERIAL PRIMARY KEY,
  org_id          INTEGER NOT NULL REFERENCES organizations(id),
  name            VARCHAR(200) NOT NULL,
  description     TEXT,
  icon            VARCHAR(50),
  settings        JSONB,       -- { defaultVisibleFields?[], duplicateCheckField? }
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ
)
```

> 추가 마이그레이션 불필요 - 기존 JSONB 필드로 충분

---

## API 설계 요약

### GET `/api/org/settings`
- 인증: JWT (owner/admin)
- 응답: 조직 정보 (name, slug, branding, settings, integratedCodePrefix)

### PATCH `/api/org/settings`
- Body: `{ name?, branding?, settings?, integratedCodePrefix? }`
- 인증: JWT (owner만)
- 응답: 수정된 조직 정보

### PATCH `/api/workspaces/[id]/settings`
- Body: `{ name?, description?, icon?, settings? }`
- 인증: JWT (owner/admin)
- 제약: 같은 조직의 워크스페이스만 수정
- 응답: 수정된 워크스페이스 정보

---

## UI 구조

### 사이드바 (개선 후)

```
┌─────────────────────────────┐
│ [로고] Sales Manager         │
├─────────────────────────────┤
│ 업무                          │  ← 섹션 라벨
│  ├── 레코드                   │
│  └── 알림톡                   │
├─────────────────────────────┤
│ 관리 (admin/owner만 표시)      │  ← 섹션 라벨 + 역할 필터
│  └── 설정                     │  ← 단일 진입점
├─────────────────────────────┤
│ 사용자 정보 + 로그아웃         │
└─────────────────────────────┘
```

### 설정 페이지 (`/settings`)

```
/settings (SettingsPage)
├── WorkspaceLayout (기존)
├── 헤더: "설정"
└── Tabs
    ├── [탭] 워크스페이스
    │   └── WorkspaceSettingsForm (이름, 설명, 아이콘)
    ├── [탭] 조직 (owner만 편집, admin은 읽기)
    │   └── OrgSettingsForm (조직명, 브랜딩, 설정, 코드 접두어)
    └── [탭] 사용자 (기존 /users 기능 통합)
        └── 기존 UserToolbar + UserTable + Dialogs
```

---

## 권한 모델

| 역할 | 사이드바 관리 영역 | 워크스페이스 설정 | 조직 설정 | 사용자 관리 |
|------|:------------------:|:----------------:|:---------:|:-----------:|
| owner | 표시 | 수정 | 수정 | 수정 |
| admin | 표시 | 수정 | 읽기 전용 | member만 수정 |
| member | 숨김 | X | X | X |

---

## 성공 기준

### Definition of Done

- [ ] 사이드바가 업무/관리 영역으로 분리됨
- [ ] member 역할은 관리 메뉴를 볼 수 없음
- [ ] `/settings` 페이지에서 워크스페이스 설정 수정 가능
- [ ] `/settings` 페이지에서 조직 설정 수정 가능 (owner만)
- [ ] `/settings` 페이지에서 사용자 관리 가능 (기존 기능 통합)
- [ ] 기존 `/users` 독립 페이지 제거, `/workspace-settings`, `/org-settings` 미사용 경로 정리
- [ ] 빌드 성공

---

## 리스크 및 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| `/users` 경로를 `/settings`로 통합 시 북마크 깨짐 | 낮 | `/users` 접근 시 `/settings?tab=users`로 리다이렉트 |
| admin이 조직 설정을 실수로 수정 | 중 | admin은 조직 탭 읽기 전용으로 제한 |
| JSONB 필드 부분 업데이트 시 데이터 손실 | 높 | spread operator로 기존 데이터 유지 후 부분 머지 |

---

## 다음 단계

1. [ ] Design 문서 작성 (`/pdca design settings-page`)
2. [ ] 구현
3. [ ] Gap 분석

---

## 버전 이력

| 버전 | 날짜 | 변경사항 | 작성자 |
|------|------|----------|--------|
| 0.1 | 2026-02-12 | 초안 작성 | AI |
