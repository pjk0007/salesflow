# Plan: 알림톡 템플릿 생성 (Template Creation via NHN Cloud API)

## 개요

NHN Cloud KakaoTalk Bizmessage API를 활용하여 알림톡 템플릿을 직접 등록/수정/삭제하고,
카카오톡 스타일의 실시간 미리보기를 제공하는 기능을 구현한다.

기존에는 NHN Cloud 콘솔에서만 템플릿을 관리했으나,
본 기능 추가로 Sales Manager 앱 내에서 전체 템플릿 라이프사이클을 관리할 수 있다.

> **기존 알림톡 기능(설정, 발신프로필, 발송, 이력)은 구현 완료** 상태이며,
> 본 Plan은 "템플릿 생성/수정/삭제 + 검수요청 + 미리보기" 기능에 집중한다.

---

## 사용자 스토리

| ID | 역할 | 스토리 | 우선순위 |
|----|------|--------|----------|
| US-01 | 관리자 | 발신프로필을 선택하고 새 알림톡 템플릿을 생성할 수 있다 | P0 |
| US-02 | 관리자 | 템플릿 내용을 입력하면서 카카오톡 스타일의 실시간 미리보기를 확인할 수 있다 | P0 |
| US-03 | 관리자 | 메시지 유형(기본/부가정보/채널추가/복합)과 강조 유형(없음/강조표기/이미지)을 선택할 수 있다 | P0 |
| US-04 | 관리자 | 템플릿에 버튼(웹링크/앱링크/봇키워드/배송조회/채널추가 등)을 추가할 수 있다 | P0 |
| US-05 | 관리자 | 템플릿에 빠른 응답(Quick Reply)을 추가할 수 있다 | P1 |
| US-06 | 관리자 | 승인/반려 상태의 기존 템플릿을 수정할 수 있다 | P0 |
| US-07 | 관리자 | 요청/반려 상태의 템플릿을 삭제할 수 있다 | P0 |
| US-08 | 관리자 | 생성한 템플릿을 카카오 검수에 요청할 수 있다 | P0 |
| US-09 | 관리자 | 보안 템플릿(OTP/인증번호) 여부를 설정할 수 있다 | P1 |
| US-10 | 관리자 | 강조 표기형 템플릿의 타이틀/서브타이틀을 설정할 수 있다 | P1 |
| US-11 | 관리자 | 템플릿 카테고리를 선택할 수 있다 | P1 |

---

## 기능 범위

### In-Scope (이번 구현)

| ID | 기능 | 설명 |
|----|------|------|
| F-01 | 템플릿 생성 폼 | NHN Cloud 콘솔과 유사한 템플릿 등록 폼 UI |
| F-02 | 실시간 미리보기 | 카카오톡 메시지 스타일의 실시간 미리보기 (변수 하이라이트 포함) |
| F-03 | 메시지 유형 선택 | BA(기본형), EX(부가정보형), AD(채널추가형), MI(복합형) 선택 |
| F-04 | 강조 유형 선택 | NONE(없음), TEXT(강조표기형), IMAGE(이미지형) 선택 |
| F-05 | 버튼 편집기 | 최대 5개 버튼 추가/편집/삭제 + 타입별 필드 동적 변경 |
| F-06 | 빠른 응답 편집기 | Quick Reply 추가/편집/삭제 |
| F-07 | 템플릿 수정 | 기존 템플릿 수정 (승인/반려 상태만) |
| F-08 | 템플릿 삭제 | 기존 템플릿 삭제 (요청/반려 상태만) |
| F-09 | 검수 요청 | 생성한 템플릿의 카카오 검수 요청 |
| F-10 | 카테고리 선택 | 템플릿 카테고리 조회 및 선택 |
| F-11 | 보안 템플릿 설정 | OTP/인증번호용 보안 플래그 설정 |
| F-12 | 강조 표기형 | 타이틀/서브타이틀 설정 (TEXT emphasize) |
| F-13 | NHN Cloud API Proxy | 템플릿 등록/수정/삭제/검수요청 API Proxy |

