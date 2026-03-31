# Plan: 광고 리드 관리 시스템 (Ad Lead Management)

> **Summary**: 멀티 조직 기반 광고 플랫폼(Meta, Google, Naver) 연동 및 리드 자동 수집 시스템
>
> **Project**: Sendb (Salesflow)
> **Author**: jaehun
> **Date**: 2026-03-31
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

광고 플랫폼(Meta, Google Ads, Naver)에서 발생하는 리드를 조직(회사)별로 자동 수집하고 관리하는 시스템을 구축합니다. 각 조직은 워크스페이스 단위로 사업을 구분하고 있으며, 워크스페이스별로 광고 계정을 연결하고 리드를 해당 파티션에 자동으로 수집해야 합니다.

### 1.2 Background

- **현재 상황**: Sendb는 멀티테넌트(조직별) CRM이지만, 광고 플랫폼 연동이 없음
- **참고 구현**: wedly 프로젝트에 Meta 리드 연동이 구현되어 있으나, 단일 회사 전제라 조직/프로덕트 분리 개념 없음
- **비즈니스 필요**: 매치스플랜 회사에서 디자이너하이어, 백오피스랩 등 여러 사업(워크스페이스)을 운영하며 각각 다른 광고를 돌리고 있음. 광고 계정을 워크스페이스에 연결하고, 리드가 해당 파티션에 자동 수집되어야 함
- **기존 구조 활용**: 워크스페이스가 이미 브랜드/프로덕트 역할을 하고 있으므로 별도 brands 테이블 불필요

### 1.3 핵심 차이점 (Wedly vs Sendb)

| 항목 | Wedly (현재) | Sendb (목표) |
|------|-------------|-------------|
| 조직 | 단일 회사 (wedly) | 멀티 조직 (N개 회사) |
| 사업 구분 | 없음 | 워크스페이스 = 사업/브랜드 단위 |
| 광고 플랫폼 | Meta만 | Meta + Google + Naver |
| 인증 | 환경변수 1개 토큰 | 조직별 OAuth 연동 |
| 리드 라우팅 | form_id → partition 고정 | 조직 → 워크스페이스 → 광고계정 → 파티션 |

### 1.4 Related Documents

- Wedly Meta 연동 코드: `/Users/jaehun/Projects/wedly/src/pages/api/meta/`
- 기존 조직 스키마: `src/lib/db/schema.ts`

---

## 2. Scope

### 2.1 In Scope

- [ ] 광고 플랫폼 연결 관리 (Meta OAuth, Google OAuth, Naver API)
- [ ] 광고 계정 등록/관리 UI (워크스페이스 연결)
- [ ] 리드 폼 연동 설정 (필드 매핑, 기본값, 대상 파티션)
- [ ] Webhook 기반 실시간 리드 수집 (Meta)
- [ ] 리드 수집 히스토리/통계
- [ ] 광고 캠페인/성과 조회 (읽기 전용)

### 2.2 Out of Scope

- 광고 캠페인 생성/수정 (광고 관리는 각 플랫폼에서)
- 광고 비용 결제 연동
- 리드 스코어링 / 자동 분배 (추후 별도 피처)
- TikTok, LinkedIn 등 추가 플랫폼 (1차 이후)

---

## 3. Requirements

### 3.1 데이터 모델

#### FR-01: ad_platforms 테이블 (광고 플랫폼 연결)

조직별로 광고 플랫폼 인증 정보를 관리합니다.

```
ad_platforms
├── id: serial (PK)
├── orgId: uuid (FK → organizations)
├── platform: varchar(20) - 'meta' | 'google' | 'naver'
├── name: varchar(200) - 연결 이름 (예: "매치스플랜 메타 광고")
├── credentials: jsonb (암호화) - OAuth 토큰, API 키 등
│   ├── meta: { accessToken, appId, appSecret, pageAccessTokens }
│   ├── google: { refreshToken, clientId, clientSecret, developerToken }
│   └── naver: { apiKey, secretKey, customerId }
├── status: varchar(20) - 'connected' | 'expired' | 'error'
├── lastSyncAt: timestamptz - 마지막 동기화
├── createdBy: uuid (FK → users)
├── createdAt: timestamptz
├── updatedAt: timestamptz
└── UNIQUE(orgId, platform, name)
```

