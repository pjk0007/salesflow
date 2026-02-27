# Plan: 알림톡 (KakaoTalk 알림톡 via NHN Cloud)

## 개요

NHN Cloud KakaoTalk Bizmessage API를 활용하여 고객에게 알림톡(카카오 알림톡)을 발송하고 관리하는 기능을 구현한다.
기존 DB 스키마(`alimtalkConfigs`, `alimtalkTemplateLinks`, `alimtalkSendLogs`)를 활용하며,
NHN Cloud API를 Proxy하는 내부 API와 UI를 구축한다.

> **이메일 기능은 본 Plan의 범위에서 제외**하며, 알림톡 완료 후 별도 PDCA로 진행한다.

---

## 사용자 스토리

| ID | 역할 | 스토리 | 우선순위 |
|----|------|--------|----------|
| US-01 | 관리자 | NHN Cloud appKey/secretKey를 등록하고 알림톡 서비스를 활성화할 수 있다 | P0 |
| US-02 | 관리자 | NHN Cloud에서 발신프로필(sender profile) 목록을 조회하고 기본 발신프로필을 설정할 수 있다 | P0 |
| US-03 | 관리자 | NHN Cloud에 등록된 알림톡 템플릿 목록을 조회하고, 워크스페이스 파티션에 연결(mapping)할 수 있다 | P0 |
| US-04 | 영업담당자 | 선택한 고객 레코드에 대해 알림톡을 수동으로 발송할 수 있다 | P0 |
| US-05 | 영업담당자 | 알림톡 발송 이력을 조회하고 발송 결과(성공/실패)를 확인할 수 있다 | P0 |
| US-06 | 관리자 | 발신프로필 카테고리를 조회하고 새 발신프로필을 등록/인증할 수 있다 | P1 |
| US-07 | 관리자 | 파티션에 연결된 템플릿의 변수 매핑(레코드 필드 → 템플릿 변수)을 설정할 수 있다 | P0 |
| US-08 | 관리자 | 특정 조건(레코드 생성, 필드 변경)에 따라 자동 발송 트리거를 설정할 수 있다 | P2 |

---

## 기능 범위

### In-Scope (이번 구현)

| ID | 기능 | 설명 |
|----|------|------|
| F-01 | 알림톡 설정 관리 | NHN Cloud appKey, secretKey 등록/수정/테스트 연결 |
| F-02 | 발신프로필 조회 | NHN Cloud API를 통한 발신프로필 목록 조회 |
| F-03 | 발신프로필 등록/인증 | 발신프로필 카테고리 조회 → 발신프로필 등록 → 토큰 인증 |
| F-04 | 발신프로필 삭제 | 등록된 발신프로필 삭제 |
| F-05 | 기본 발신프로필 설정 | 조직의 기본 발신프로필(senderKey) 설정 |
| F-06 | 템플릿 목록 조회 | NHN Cloud API를 통해 발신프로필별 템플릿 목록 조회 |
| F-07 | 템플릿 상세 조회 | 템플릿 코드로 상세 정보(내용, 버튼, 변수) 조회 |
| F-08 | 템플릿-파티션 연결 | NHN Cloud 템플릿을 파티션에 연결하고 변수 매핑 설정 |
| F-09 | 수동 발송 (단건/대량) | 선택된 레코드 대상 알림톡 수동 발송 |
| F-10 | 발송 이력 조회 | 로컬 DB 기반 발송 이력 목록/상세 조회 |
| F-11 | 발송 결과 동기화 | NHN Cloud 결과 업데이트 API로 발송 상태 동기화 |
| F-12 | 알림톡 대시보드 | 발송 현황 요약 (전체/성공/실패 건수) |

### Out-of-Scope (향후)

- 이메일 발송 기능 (별도 PDCA)
- 친구톡(FriendTalk) 발송
- 템플릿 NHN Cloud 등록/수정/삭제 (NHN Cloud 콘솔에서 직접 관리)
- 자동 발송 트리거 (P2 - 추후 구현)
- 웹훅 수신 (NHN Cloud → 우리 서버)