### Out-of-Scope (향후)

- IMAGE 강조 유형의 이미지 업로드 (NHN Cloud 이미지 등록 API 별도 필요)
- ITEM_LIST 강조 유형 (아이템 리스트형 - 복잡도 높음, 추후 별도 Plan)
- 템플릿 이미지 관리 (imageUrl, imageName)
- 플러그인 버튼 (P1/P2/P3 - 이미지보안전송/개인정보이용/원클릭결제)
- 발신프로필 그룹별 템플릿 일괄 등록
- 템플릿 반려 시 문의 등록

---

## NHN Cloud API 연동 명세

### 신규 사용 API (v2.3 템플릿 관리)

| 기능 | 메서드 | 경로 |
|------|--------|------|
| 템플릿 카테고리 조회 | GET | `/alimtalk/v2.3/appkeys/{appkey}/template/categories` |
| 템플릿 등록 | POST | `/alimtalk/v2.3/appkeys/{appkey}/senders/{senderKey}/templates` |
| 템플릿 수정 | PUT | `/alimtalk/v2.3/appkeys/{appkey}/senders/{senderKey}/templates/{templateCode}` |
| 템플릿 삭제 | DELETE | `/alimtalk/v2.3/appkeys/{appkey}/senders/{senderKey}/templates/{templateCode}` |
| 템플릿 문의(검수요청) | POST | `/alimtalk/v2.3/appkeys/{appkey}/senders/{senderKey}/templates/{templateCode}/comments` |

### 기존 활용 API

| 기능 | 메서드 | 경로 |
|------|--------|------|
| 템플릿 목록 조회 | GET | `/alimtalk/v2.3/appkeys/{appkey}/senders/{senderKey}/templates` |
| 템플릿 상세 조회 | GET | `/alimtalk/v2.3/appkeys/{appkey}/senders/{senderKey}/templates/{templateCode}` |

### 템플릿 등록 Request Body

> 참고: [docs/nhncloud/alimtalk.html](docs/nhncloud/alimtalk.html) 12419라인~

```typescript
{
  templateCode: string;           // 필수, 최대 20자
  templateName: string;           // 필수, 최대 150자
  templateContent: string;        // 필수, 최대 1300자
  templateMessageType?: string;   // "BA"|"EX"|"AD"|"MI" (default: BA)
  templateEmphasizeType?: string; // "NONE"|"TEXT"|"IMAGE"|"ITEM_LIST" (default: NONE)
  templateExtra?: string;         // 부가정보 (EX/MI 유형 시 필수)
  templateTitle?: string;         // 강조표기 타이틀 (TEXT 시 필수, 최대 50자)
  templateSubtitle?: string;      // 강조표기 서브타이틀 (TEXT 시 필수, 최대 50자)
  templateHeader?: string;        // 헤더 (최대 16자)
  templateItem?: {                // 아이템 리스트
    list: Array<{ title: string; description: string }>; // 최소2, 최대10, title 6자, desc 23자
    summary?: { title: string; description: string };    // title 6자, desc 14자
  };
  templateItemHighlight?: {       // 아이템 하이라이트
    title: string;                // 최대 30자 (섬네일 있으면 21자)
    description: string;          // 최대 19자 (섬네일 있으면 13자)
    imageUrl?: string;            // 섬네일 이미지 주소
  };
  templateRepresentLink?: {       // 대표 링크
    linkMo?: string;              // 모바일 웹 링크 (최대 500자)
    linkPc?: string;              // PC 웹 링크 (최대 500자)
    schemeIos?: string;           // iOS 앱 링크 (최대 500자)
    schemeAndroid?: string;       // Android 앱 링크 (최대 500자)
  };
  templateImageName?: string;     // 이미지명 (IMAGE 시 필수)
  templateImageUrl?: string;      // 이미지 URL (IMAGE 시 필수)
  securityFlag?: boolean;         // 보안 템플릿 여부 (default: false)
  categoryCode?: string;          // 카테고리 코드 (default: 999999)
  buttons?: Array<{               // 최대 5개
    ordering: number;             // 버튼 순서 (1~5)
    type: string;                 // "WL"|"AL"|"DS"|"BK"|"MD"|"BC"|"BT"|"AC"|"BF"|"P1"|"P2"|"P3"|"TN"
    name: string;                 // 버튼명 (최대 14자, 변수 불가)
    linkMo?: string;              // 모바일 링크 (WL 필수, 최대 500자)
    linkPc?: string;              // PC 링크 (WL 선택, 최대 500자)
    schemeIos?: string;           // iOS 앱링크 (AL 필수, 최대 500자)
    schemeAndroid?: string;       // Android 앱링크 (AL 필수, 최대 500자)
    bizFormId?: number;           // 비즈니스폼 ID (BF 필수)
    pluginId?: string;            // 플러그인 ID (최대 24자)
    telNumber?: string;           // 전화번호 (TN 필수)
  }>;
  quickReplies?: Array<{          // 최대 5개
    ordering: number;
    type: string;                 // "WL"|"AL"|"BK"|"BC"|"BT"|"BF"
    name: string;                 // 최대 14자
    linkMo?: string;
    linkPc?: string;
    schemeIos?: string;
    schemeAndroid?: string;
    bizFormId?: number;
  }>;
}
```

