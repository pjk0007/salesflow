# email-category Planning Document

> **Summary**: 이메일 템플릿 카테고리 관리 — NHN Cloud 카테고리 읽기 + 로컬 DB 관리
>
> **Project**: Sales Manager
> **Date**: 2026-02-24
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

이메일 템플릿을 카테고리별로 분류하여 관리. NHN Cloud에 이미 등록된 카테고리를 가져올 수 있고, 로컬에서도 카테고리를 생성/수정/삭제할 수 있으며, 템플릿을 카테고리에 할당.

### 1.2 Background

- 이메일 템플릿이 늘어나면 분류 필요
- NHN Cloud Email API에 카테고리 관리 기능이 존재 (CRUD + 계층 구조)
- 현재 `emailTemplates.templateType`은 자유 텍스트 — 구조화 필요

### 1.3 Related Documents

- NHN Cloud Email API v2.1: `docs/nhncloud/email.html` (카테고리 관리 섹션)
- NHN 카테고리 API: `GET/POST/PUT/DELETE /email/v2.1/appKeys/{appKey}/categories`

---

## 2. Scope

### 2.1 In Scope

- [ ] 로컬 DB에 `email_categories` 테이블 추가
- [ ] NHN Cloud에서 카테고리 목록 불러오기 (동기화 버튼)
- [ ] 로컬 카테고리 CRUD (생성/수정/삭제)
- [ ] 이메일 탭에 카테고리 관리 UI (설정 탭 내 or 템플릿 탭 내)
- [ ] 템플릿에 categoryId 연결 (기존 templateType 대체)
- [ ] 템플릿 목록에서 카테고리 필터

### 2.2 Out of Scope

- NHN Cloud에 카테고리 등록/수정/삭제 (API 호출은 읽기만)
- 카테고리 계층 구조 (depth > 0) — 1단계 플랫 구조만 지원

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 로컬 DB에 카테고리 테이블 (id, orgId, name, description) | High | Pending |
| FR-02 | NHN Cloud에서 카테고리 목록 가져오기 (동기화) | Medium | Pending |
| FR-03 | 카테고리 CRUD API (로컬) | High | Pending |
| FR-04 | 이메일 설정 탭에 카테고리 관리 섹션 추가 | High | Pending |
| FR-05 | emailTemplates에 categoryId FK 추가 (templateType 대체) | High | Pending |
| FR-06 | 템플릿 생성/편집 시 카테고리 선택 드롭다운 | High | Pending |
| FR-07 | 템플릿 목록에서 카테고리별 필터링 | Medium | Pending |

---

## 4. NHN Cloud 카테고리 API 참고

### 4.1 API 엔드포인트

| Method | URI | 용도 |
|--------|-----|------|
| GET | `/email/v2.1/appKeys/{appKey}/categories` | 카테고리 목록 |
| GET | `/email/v2.1/appKeys/{appKey}/categories/{categoryId}` | 카테고리 상세 |
| POST | `/email/v2.1/appKeys/{appKey}/categories` | 카테고리 등록 |
| PUT | `/email/v2.1/appKeys/{appKey}/categories/{categoryId}` | 카테고리 수정 |
| DELETE | `/email/v2.1/appKeys/{appKey}/categories/{categoryId}` | 카테고리 삭제 |

### 4.2 카테고리 데이터 구조 (NHN)

```json
{
  "categoryId": 12345,
  "categoryParentId": 0,
  "depth": 0,
  "categoryName": "마케팅",
  "categoryDesc": "마케팅 관련 이메일",
  "useYn": "Y"
}
```

### 4.3 응답 구조

NHN Email API 응답: `{ header, body: { data } }` — `body.data`에서 추출

---

## 5. 데이터 설계

### 5.1 email_categories 테이블

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | serial PK | 로컬 ID |
| orgId | uuid FK | 조직 |
| name | varchar(200) | 카테고리 이름 |
| description | varchar(1000) | 카테고리 설명 (선택) |
| nhnCategoryId | integer | NHN Cloud 카테고리 ID (동기화 시 저장, nullable) |
| createdAt | timestamptz | 생성일 |
| updatedAt | timestamptz | 수정일 |

### 5.2 emailTemplates 변경

- `categoryId` integer FK → `email_categories.id` 추가 (nullable)
- 기존 `templateType` varchar는 유지 (하위호환), 점진적으로 categoryId로 이전

---

## 6. Success Criteria

- [ ] `pnpm build` 성공
- [ ] 카테고리 CRUD 동작
- [ ] NHN 동기화로 카테고리 가져오기 동작
- [ ] 템플릿에 카테고리 할당/필터 동작

---

## 7. Next Steps

1. [ ] Design 문서 작성 (`/pdca design email-category`)
2. [ ] 구현
3. [ ] Gap 분석

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-24 | Initial draft | AI |