---

## NHN Cloud API 연동 명세

### Base URL 및 인증

```
Base URL: https://api-alimtalk.cloud.toast.com
인증 헤더: X-Secret-Key: {secretKey}
경로 파라미터: {appkey}
API 버전: v2.3 (알림톡), v2.0 (발신프로필)
```

### 사용할 NHN Cloud API 목록

#### 발신프로필 API (v2.0)

| 기능 | 메서드 | 경로 |
|------|--------|------|
| 카테고리 조회 | GET | `/alimtalk/v2.0/appkeys/{appkey}/sender/categories` |
| 발신프로필 등록 | POST | `/alimtalk/v2.0/appkeys/{appkey}/senders` |
| 토큰 인증 | POST | `/alimtalk/v2.0/appkeys/{appkey}/sender/token` |
| 발신프로필 목록 조회 | GET | `/alimtalk/v2.0/appkeys/{appkey}/senders` |
| 발신프로필 단건 조회 | GET | `/alimtalk/v2.0/appkeys/{appkey}/senders/{senderKey}` |
| 발신프로필 삭제 | DELETE | `/alimtalk/v2.0/appkeys/{appkey}/senders/{senderKey}` |

#### 템플릿 API (v2.3)

| 기능 | 메서드 | 경로 |
|------|--------|------|
| 템플릿 목록 조회 | GET | `/alimtalk/v2.3/appkeys/{appkey}/senders/{senderKey}/templates` |
| 템플릿 상세 조회 | GET | `/alimtalk/v2.3/appkeys/{appkey}/senders/{senderKey}/templates/{templateCode}` |

> 템플릿 등록/수정/삭제/검수는 NHN Cloud 콘솔에서 직접 관리 (카카오 검수 필요)

#### 전송 API (v2.3)

| 기능 | 메서드 | 경로 |
|------|--------|------|
| 치환 발송 | POST | `/alimtalk/v2.3/appkeys/{appkey}/messages` |
| 전문 발송 | POST | `/alimtalk/v2.3/appkeys/{appkey}/raw-messages` |
| 발송 취소 | DELETE | `/alimtalk/v2.3/appkeys/{appkey}/messages/{requestId}` |

#### 조회 API (v2.3)

| 기능 | 메서드 | 경로 |
|------|--------|------|
| 메시지 목록 조회 | GET | `/alimtalk/v2.3/appkeys/{appkey}/messages` |
| 메시지 단건 조회 | GET | `/alimtalk/v2.3/appkeys/{appkey}/messages/{requestId}/{recipientSeq}` |
| 결과 업데이트 조회 | GET | `/alimtalk/v2.3/appkeys/{appkey}/message-results` |

---

## 기존 DB 스키마 활용

### alimtalk_configs (조직별 NHN Cloud 설정)

```
id, orgId(unique), appKey, secretKey, defaultSenderKey, isActive, createdAt, updatedAt
```

- 조직당 1개의 NHN Cloud 설정
- appKey/secretKey로 API 인증

### alimtalk_template_links (파티션-템플릿 연결)

```
id, partitionId, name, senderKey, templateCode, templateName,
triggerType(manual/on_create/on_field_change), triggerCondition(jsonb),
recipientField, variableMappings(jsonb), isActive, createdBy, createdAt, updatedAt
```

- 파티션별로 NHN Cloud 템플릿을 연결
- recipientField: 수신번호로 사용할 레코드 필드 키
- variableMappings: `{ "#{name}": "companyName", "#{phone}": "representativePhone" }`

### alimtalk_send_logs (발송 이력)

```
id, orgId, templateLinkId, partitionId, recordId,
senderKey, templateCode, templateName, recipientNo,
requestId, recipientSeq, status(pending/sent/failed),
resultCode, resultMessage, content, triggerType,
sentBy, sentAt, completedAt
```

