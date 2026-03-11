# Design: alimtalk-template-sync (알림톡 템플릿 NHN API 완전 동기화)

## 1. 개요

NHN Cloud 알림톡 API가 지원하지만 현재 UI에서 누락된 4개 기능을 추가한다.
API route는 이미 `NhnRegisterTemplateRequest` spread 방식이라 UI → state → payload만 확장하면 된다.

## 2. TemplateFormState 확장

```ts
// 기존 TemplateFormState에 추가
export interface TemplateFormState {
    // ... 기존 13개 필드 ...

    // 신규 4개
    templateImageName: string;       // IMAGE 강조 시 이미지 파일명
    templateImageUrl: string;        // IMAGE 강조 시 이미지 URL
    templateItem: {                  // ITEM_LIST 강조 시
        list: Array<{ title: string; description: string }>;
        summary?: { title: string; description: string };
    } | null;
    templateItemHighlight: {         // ITEM_LIST 강조 시
        title: string;
        description: string;
        imageUrl?: string;
    } | null;
    templateRepresentLink: {         // 모든 템플릿
        linkMo: string;
        linkPc: string;
        schemeIos: string;
        schemeAndroid: string;
    } | null;
}
```

## 3. TemplateFormEditor UI 추가

### 3-1. IMAGE 강조 (templateEmphasizeType === "IMAGE")

TEXT 강조 영역과 동일 위치에 조건부 표시:
```
┌─ 이미지 강조 ──────────────────┐
│ 이미지 URL:  [________________] │
│ 파일명:      [________________] │
└────────────────────────────────┘
```
- `templateImageUrl`: Input (placeholder: "이미지 URL")
- `templateImageName`: Input (placeholder: "파일명")

### 3-2. ITEM_LIST 강조 (templateEmphasizeType === "ITEM_LIST")

TEXT 강조 영역과 동일 위치에 조건부 표시:

**아이템 하이라이트:**
```
┌─ 아이템 하이라이트 ────────────┐
│ 제목:    [__________] (max 30) │
│ 설명:    [__________] (max 19) │
│ 이미지:  [__________] (선택)   │
└────────────────────────────────┘
```

**아이템 리스트:**
```
┌─ 아이템 리스트 ────────────────┐
│ [제목] [설명]           [삭제] │
│ [제목] [설명]           [삭제] │
│ [+ 항목 추가] (2~10개)        │
│                                │
│ 요약 제목: [______] (max 6)   │
│ 요약 설명: [______] (max 14)  │
└────────────────────────────────┘
```

### 3-3. 대표 링크 (모든 템플릿)

카테고리 아래, 상호작용 위에 배치:
```
┌─ 대표 링크 (선택) ────────────┐
│ 모바일 웹:   [_______________] │
│ PC 웹:       [_______________] │
│ iOS 앱:      [_______________] │
│ Android 앱:  [_______________] │
└────────────────────────────────┘
```
4개 모두 비어있으면 payload에서 제외.

## 4. 페이지 payload 확장

`new/page.tsx`와 `[templateCode]/page.tsx`의 payload 구성에 추가:

```ts
const payload = {
    // ... 기존 필드 ...
    ...(form.templateImageUrl && { templateImageName: form.templateImageName, templateImageUrl: form.templateImageUrl }),
    ...(form.templateItem && { templateItem: form.templateItem }),
    ...(form.templateItemHighlight && { templateItemHighlight: form.templateItemHighlight }),
    ...(hasRepresentLink && { templateRepresentLink: form.templateRepresentLink }),
};
```

## 5. 편집 페이지 데이터 로드

`[templateCode]/page.tsx`에서 기존 템플릿 조회 시 새 필드도 form state에 매핑:

```ts
templateImageName: template.templateImageName || "",
templateImageUrl: template.templateImageUrl || "",
templateItem: template.templateItem || null,
templateItemHighlight: template.templateItemHighlight || null,
templateRepresentLink: template.templateRepresentLink || null,
```

## 6. 변경 파일 + 구현 순서

| # | 파일 | 작업 |
|---|------|------|
| 1 | `src/components/alimtalk/TemplateFormEditor.tsx` | TemplateFormState 확장 + 4개 UI 섹션 추가 |
| 2 | `src/app/alimtalk/templates/new/page.tsx` | 초기값 + payload 확장 |
| 3 | `src/app/alimtalk/templates/[templateCode]/page.tsx` | 로드 매핑 + payload 확장 |
| 4 | 빌드 검증 | `npx next build` |

API route(`route.ts`, `[templateCode]/route.ts`)는 이미 spread 방식이라 변경 불필요.
`nhn-alimtalk.ts` 인터페이스도 이미 정의 완료.

## 7. 검증
- `npx next build` 성공
- IMAGE 강조 선택 시 이미지 URL/파일명 입력 필드 표시
- ITEM_LIST 강조 선택 시 하이라이트 + 아이템 리스트 편집 UI 표시
- 대표 링크 입력 가능
- 기존 템플릿 수정 시 새 필드 정상 로드
- NHN API에 새 필드 정상 전달 (브라우저 Network 탭 확인)