### 템플릿 문의(검수요청) Request Body

```typescript
{
  comment: string;  // 필수, 문의 내용
}
```

- 반려 상태의 템플릿에 문의를 남길 경우, 검수 중(REQ) 상태로 변경됨

### 메시지 유형(templateMessageType) 설명

| 코드 | 이름 | 설명 |
|------|------|------|
| BA | 기본형 | 기본 알림톡 (내용 + 버튼) |
| EX | 부가정보형 | 기본 내용 + 부가정보(templateExtra) |
| AD | 채널추가형 | 기본 내용 + 채널 추가 안내 문구 자동 삽입 |
| MI | 복합형 | 기본 내용 + 부가정보 + 채널 추가 안내 |

### 강조 유형(templateEmphasizeType) 설명

| 코드 | 이름 | 설명 |
|------|------|------|
| NONE | 없음 | 기본 형태 |
| TEXT | 강조 표기형 | 타이틀/서브타이틀 강조 표시 |
| IMAGE | 이미지형 | 상단 이미지 포함 (Out-of-Scope) |

### 버튼 타입 설명

| 타입 | 이름 | 필수 필드 | 설명 |
|------|------|-----------|------|
| WL | 웹링크 | linkMo (필수), linkPc (선택) | 모바일/PC 웹페이지 이동 |
| AL | 앱링크 | schemeIos, schemeAndroid | iOS/Android 앱 링크 |
| DS | 배송조회 | - | 택배사 배송조회 |
| BK | 봇키워드 | - | 봇 전환 + 키워드 전달 |
| MD | 메시지전달 | - | 봇 전환 + 메시지 내용 전달 |
| BC | 상담톡 전환 | - | 상담톡으로 전환 |
| BT | 봇 전환 | - | 봇으로 전환 |
| AC | 채널추가 | - | 카카오 채널 추가 (1번 순서만 가능, 이름 "채널 추가" 고정) |
| BF | 비즈니스폼 | bizFormId | 비즈니스폼 연결 |
| TN | 전화하기 | telNumber | 전화 걸기 |

> AD/MI 유형 시 AC 버튼이 첫 번째 순서에 위치해야 함

### 템플릿 상태

| 코드 | 이름 | 수정 가능 | 삭제 가능 | 검수요청 가능 |
|------|------|:---------:|:---------:|:------------:|
| TSC | 생성 | O | O | O |
| REQ | 검수요청 | X | O | X |
| APR | 승인 | O | X | X |
| REJ | 반려 | O | O | O |
| STP | 중단 | X | X | X |
| DRM | 휴면 | X | X | X |

---

## 내부 API 설계 (Next.js Pages Router)

