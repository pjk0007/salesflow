# Plan: alimtalk-link-management — 알림톡 연결 관리 UI

## 1. 개요

### 배경
이메일 페이지에는 "연결 관리" 탭이 있어 파티션별로 템플릿-레코드 연결을 관리할 수 있다 (이름, 템플릿 선택, 수신 필드, 변수 매핑, 발송 방식, 조건, 반복 설정). 알림톡에는 동일한 백엔드 인프라(DB 테이블, API, SWR 훅)가 이미 구현되어 있지만, UI가 없어서 사용자가 연결을 직접 관리할 수 없다.

### 기존 인프라 (이미 구현 완료)
- **DB**: `alimtalk_template_links` 테이블 — partitionId, name, senderKey, templateCode, templateName, triggerType, triggerCondition, repeatConfig, recipientField, variableMappings, isActive
- **API**: `GET/POST /api/alimtalk/template-links` + `PUT/DELETE /api/alimtalk/template-links/[id]`
- **SWR 훅**: `useAlimtalkTemplateLinks(partitionId)` — templateLinks, createLink, updateLink, deleteLink
- **공유 컴포넌트**: `TriggerConditionForm`, `RepeatConfigForm` (이메일과 공유)

### 이메일 참고 구현
- **리스트**: `EmailTemplateLinkList.tsx` — 파티션 선택 + 테이블 (이름, 수신 필드, 발송 방식, 상태, 작업)
- **다이얼로그**: `EmailTemplateLinkDialog.tsx` — 연결 이름, 템플릿 선택, 수신 필드, 변수 매핑, 발송 방식, 조건/반복 설정
- **페이지**: `email.tsx` — "연결 관리" 탭 (`links`)

### 목표
이메일과 동일한 구조의 "연결 관리" 탭을 알림톡 페이지에 추가한다.

### 범위
- `AlimtalkTemplateLinkList.tsx` 신규 — 연결 목록 + 파티션 선택
- `AlimtalkTemplateLinkDialog.tsx` 신규 — 연결 생성/편집 다이얼로그
- `alimtalk.tsx` 수정 — "연결 관리" 탭 추가

### 범위 제외
- DB 스키마 변경 없음 (이미 존재)
- API 변경 없음 (이미 존재)
- SWR 훅 변경 없음 (이미 존재)
- `TriggerConditionForm`, `RepeatConfigForm` 변경 없음 (공유 컴포넌트)

## 2. 기능 요구사항

### FR-01: 알림톡 연결 목록 (AlimtalkTemplateLinkList)
- 파티션 선택 드롭다운 (이메일과 동일)
- 테이블 컬럼: 이름, 수신 필드, 발송 방식(수동/생성 시/수정 시 Badge), 상태(활성/비활성 Badge), 작업(편집/삭제)
- "새 연결" 버튼 → 다이얼로그 열기
- 편집/삭제 행 액션
- 빈 상태: "등록된 연결이 없습니다."

### FR-02: 알림톡 연결 다이얼로그 (AlimtalkTemplateLinkDialog)
- 연결 이름 (Input)
- 발신프로필 선택 (senderKey — useAlimtalkSenders 활용)
- 템플릿 선택 (templateCode — useAlimtalkTemplates 활용)
- 수신 필드 (Input)
- 변수 매핑: 선택된 템플릿의 변수 → 필드명 매핑
- 자동 발송 설정: 발송 방식(triggerType), 조건(TriggerConditionForm), 반복(RepeatConfigForm)
- 생성/수정 모드 지원

### FR-03: 알림톡 페이지 탭 추가
- `/alimtalk` 페이지에 "연결 관리" 탭 추가
- 탭 순서: 대시보드 → 발신프로필 → 템플릿 → **연결 관리** → 발송 이력 → 설정

## 3. 기술 설계 방향

### 이메일과의 차이점
| 항목 | 이메일 | 알림톡 |
|------|--------|--------|
| 템플릿 선택 | emailTemplateId (DB 내부) | templateCode (NHN Cloud) |
| 발신자 | 설정에서 고정 (fromEmail) | senderKey 선택 필요 |
| 변수 추출 | `extractEmailVariables()` | 템플릿 body에서 `#{변수명}` 추출 |
| 수신 필드 | email 필드 | phone 필드 |

### 변수 추출
알림톡 템플릿 body에서 `#{변수명}` 패턴을 추출하여 변수 매핑 UI 표시

### 컴포넌트 구조
```
AlimtalkTemplateLinkList (리스트)
  ├── 파티션 Select
  ├── Table (연결 목록)
  └── AlimtalkTemplateLinkDialog (생성/편집)
        ├── 연결 이름 Input
        ├── 발신프로필 Select (useAlimtalkSenders)
        ├── 템플릿 Select (useAlimtalkTemplates)
        ├── 수신 필드 Input
        ├── 변수 매핑 (동적)
        ├── 발송 방식 Select
        ├── TriggerConditionForm (공유)
        └── RepeatConfigForm (공유)
```

## 4. 변경 파일 목록

| # | 파일 | 변경 유형 | 설명 |
|---|------|-----------|------|
| 1 | `src/components/alimtalk/AlimtalkTemplateLinkList.tsx` | 신규 | 연결 목록 컴포넌트 |
| 2 | `src/components/alimtalk/AlimtalkTemplateLinkDialog.tsx` | 신규 | 연결 생성/편집 다이얼로그 |
| 3 | `src/pages/alimtalk.tsx` | 수정 | "연결 관리" 탭 추가 |

## 5. 의존성
- 신규 패키지 없음
- DB 스키마 변경 없음
- API 변경 없음
- 기존 훅 활용: `useAlimtalkTemplateLinks`, `useAlimtalkSenders`, `useAlimtalkTemplates`
- 기존 공유 컴포넌트: `TriggerConditionForm`, `RepeatConfigForm`

## 6. 검증 기준
- 알림톡 페이지에 "연결 관리" 탭 표시
- 파티션 선택 후 해당 파티션의 연결 목록 표시
- 새 연결 생성: 발신프로필/템플릿/수신필드/변수매핑/발송방식 설정 가능
- 연결 편집: 기존 값 로드 + 수정 저장
- 연결 삭제: 확인 후 삭제
- 자동 발송 설정 (조건/반복) 동작
- `npx next build` 성공