#### FR-02: ad_accounts 테이블 (광고 계정)

플랫폼 연결 하위의 개별 광고 계정. 워크스페이스에 연결하여 사업 단위를 구분합니다.

```
ad_accounts
├── id: serial (PK)
├── adPlatformId: integer (FK → ad_platforms)
├── workspaceId: integer (FK → workspaces) - nullable, 워크스페이스(사업)와 연결
├── externalAccountId: varchar(100) - 플랫폼 내부 계정 ID
├── name: varchar(200) - 계정 이름
├── currency: varchar(10) - KRW, USD 등
├── status: varchar(20) - 'active' | 'paused' | 'disabled'
├── metadata: jsonb - 플랫폼별 추가 정보
├── lastSyncAt: timestamptz
├── createdAt: timestamptz
├── updatedAt: timestamptz
└── UNIQUE(adPlatformId, externalAccountId)
```

#### FR-03: ad_lead_integrations 테이블 (리드 연동 설정)

광고 → 파티션으로 리드를 매핑하는 연동 설정입니다. (Wedly의 `meta_lead_integrations` 확장)

```
ad_lead_integrations
├── id: serial (PK)
├── orgId: uuid (FK → organizations)
├── adAccountId: integer (FK → ad_accounts)
├── name: varchar(200) - 연동 이름
├── platform: varchar(20) - 'meta' | 'google' | 'naver'
├── partitionId: integer (FK → partitions) - 리드 저장 대상
├── formId: varchar(200) - 플랫폼별 리드폼 ID
├── formName: varchar(200) - 폼 이름 (캐시)
├── fieldMappings: jsonb - { "platform_field": "db_column" }
├── defaultValues: jsonb - { "column": "fixed_value" }
├── isActive: integer (0/1)
├── createdBy: uuid (FK → users)
├── createdAt: timestamptz
├── updatedAt: timestamptz
└── UNIQUE(adAccountId, formId)
```

#### FR-04: ad_lead_logs 테이블 (리드 수집 로그)

```
ad_lead_logs
├── id: serial (PK)
├── integrationId: integer (FK → ad_lead_integrations)
├── externalLeadId: varchar(200) - 플랫폼 리드 ID
├── recordId: integer (FK → records) - nullable, 생성된 레코드
├── rawData: jsonb - 원본 리드 데이터
├── status: varchar(20) - 'success' | 'failed' | 'duplicate' | 'skipped'
├── errorMessage: text - 실패 시 에러 내용
├── processedAt: timestamptz
├── createdAt: timestamptz
└── INDEX(integrationId, createdAt)
```

### 3.2 광고 플랫폼 연동

#### FR-05: Meta (Facebook/Instagram) 연동

Wedly 구현을 기반으로 멀티테넌트 확장:

- **OAuth 연결**: 조직별 Meta Business 앱 연결 (Facebook Login for Business)
- **광고 계정 동기화**: 연결된 비즈니스의 광고 계정 목록 자동 가져오기
- **리드 폼 조회**: 페이지별 리드 폼 목록 조회
- **Webhook 수신**: `POST /api/webhooks/meta` — form_id로 조직/연동 매칭
- **리드 데이터 처리**: 필드 매핑 → 레코드 생성 → 알림톡/이메일 트리거

#### FR-06: Google Ads 연동 (2차)

- **수집 방식**: Polling (Webhook 없음) — Cron 스케줄러로 주기적 조회 또는 Google Cloud Pub/Sub
- **OAuth 연결**: Google Ads API OAuth2
- **리드 폼 조회**: Google Lead Form Extensions
- 구현 우선순위: Meta 이후

#### FR-07: Naver 검색광고 연동 (2차)

- **수집 방식**: Polling (Webhook 없음) — 네이버 리드폼 기능이 약해서 기존 웹폼 활용이 더 현실적
- **API 키 연결**: Naver 검색광고 API (REST)
- **리드 수집**: 전환 추적 데이터 주기적 조회 또는 랜딩페이지 → Sendb 웹폼
- 구현 우선순위: Meta 이후

