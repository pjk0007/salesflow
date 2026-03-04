# email-ux-improve Planning Document

> **Summary**: AI 이메일 자연스러운 톤 개선 + 이메일 서명 기능
>
> **Project**: SalesFlow
> **Author**: jake
> **Date**: 2026-03-03
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

1. AI 자동발송 이메일이 HTML 디자인이 과도하여 광고성 메일로 보이는 문제 해결
2. 이메일 서명(On/Off)을 설정하면 모든 이메일 발송 시 하단에 자동 추가

### 1.2 Background

- AI가 생성하는 이메일이 화려한 HTML (배경색, 큰 버튼, 테이블 레이아웃 등)을 사용하여 스팸/광고처럼 보임
- 실제 B2B 영업 이메일은 플레인 텍스트에 가까운 간단한 서식(볼드, 밑줄, 하이라이트)만 사용
- 이메일 서명은 영업 신뢰도를 높이는 필수 요소이나 현재 미지원

---

## 2. Scope

### 2.1 In Scope

- [x] AI 이메일 프롬프트에 "사람이 쓴 듯한 스타일" 제약 추가
- [x] 이메일 서명 저장/관리 (emailConfigs 테이블 확장)
- [x] 서명 On/Off 토글 UI (EmailConfigForm)
- [x] 이메일 발송 시 서명 자동 삽입 (수동/자동/AI 모두)

### 2.2 Out of Scope

- 서명 에디터 (WYSIWYG) — 텍스트 입력만 지원
- 여러 서명 중 선택 — 조직당 1개 고정

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | AI 이메일 생성 시 과도한 HTML 디자인 제거, 볼드/밑줄/하이라이트만 허용 | High | Pending |
| FR-02 | emailConfigs에 signature(text), signatureEnabled(boolean) 컬럼 추가 | High | Pending |
| FR-03 | EmailConfigForm에 서명 입력 + On/Off 토글 UI | High | Pending |
| FR-04 | 이메일 발송 시(수동/자동/AI자동) signatureEnabled=true면 body 하단에 서명 삽입 | High | Pending |
| FR-05 | /api/email/config GET/POST에 signature, signatureEnabled 필드 추가 | High | Pending |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] AI 생성 이메일이 플레인 텍스트 스타일 (볼드/밑줄/하이라이트만)
- [ ] 서명 설정 저장/조회 동작
- [ ] 서명 On → 모든 이메일 하단에 서명 포함
- [ ] 서명 Off → 서명 미포함
- [ ] `pnpm build` 성공

---

## 5. 변경 파일

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 1 | `src/lib/ai.ts` (L47-51) | buildSystemPrompt에 스타일 제약 추가 |
| 2 | `src/lib/db/schema.ts` (emailConfigs) | signature, signatureEnabled 컬럼 추가 |
| 3 | `drizzle/0017_email_signature.sql` | ALTER TABLE 마이그레이션 |
| 4 | `src/app/api/email/config/route.ts` | GET/POST에 signature, signatureEnabled 처리 |
| 5 | `src/components/email/EmailConfigForm.tsx` | 서명 텍스트 입력 + On/Off Switch |
| 6 | `src/lib/nhn-email.ts` 또는 공통 헬퍼 | 서명 HTML 삽입 유틸 |
| 7 | `src/app/api/email/send/route.ts` | 수동 발송 시 서명 삽입 |
| 8 | `src/lib/email-automation.ts` | 자동 발송 시 서명 삽입 |
| 9 | `src/lib/auto-personalized-email.ts` | AI 자동 발송 시 서명 삽입 |

---

## 6. Next Steps

1. [ ] Design 문서 작성 (`/pdca design email-ux-improve`)
2. [ ] 구현
3. [ ] Gap 분석

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-03-03 | Initial draft | jake |
