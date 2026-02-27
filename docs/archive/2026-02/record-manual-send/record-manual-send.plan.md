# Plan: record-manual-send — 레코드 상세 수동 발송 UI

## 1. 개요

### 배경
현재 알림톡 발송은 RecordToolbar에서 레코드를 체크박스로 선택한 후 일괄 발송하는 방식만 지원한다. 이메일은 별도 `/email` 페이지에서만 발송 가능하다. 개별 레코드의 상세 정보를 확인하면서 바로 발송하는 기능이 없어, 특정 고객에게 빠르게 메시지를 보내기 어렵다.

### 목표
레코드 테이블에서 개별 레코드를 클릭하면 상세 정보를 보여주는 다이얼로그를 열고, 거기서 알림톡/이메일을 직접 발송할 수 있게 한다.

### 범위
- 레코드 상세 다이얼로그 신규 생성
- 이메일 발송 다이얼로그 신규 생성 (알림톡 SendAlimtalkDialog 패턴 동일)
- RecordTable에 행 클릭 이벤트 추가
- RecordToolbar에 이메일 발송 버튼 추가 (일괄)
- 새 API 없음 — 기존 send API (`/api/alimtalk/send`, `/api/email/send`) 재활용

## 2. 기능 요구사항

### FR-01: 레코드 상세 다이얼로그
- 레코드 테이블에서 행 클릭 시 상세 다이얼로그 표시
- 읽기 전용 필드 목록 표시 (통합코드, 모든 커스텀 필드)
- 등록일, 수정일 표시
- 하단 액션 영역: "알림톡 발송", "이메일 발송" 버튼

### FR-02: 이메일 발송 다이얼로그
- SendAlimtalkDialog와 동일한 패턴
- 파티션에 연결된 이메일 템플릿 링크 목록 (Select)
- 선택 시 수신이메일 필드, 제목, 변수 매핑 정보 표시
- 발송 버튼 → 기존 `/api/email/send` 호출
- 발송 결과 (성공/실패) 표시

### FR-03: 상세에서 개별 발송
- 레코드 상세 다이얼로그에서 "알림톡 발송" 클릭 → SendAlimtalkDialog 열림 (recordIds = [현재 레코드])
- "이메일 발송" 클릭 → SendEmailDialog 열림 (recordIds = [현재 레코드])
- 발송 완료 후 다이얼로그 닫기

### FR-04: RecordToolbar 이메일 발송 추가
- 기존 "알림톡 발송" 옆에 "이메일 발송" 버튼 추가
- 레코드 선택 시에만 표시 (현재 알림톡과 동일 패턴)
- 클릭 시 SendEmailDialog 열림 (선택된 recordIds 전달)

### FR-05: RecordTable 행 클릭
- 체크박스/인라인 편집 영역 외 행 클릭 시 상세 다이얼로그 열림
- 체크박스 클릭은 기존 선택 동작 유지
- 인라인 편집 셀 클릭은 기존 편집 동작 유지

## 3. 기술 설계 방향

### 컴포넌트 구조
```
RecordDetailDialog (신규)
├── 레코드 필드 목록 (읽기 전용)
├── 메타 정보 (통합코드, 등록일, 수정일)
└── 액션 버튼: 알림톡 발송 / 이메일 발송
     ├── SendAlimtalkDialog (기존 재활용)
     └── SendEmailDialog (신규 — SendAlimtalkDialog 패턴 동일)
```

### 기존 재활용
- `SendAlimtalkDialog` — 그대로 사용 (recordIds 1건만 전달)
- `useAlimtalkSend` — 기존 훅
- `useEmailSend` — 기존 훅
- `useAlimtalkTemplateLinks` — 기존 훅
- `useEmailTemplateLinks` — 기존 훅
- `/api/alimtalk/send` — 기존 API (이미 recordIds 배열 지원)
- `/api/email/send` — 기존 API (이미 recordIds 배열 지원)

### 이벤트 처리 (FR-05)
RecordTable 행 클릭에서 체크박스/인라인 편집과 충돌하지 않도록:
- TableRow `onClick`에서 이벤트 타겟이 checkbox/input이 아닌 경우에만 상세 열기
- 통합코드 셀 클릭 시 상세 열기 (가장 안전한 클릭 영역)

## 4. 변경 파일 목록

| # | 파일 | 변경 유형 | 설명 |
|---|------|-----------|------|
| 1 | `src/components/records/SendEmailDialog.tsx` | 신규 | 이메일 발송 다이얼로그 |
| 2 | `src/components/records/RecordDetailDialog.tsx` | 신규 | 레코드 상세 다이얼로그 |
| 3 | `src/components/records/RecordTable.tsx` | 수정 | 행 클릭 → 상세 열기 이벤트 |
| 4 | `src/components/records/RecordToolbar.tsx` | 수정 | 이메일 발송 버튼 추가 |
| 5 | `src/pages/records.tsx` | 수정 | 상세/이메일 다이얼로그 상태 관리 |

## 5. 의존성
- 외부 라이브러리 추가 없음
- 기존 DB 스키마 변경 없음
- 기존 send API, SWR 훅 모두 재활용

## 6. 검증 기준
- `npx next build` 성공
- 레코드 행 클릭 시 상세 다이얼로그 표시
- 상세에서 "알림톡 발송" → 템플릿 선택 → 1건 발송 성공
- 상세에서 "이메일 발송" → 템플릿 선택 → 1건 발송 성공
- RecordToolbar에서 복수 선택 → "이메일 발송" → 일괄 발송 성공
- 체크박스 클릭 시 상세 다이얼로그가 열리지 않음
- 인라인 편집 셀 클릭 시 상세 다이얼로그가 열리지 않음