- 발송 건별 로그 저장
- NHN Cloud requestId/recipientSeq로 결과 추적

---

## 내부 API 설계 (Next.js Pages Router)

### 설정 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/alimtalk/config` | 현재 조직의 알림톡 설정 조회 |
| POST | `/api/alimtalk/config` | 알림톡 설정 등록/수정 |
| POST | `/api/alimtalk/config/test` | NHN Cloud 연결 테스트 |

### 발신프로필 Proxy API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/alimtalk/senders` | 발신프로필 목록 조회 (NHN Cloud Proxy) |
| POST | `/api/alimtalk/senders` | 발신프로필 등록 (NHN Cloud Proxy) |
| POST | `/api/alimtalk/senders/token` | 발신프로필 토큰 인증 (NHN Cloud Proxy) |
| DELETE | `/api/alimtalk/senders/[senderKey]` | 발신프로필 삭제 (NHN Cloud Proxy) |
| GET | `/api/alimtalk/sender-categories` | 발신프로필 카테고리 조회 |
| PUT | `/api/alimtalk/config/default-sender` | 기본 발신프로필 설정 |

### 템플릿 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/alimtalk/templates` | 발신프로필별 템플릿 목록 (NHN Cloud Proxy) |
| GET | `/api/alimtalk/templates/[templateCode]` | 템플릿 상세 조회 (NHN Cloud Proxy) |

### 템플릿 연결(로컬) API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/alimtalk/template-links` | 파티션별 템플릿 연결 목록 |
| POST | `/api/alimtalk/template-links` | 템플릿 연결 생성 |
| PUT | `/api/alimtalk/template-links/[id]` | 템플릿 연결 수정 (변수 매핑 등) |
| DELETE | `/api/alimtalk/template-links/[id]` | 템플릿 연결 삭제 |

### 발송 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/alimtalk/send` | 알림톡 발송 (단건/대량) |
| DELETE | `/api/alimtalk/send/[requestId]` | 발송 취소 |

### 발송 이력 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/alimtalk/logs` | 발송 이력 목록 (로컬 DB) |
| GET | `/api/alimtalk/logs/[id]` | 발송 이력 상세 |
| POST | `/api/alimtalk/logs/sync` | NHN Cloud 결과 동기화 |
| GET | `/api/alimtalk/stats` | 발송 통계 요약 |

---

## UI 구성

### 페이지 구조

```
/alimtalk                    → 알림톡 메인 (대시보드 + 탭 네비게이션)
  ├─ [대시보드 탭]            → 발송 현황 요약, 최근 발송 이력
  ├─ [발신프로필 탭]          → 발신프로필 목록, 등록, 기본 설정
  ├─ [템플릿 탭]              → 템플릿 목록 조회, 파티션 연결 관리
  ├─ [발송 이력 탭]           → 발송 로그 목록, 결과 확인
  └─ [설정 탭]               → NHN Cloud API 키 설정
```

### 주요 컴포넌트

| 컴포넌트 | 설명 |
|----------|------|
| `AlimtalkLayout` | 탭 네비게이션 레이아웃 |
| `AlimtalkDashboard` | 발송 통계 카드, 최근 이력 테이블 |
| `SenderProfileList` | 발신프로필 목록 + 기본 설정 배지 |
| `SenderProfileRegisterDialog` | 발신프로필 등록 + 토큰 인증 스텝 다이얼로그 |
| `TemplateList` | 발신프로필별 템플릿 목록 |
| `TemplateLinkDialog` | 템플릿-파티션 연결 + 변수 매핑 설정 |
| `SendAlimtalkDialog` | 레코드 선택 → 템플릿 선택 → 변수 미리보기 → 발송 |
| `SendLogTable` | 발송 이력 테이블 (필터/페이지네이션) |
| `AlimtalkConfigForm` | API 키 설정 폼 |
| `VariableMappingEditor` | 템플릿 변수 ↔ 레코드 필드 매핑 UI |