### 신규 API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/alimtalk/templates` | 템플릿 등록 (NHN Cloud Proxy) |
| PUT | `/api/alimtalk/templates/[templateCode]` | 템플릿 수정 (NHN Cloud Proxy) |
| DELETE | `/api/alimtalk/templates/[templateCode]` | 템플릿 삭제 (NHN Cloud Proxy) |
| POST | `/api/alimtalk/templates/[templateCode]/comments` | 검수 요청/문의 (NHN Cloud Proxy) |
| GET | `/api/alimtalk/template-categories` | 템플릿 카테고리 목록 (NHN Cloud Proxy) |

### 기존 API 활용

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/alimtalk/templates?senderKey=xxx` | 템플릿 목록 조회 (기존) |
| GET | `/api/alimtalk/templates/[templateCode]?senderKey=xxx` | 템플릿 상세 조회 (기존) |

---

## UI 구성

### 신규 컴포넌트

| 컴포넌트 | 설명 |
|----------|------|
| `TemplateCreateDialog` | 템플릿 생성/수정 다이얼로그 (2-column: 폼 + 미리보기) |
| `TemplateFormEditor` | 템플릿 폼 (코드/이름/내용/메시지유형/강조유형/보안/카테고리) |
| `TemplatePreview` | 카카오톡 스타일 실시간 미리보기 |
| `ButtonEditor` | 버튼 추가/편집/삭제 + 타입별 필드 동적 변경 |
| `QuickReplyEditor` | 빠른 응답 추가/편집/삭제 |

### 기존 컴포넌트 수정

| 컴포넌트 | 변경 내용 |
|----------|-----------|
| `TemplateList` | "템플릿 등록" 버튼 추가, 수정/삭제/검수요청 액션 추가 |
| `TemplateDetailDialog` | 수정/삭제 버튼 추가 (상태에 따라 활성화) |

### UI 레이아웃 (TemplateCreateDialog)

```
┌─────────────────────────────────────────────────────────────┐
│  템플릿 등록 (또는 수정)                              [X]   │
├──────────────────────────────┬──────────────────────────────┤
│  [폼 영역]                   │  [미리보기 영역]              │
│                              │                              │
│  발신프로필: [Select]         │  ┌──────────────────┐       │
│  템플릿 코드: [Input]         │  │  카카오톡 미리보기  │       │
│  템플릿 이름: [Input]         │  │  ┌──────────────┐ │       │
│  메시지 유형: [Select]        │  │  │  [헤더]       │ │       │
│  강조 유형: [Select]          │  │  │  ────────────  │ │       │
│                              │  │  │  [타이틀]     │ │       │
│  ── 강조 표기 (TEXT 시) ──    │  │  │  [서브타이틀]  │ │       │
│  타이틀: [Input]              │  │  │  ────────────  │ │       │
│  서브타이틀: [Input]           │  │  │  메시지 내용   │ │       │
│                              │  │  │  #{변수} 하이   │ │       │
│  ── 본문 ──                  │  │  │  라이트 표시   │ │       │
│  내용: [Textarea]             │  │  │               │ │       │
│  (글자수: 0/1000)            │  │  │  ────────────  │ │       │
│                              │  │  │  [부가정보]    │ │       │
│  ── 부가정보 (EX/MI 시) ──   │  │  │               │ │       │
│  부가정보: [Textarea]         │  │  │  ┌──────────┐ │ │       │
│                              │  │  │  │ 버튼 1   │ │ │       │
│  ── 보안 ──                  │  │  │  │ 버튼 2   │ │ │       │
│  [x] 보안 템플릿             │  │  │  └──────────┘ │ │       │
│                              │  │  └──────────────┘ │       │
│  ── 버튼 (최대 5개) ──       │  │                    │       │
│  [+ 버튼 추가]               │  │  또는              │       │
│  1. WL | 자세히보기 | URL    │  │  [빠른응답1][빠른2] │       │
│  2. BK | 문의하기   |         │  └──────────────────┘       │
│                              │                              │
│  ── 빠른 응답 (버튼과 택1) ──│                              │
│  [+ 빠른 응답 추가]          │                              │
│                              │                              │
├──────────────────────────────┴──────────────────────────────┤
│                          [취소]  [등록] (또는 [수정])         │
└─────────────────────────────────────────────────────────────┘
```

---

## SWR 훅 설계

### 신규 훅

```typescript
// src/hooks/useAlimtalkTemplateManage.ts
export function useAlimtalkTemplateManage() {
  // 기존 useAlimtalkTemplates의 mutate를 활용하여 목록 갱신
  const createTemplate = async (senderKey: string, data: CreateTemplateData) => Promise<ApiResult>;
  const updateTemplate = async (senderKey: string, templateCode: string, data: UpdateTemplateData) => Promise<ApiResult>;
  const deleteTemplate = async (senderKey: string, templateCode: string) => Promise<ApiResult>;
  const requestInquiry = async (senderKey: string, templateCode: string) => Promise<ApiResult>;

  return { createTemplate, updateTemplate, deleteTemplate, requestInquiry };
}