### 3.3 UI 요구사항

#### FR-08: 광고 연결 설정 페이지

```
설정 > 광고 연동
├── 연결된 플랫폼 목록 (Meta ✅, Google ❌, Naver ❌)
├── [+ 플랫폼 연결] 버튼 → OAuth 플로우
├── 플랫폼별 광고 계정 목록
│   ├── 계정 상태 (활성/일시정지)
│   ├── 워크스페이스 연결 설정
│   └── 마지막 동기화 시간
└── [계정 동기화] 버튼
```

#### FR-09: 리드 연동 설정 UI

```
설정 > 광고 연동 > 리드 연동
├── 연동 목록 (활성/비활성 토글)
├── [+ 연동 추가] → 스텝 다이얼로그
│   ├── Step 1: 광고 계정 선택
│   ├── Step 2: 리드 폼 선택 (플랫폼에서 가져옴)
│   ├── Step 3: 대상 파티션 선택
│   ├── Step 4: 필드 매핑 (드래그 앤 드롭 or 드롭다운)
│   └── Step 5: 기본값 설정
└── 연동별 상세 (수신 로그, 통계)
```

#### FR-10: 리드 수집 대시보드

```
대시보드 > 광고 리드
├── 전체 리드 수 (오늘/이번 주/이번 달)
├── 플랫폼별 리드 수 차트
├── 워크스페이스별 리드 수 차트
├── 최근 수집 리드 목록
└── 연동 상태 모니터링 (에러 알림)
```

### 3.4 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Performance | Webhook 리드 처리 < 3초 | 로그 기반 측정 |
| Reliability | 리드 유실 0% (retry + 로깅) | ad_lead_logs 검증 |
| Security | OAuth 토큰 암호화 저장 | credentials 필드 암호화 |
| Scalability | 조직당 광고 계정 50개+ 지원 | 부하 테스트 |

---

## 4. Architecture

### 4.1 전체 구조

```
Organization (조직/회사)
├── AdPlatforms[] (광고 플랫폼 연결)
│   ├── Meta (OAuth 연결)
│   ├── Google (OAuth 연결)
│   └── Naver (API 키 연결)
├── Workspaces[] (기존 — 사업/브랜드 단위)
│   ├── 디자이너하이어 (워크스페이스)
│   │   ├── AdAccounts[] → Meta 광고계정 A
│   │   └── Partitions[]
│   │       ├── 메타광고 리드 ← AdLeadIntegration (리드폼 X → 여기로 수집)
│   │       └── 직접유입
│   └── 백오피스랩 (워크스페이스)
│       ├── AdAccounts[] → Meta 광고계정 B
│       └── Partitions[]
│           └── 광고리드 ← AdLeadIntegration (리드폼 Y → 여기로 수집)
```

### 4.2 리드 수집 플로우

```
[광고 플랫폼] → Webhook/Polling
       ↓
[POST /api/webhooks/{platform}]
       ↓
form_id로 ad_lead_integrations 조회
       ↓
조직/연동 매칭 → 필드 매핑 적용
       ↓
records 테이블에 레코드 생성
       ↓
ad_lead_logs에 로그 기록
       ↓
알림톡/이메일 자동화 트리거 (on_create)
```

### 4.3 Key Architectural Decisions

| Decision | Selected | Rationale |
|----------|----------|-----------|
| 사업 단위 | 기존 워크스페이스 활용 | 별도 brands 테이블 불필요, 기존 구조 재사용 |
| OAuth 토큰 저장 | DB jsonb (암호화) | 조직별 독립 관리, 환경변수 불가 |
| Webhook 엔드포인트 | 플랫폼별 분리 (`/api/webhooks/meta`) | 플랫폼별 검증/파싱 로직 분리 |
| 리드 중복 처리 | externalLeadId 기반 체크 | 플랫폼 리드 ID로 중복 방지 |
| 1차 구현 범위 | Meta만 | Wedly 코드 재활용 가능, 검증된 구현 |

---

## 5. Implementation Order

