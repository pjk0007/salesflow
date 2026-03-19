# Plan: duplicate-prevention (중복 방지 기능)

> 레코드 중복 감지 + 이메일 중복 발송 방지

## 1. 배경 및 문제점

### 현재 상황
- **레코드 중복 체크**: `partitions.duplicateCheckField` 1개 필드만 지원, 중복 시 409 reject만 가능
- **이메일 쿨다운**: 1시간 내 동일 record+templateLink 중복만 차단 (시간 기반)
- **문제**: 같은 레코드에 같은 이메일 주소가 저장되면 업데이트 트리거로 또 전송됨
- **부재 기능**: 중복 레코드 시각적 표시, 중복 시 액션 선택, 이메일 중복 발송 On/Off

### 해결 목표
1. 이메일 자동발송(템플릿/AI)에서 **동일 수신자에게 중복 발송 방지** On/Off
2. 파티션 레코드 목록에서 **중복 감지 + 시각적 표시 + 액션 설정**

## 2. 기능 범위

### Feature A: 이메일 중복 발송 방지 (Email Dedup)

| 항목 | 내용 |
|------|------|
| **대상** | 템플릿 자동발송 (`emailTemplateLinks`), AI 자동발송 (`emailAutoPersonalizedLinks`) |
| **로직** | 동일 recipientEmail로 이미 발송(sent) 이력이 있으면 스킵 |
| **설정** | 규칙별 `preventDuplicate` (0/1) On/Off 토글 |
| **범위** | 같은 규칙(linkId) 기준, 전체 기간 (쿨다운과 별개) |

#### DB 변경
```
emailTemplateLinks: + preventDuplicate INTEGER DEFAULT 0
emailAutoPersonalizedLinks: + preventDuplicate INTEGER DEFAULT 0
```

#### 로직 변경
- `email-automation.ts`: `preventDuplicate=1`이면 `emailSendLogs`에서 같은 templateLinkId + recipientEmail 조합으로 sent 이력 체크 → 있으면 스킵
- `auto-personalized-email.ts`: `preventDuplicate=1`이면 같은 linkId + recipientEmail 조합 체크 → 스킵

#### UI 변경
- `EmailTemplateLinkList.tsx`: 규칙 편집 시 "중복 발송 방지" Switch 추가
- `AutoPersonalizedEmailConfig.tsx` (또는 `/email/ai-auto/[id]`): "중복 발송 방지" Switch 추가

### Feature B: 파티션 중복 관리 (Partition Dedup)

| 항목 | 내용 |
|------|------|
| **중복 컬럼 설정** | 기존 `duplicateCheckField` → `duplicateConfig` JSON 확장 |
| **중복 감지 시 액션** | reject(거부) / allow(허용) / merge(병합-기존 덮어쓰기) / delete_old(기존 삭제 후 신규) |
| **행 색상 표시** | 중복 레코드에 배경색 지정 (On/Off + 색상 선택) |

#### DB 변경
```
partitions:
  - duplicateCheckField 유지 (하위호환)
  + duplicateConfig JSONB DEFAULT NULL
    {
      field: string,              // 중복 체크 필드
      action: "reject" | "allow" | "merge" | "delete_old",
      highlightEnabled: boolean,  // 행 색상 표시 여부
      highlightColor: string      // hex color (예: "#FEF3C7")
    }
```

#### 로직 변경
- `POST /api/partitions/[id]/records`: `duplicateConfig` 기반 분기
  - `reject`: 기존과 동일 (409)
  - `allow`: 중복 허용하되 기록
  - `merge`: 기존 레코드 data를 새 data로 업데이트
  - `delete_old`: 기존 삭제 후 새 레코드 삽입
- `POST /api/v1/records` (외부 API): 동일 로직 적용

#### UI 변경
- **파티션 설정**: 중복 필드 선택 + 액션 드롭다운 + 색상 표시 On/Off + 색상 피커
- **RecordTable**: 중복 행에 `highlightColor` 배경색 적용

## 3. 구현 순서

```
Phase 1: Email Dedup (Feature A)
  1-1. Schema: preventDuplicate 컬럼 추가 (2개 테이블)
  1-2. Backend: 중복 체크 로직 (email-automation.ts, auto-personalized-email.ts)
  1-3. API: 규칙 CRUD에 preventDuplicate 반영
  1-4. UI: Switch 토글 추가

Phase 2: Partition Dedup (Feature B)
  2-1. Schema: duplicateConfig 컬럼 추가
  2-2. Backend: 액션별 분기 로직 (records route.ts, v1/records route.ts)
  2-3. API: 파티션 설정 업데이트에 duplicateConfig 반영
  2-4. UI: 파티션 설정 폼 (중복 필드/액션/색상)
  2-5. UI: RecordTable 행 색상 표시
```

## 4. 영향 범위

| 파일 | 변경 내용 |
|------|-----------|
| `src/lib/db/schema.ts` | preventDuplicate 컬럼 2개, duplicateConfig 컬럼 1개 |
| `src/lib/email-automation.ts` | 중복 수신자 체크 함수 추가 |
| `src/lib/auto-personalized-email.ts` | 중복 수신자 체크 함수 추가 |
| `src/app/api/partitions/[id]/records/route.ts` | duplicateConfig 기반 액션 분기 |
| `src/app/api/v1/records/route.ts` | 외부 API 동일 적용 |
| `src/app/api/email/template-links/route.ts` | preventDuplicate 필드 반영 |
| `src/app/api/email/auto-personalized/route.ts` | preventDuplicate 필드 반영 |
| `src/components/email/EmailTemplateLinkList.tsx` | Switch UI |
| `src/components/email/AutoPersonalizedEmailConfig.tsx` 또는 페이지 | Switch UI |
| `src/components/records/RecordTable.tsx` | 행 색상 표시 |
| 파티션 설정 컴포넌트 | 중복 설정 폼 |

## 5. 예상 규모

- **파일 수**: ~12개 수정, ~1개 신규 (파티션 중복 설정 컴포넌트)
- **코드량**: ~400-500 LOC
- **DB 마이그레이션**: ALTER TABLE 3개 (emailTemplateLinks, emailAutoPersonalizedLinks, partitions)
- **위험도**: 낮음 (기존 로직에 조건 추가, 하위호환 유지)