// src/hooks/useAlimtalkTemplateCategories.ts
export function useAlimtalkTemplateCategories() {
  const { data, isLoading } = useSWR("/api/alimtalk/template-categories", fetcher);
  return { categories: data?.data ?? [], isLoading };
}
```

---

## NHN Cloud API 클라이언트 확장

### `src/lib/nhn-alimtalk.ts`에 추가할 메서드

```typescript
// 기존 NhnAlimtalkClient 클래스에 추가

// 템플릿 카테고리 조회
async getTemplateCategories(): Promise<...>

// 템플릿 등록
async registerTemplate(senderKey: string, data: RegisterTemplateData): Promise<...>

// 템플릿 수정
async updateTemplate(senderKey: string, templateCode: string, data: UpdateTemplateData): Promise<...>

// 템플릿 삭제
async deleteTemplate(senderKey: string, templateCode: string): Promise<...>

// 템플릿 문의(검수요청) — 반려 상태에서 문의 시 REQ로 변경
async commentTemplate(senderKey: string, templateCode: string, comment: string): Promise<...>
```

---

## 구현 순서

### Phase 1: API 기반
1. `nhn-alimtalk.ts` — NHN Cloud 클라이언트에 템플릿 CRUD 메서드 추가
2. `POST /api/alimtalk/templates` — 템플릿 등록 Proxy API
3. `PUT /api/alimtalk/templates/[templateCode]` — 기존 파일에 PUT 핸들러 추가
4. `DELETE /api/alimtalk/templates/[templateCode]` — 기존 파일에 DELETE 핸들러 추가
5. `POST /api/alimtalk/templates/[templateCode]/comments` — 검수 요청/문의 API
6. `GET /api/alimtalk/template-categories` — 카테고리 조회 API

### Phase 2: 미리보기 + 편집기 컴포넌트
7. `TemplatePreview` — 카카오톡 스타일 실시간 미리보기 (기존 TemplateDetailDialog의 미리보기 로직 재활용)
8. `ButtonEditor` — 버튼 추가/편집/삭제 컴포넌트
9. `QuickReplyEditor` — 빠른 응답 편집기

### Phase 3: 메인 폼 + 다이얼로그
10. `TemplateFormEditor` — 템플릿 생성/수정 폼 (모든 필드 + 유효성 검증)
11. `TemplateCreateDialog` — 2-column 레이아웃 다이얼로그 (폼 + 미리보기)
12. `useAlimtalkTemplateManage` — CRUD SWR 훅
13. `useAlimtalkTemplateCategories` — 카테고리 SWR 훅

### Phase 4: 기존 UI 통합 + 상태 관리
14. `TemplateList` — "템플릿 등록" 버튼 추가 + 수정/삭제/검수 액션
15. `TemplateDetailDialog` — 수정/삭제 버튼 추가
16. 상태별 액션 활성화/비활성화 로직

---

## 유효성 검증 규칙

| 필드 | 규칙 |
|------|------|
| templateCode | 필수, 1~20자 |
| templateName | 필수, 1~150자 |
| templateContent | 필수, 1~1300자 (변수/URL/공백 포함) |
| templateMessageType | 선택, BA/EX/AD/MI 중 택1 (default: BA) |
| templateEmphasizeType | 선택, NONE/TEXT/IMAGE/ITEM_LIST 중 택1 (default: NONE) |
| templateTitle | TEXT 강조 시 필수, 최대 50자 |
| templateSubtitle | TEXT 강조 시 필수, 최대 50자 |
| templateExtra | EX/MI 유형 시 필수 |
| buttons | 최대 5개, quickReplies와 동시 사용 불가 |
| quickReplies | 최대 5개, buttons와 동시 사용 불가 |
| buttons[].name | 최대 14자, 변수(#{...}) 사용 불가 |
| buttons[].linkMo | WL 타입 시 필수, http:// 또는 https:// 시작 |
| buttons[].schemeIos | AL 타입 시 필수 |
| buttons[].schemeAndroid | AL 타입 시 필수 |
| AC 버튼 | 1번 순서에만 가능 |

---

## 기술 결정

| 항목 | 결정 | 이유 |
|------|------|------|
| 미리보기 | 클라이언트 사이드 렌더링 | 실시간 반영, API 호출 불필요 |
| 폼 상태 관리 | React 로컬 state | 단일 다이얼로그 내 상태, 별도 라이브러리 불필요 |
| 2-column 레이아웃 | 좌:폼 / 우:미리보기 | NHN Cloud 콘솔과 유사한 UX |
| 버튼/QR 편집 | 토글 방식 (버튼 or 빠른응답) | 카카오 정책: 둘 중 하나만 사용 가능 |
| 수정 모드 | 동일 다이얼로그 재활용 | create/edit mode prop으로 분기 |
| templateCode 생성 | 사용자 직접 입력 | NHN Cloud 정책: 영문+숫자, 중복 불가 |

---

## 의존성

- 기존 알림톡 기능 (NHN Cloud 클라이언트, 설정, 발신프로필)
- 기존 TemplateDetailDialog의 카카오톡 미리보기 UI 패턴
- ShadCN UI 컴포넌트 (Dialog, Select, Input, Textarea, Button, Badge, Tabs)

---

## 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| NHN Cloud 템플릿 등록 API 문서 불완전 | 필드 누락 가능 | 실제 API 호출로 검증, 에러 메시지 표시 |
| 카카오 검수 지연 (영업일 2일) | 템플릿 즉시 사용 불가 | 상태 배지로 검수 진행 상황 표시 |
| 카카오 검수 반려 | 템플릿 수정 필요 | 반려 사유 표시 + 수정 후 재검수 안내 |
| 버튼/QR 동시 사용 불가 정책 | UX 혼란 | 토글 UI로 명확하게 분리 |
| IMAGE 강조 유형 이미지 업로드 | Out-of-Scope | NONE/TEXT만 우선 지원, IMAGE는 추후 |

---

## 성공 기준

- [ ] 새 알림톡 템플릿을 폼에서 생성하고 NHN Cloud에 등록 가능
- [ ] 카카오톡 스타일 미리보기가 실시간으로 반영됨
- [ ] 메시지 유형(BA/EX/AD/MI) 및 강조 유형(NONE/TEXT) 선택 가능
- [ ] 버튼(WL/AL/BK/MD/DS/AC) 추가/편집/삭제 가능
- [ ] 빠른 응답 추가/편집/삭제 가능 (버튼과 상호 배타적)
- [ ] 기존 템플릿 수정 가능 (승인/반려 상태)
- [ ] 기존 템플릿 삭제 가능 (요청/반려 상태)
- [ ] 검수 요청 후 상태가 REQ로 변경됨
- [ ] 유효성 검증이 정확하게 동작
- [ ] TypeScript 빌드 에러 없음