### Phase 1: 데이터 모델 + 플랫폼 연결 (Meta 우선)

1. `ad_platforms`, `ad_accounts`, `ad_lead_integrations`, `ad_lead_logs` 테이블 스키마 + 마이그레이션
2. Meta OAuth 연결 플로우 (Facebook Login)
3. 광고 계정 동기화 API (워크스페이스 연결)
4. 광고 연결 설정 UI

### Phase 2: 리드 연동 (Meta)

5. 리드 연동 설정 API (CRUD)
6. Meta Webhook 엔드포인트 (`/api/webhooks/meta`)
7. 리드 수집 처리 로직 (필드 매핑, 레코드 생성, 파티션에 저장)
8. 리드 연동 설정 UI (스텝 다이얼로그)

### Phase 3: 모니터링 + 대시보드

9. 리드 수집 로그 조회 API/UI
10. 리드 통계 대시보드 위젯
11. 연동 상태 모니터링 (에러 알림)

### Phase 4: 추가 플랫폼 (2차)

12. Google Ads 연동
13. Naver 검색광고 연동

---

## 6. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Meta API 변경/deprecation | High | Medium | Graph API 버전 명시, 변경 모니터링 |
| OAuth 토큰 만료 | High | High | 자동 갱신 로직, 만료 알림, 상태 모니터링 |
| Webhook 유실 | High | Low | 즉시 200 응답 + 비동기 처리, 로그 기록, retry |
| 워크스페이스 삭제 시 광고계정 처리 | Medium | Low | ad_accounts.workspaceId를 set null 처리 |
| 멀티테넌트 데이터 격리 | High | Medium | 모든 쿼리에 orgId 조건 필수 |
| credentials 보안 | High | Medium | DB 레벨 암호화, API 응답에서 마스킹 |

---

## 7. Convention Prerequisites

### 7.1 Environment Variables Needed

| Variable | Purpose | Scope |
|----------|---------|-------|
| `META_APP_ID` | Meta 앱 ID (Sendb 앱) | Server |
| `META_APP_SECRET` | Meta 앱 시크릿 | Server |
| `META_WEBHOOK_VERIFY_TOKEN` | Webhook 검증 토큰 | Server |
| `GOOGLE_ADS_CLIENT_ID` | Google Ads OAuth (2차) | Server |
| `GOOGLE_ADS_CLIENT_SECRET` | Google Ads OAuth (2차) | Server |
| `NAVER_AD_API_KEY` | Naver 검색광고 API (2차) | Server |
| `CREDENTIAL_ENCRYPTION_KEY` | OAuth 토큰 암호화 키 | Server |

### 7.2 API Convention

기존 패턴 따름:
- `GET/POST /api/ad-platforms` — 플랫폼 연결
- `GET/POST /api/ad-accounts` — 광고 계정 (워크스페이스 연결)
- `GET/POST /api/ad-lead-integrations` — 리드 연동 (파티션 연결)
- `POST /api/webhooks/meta` — Meta Webhook

---

## 8. Success Criteria

### 8.1 Definition of Done

- [ ] Meta OAuth 연결 및 광고 계정 동기화 가능
- [ ] 광고 계정 ↔ 워크스페이스 연결 가능
- [ ] Meta 리드 폼 연동 설정 및 자동 리드 수집 동작
- [ ] 수집된 리드가 지정된 파티션에 레코드로 생성
- [ ] 기존 알림톡/이메일 자동화와 연동 (on_create 트리거)
- [ ] 리드 수집 로그 조회 가능

### 8.2 Quality Criteria

- [ ] 리드 유실 0% (Webhook 처리 신뢰성)
- [ ] OAuth 토큰 암호화 저장
- [ ] 조직간 데이터 격리 검증
- [ ] 빌드/린트 에러 없음

---

## 9. Next Steps

1. [x] Design 문서 작성 (`ad-lead-management.design.md`)
2. [ ] Phase 1 구현 시작

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-03-31 | Initial draft | jaehun |
| 0.2 | 2026-03-31 | brands 테이블 제거, 기존 워크스페이스 활용으로 변경 | jaehun |