---

## 구현 순서

### Phase 1: 기반 (설정 + NHN Cloud 클라이언트)

1. NHN Cloud API 클라이언트 유틸리티 (`src/lib/nhn-alimtalk.ts`)
2. 알림톡 설정 API (`/api/alimtalk/config`)
3. 설정 페이지 UI (`AlimtalkConfigForm`)

### Phase 2: 발신프로필

4. 발신프로필 Proxy API (목록/등록/인증/삭제)
5. 발신프로필 UI (`SenderProfileList`, `SenderProfileRegisterDialog`)
6. 기본 발신프로필 설정

### Phase 3: 템플릿

7. 템플릿 Proxy API (목록/상세 조회)
8. 템플릿-파티션 연결 CRUD API
9. 템플릿 목록 UI + 연결 다이얼로그 (`TemplateList`, `TemplateLinkDialog`)
10. 변수 매핑 에디터 (`VariableMappingEditor`)

### Phase 4: 전송 + 이력

11. 발송 API (치환 발송 기반)
12. 발송 다이얼로그 (`SendAlimtalkDialog`)
13. 발송 이력 API + UI (`SendLogTable`)
14. 발송 결과 동기화 API

### Phase 5: 대시보드 + 통합

15. 통계 API + 대시보드 UI
16. 탭 레이아웃 통합 (`/alimtalk` 페이지)
17. 고객 관리 테이블에서 알림톡 발송 버튼 연동

---

## 기술 결정

| 항목 | 결정 | 이유 |
|------|------|------|
| NHN Cloud API 호출 | 서버 사이드 Proxy | secretKey 노출 방지 |
| API 클라이언트 | 네이티브 fetch | 추가 의존성 불필요, Next.js 환경 최적 |
| 상태 관리 | SWR | 기존 프로젝트 패턴 일관성 |
| 발송 이력 | 로컬 DB 저장 | NHN Cloud API 호출 부담 최소화, 빠른 조회 |
| 결과 동기화 | 수동 + 주기적 | 웹훅 미사용 (향후 추가 가능) |
| 템플릿 관리 | NHN Cloud 콘솔 위임 | 카카오 검수 필요, 직접 관리 불필요 |

---

## 의존성

- 기존 인증 시스템 (`getUserFromRequest`)
- 기존 DB 스키마 (`alimtalkConfigs`, `alimtalkTemplateLinks`, `alimtalkSendLogs`)
- NHN Cloud 계정 및 KakaoTalk Bizmessage 서비스 활성화
- 발신프로필 사전 등록 (카카오 채널 필요)

---

## 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| NHN Cloud API 장애 | 발송 불가 | 에러 핸들링 + 재시도 UI |
| 카카오 템플릿 검수 지연 | 템플릿 사용 불가 | NHN Cloud 콘솔에서 사전 등록 권장 |
| secretKey 노출 | 보안 위험 | 서버 사이드 Proxy 필수, DB 암호화 고려 |
| 대량 발송 시 Rate Limit | 발송 지연 | 1회 최대 1,000건 제한 준수, 순차 발송 |
| 수신번호 형식 오류 | 발송 실패 | 발송 전 전화번호 형식 검증 |

---

## 성공 기준

- [ ] NHN Cloud appKey/secretKey 설정 및 연결 테스트 성공
- [ ] 발신프로필 목록 조회 및 기본 프로필 설정 가능
- [ ] 발신프로필 등록 및 토큰 인증 플로우 작동
- [ ] NHN Cloud 템플릿 목록/상세 조회 가능
- [ ] 템플릿-파티션 연결 CRUD 작동
- [ ] 변수 매핑 설정 및 미리보기 가능
- [ ] 단건/대량 알림톡 발송 성공
- [ ] 발송 이력 조회 및 결과 상태 확인 가능
- [ ] 발송 결과 NHN Cloud 동기화 작동
