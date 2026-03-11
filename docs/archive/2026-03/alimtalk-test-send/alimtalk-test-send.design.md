# Design: alimtalk-test-send (알림톡 템플릿 테스트 발송)

## 1. 개요

승인된(TSC03) 알림톡 템플릿에 수신번호와 변수값을 직접 입력하여 테스트 발송하는 기능.
레코드/templateLink 없이 NHN API 직접 호출.

## 2. API: POST /api/alimtalk/test-send

```ts
// Request
{
    senderKey: string;
    templateCode: string;
    recipientNo: string;                    // 수신번호 (01012345678)
    templateParameter?: Record<string, string>;  // { 변수명: 값 } (#{} 제외)
}

// Response
{
    success: boolean;
    data?: { requestId: string; resultCode: number; resultMessage: string };
    error?: string;
}
```

처리:
1. 인증 확인 (getUserFromNextRequest)
2. getAlimtalkClient(orgId) → NhnAlimtalkClient
3. 수신번호 정규화 (숫자만, 하이픈 제거)
4. client.sendMessages({ senderKey, templateCode, recipientList: [{ recipientNo, templateParameter }] })
5. 결과 반환 (로그 테이블에는 기록하지 않음 — 테스트 용도)

## 3. TestSendDialog 컴포넌트

### Props
```ts
interface TestSendDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    senderKey: string;
    templateCode: string;
    templateContent: string;
}
```

### UI 구조
```
┌─ 테스트 발송 ─────────────────────┐
│                                    │
│ 수신번호: [01012345678________]    │
│                                    │
│ ── 변수 입력 ──────────────────    │
│ #{고객명}:   [________________]    │
│ #{금액}:     [________________]    │
│ #{날짜}:     [________________]    │
│                                    │
│ ── 미리보기 ───────────────────    │
│ ┌────────────────────────────┐     │
│ │ 안녕하세요, 홍길동님.       │     │
│ │ 금액: 100,000원            │     │
│ │ 날짜: 2026-03-11           │     │
│ └────────────────────────────┘     │
│                                    │
│           [취소]  [발송]           │
└────────────────────────────────────┘

→ 발송 성공 시:
┌────────────────────────────────────┐
│ ✓ 발송 성공                        │
│ 요청 ID: xxxxx                     │
│                    [확인]          │
└────────────────────────────────────┘
```

### 동작
1. `extractTemplateVariables(templateContent)` 로 변수 목록 추출
2. 변수별 Input 필드 자동 생성 (변수가 없으면 변수 섹션 미표시)
3. 미리보기: templateContent에서 `#{변수명}`을 입력값으로 실시간 치환
4. 발송 버튼: POST /api/alimtalk/test-send 호출
5. 결과: 성공/실패 표시

## 4. TemplateList 수정

### 드롭다운 메뉴에 "테스트 발송" 추가

```tsx
<DropdownMenuItem
    disabled={!isApproved}
    onClick={() => setTestSendTemplate({
        senderKey: selectedSenderKey,
        templateCode: tpl.templateCode,
        templateContent: tpl.templateContent,
    })}
>
    <Send className="h-4 w-4 mr-2" /> 테스트 발송
</DropdownMenuItem>
```

- 승인 상태(TSC03)일 때만 활성
- Send 아이콘은 이미 import됨 (검수 요청에서 사용 중)
- 별도 아이콘 사용: `PlayCircle` 또는 `SendHorizontal`

## 5. 변경 파일 + 구현 순서

| # | 파일 | 작업 |
|---|------|------|
| 1 | `src/app/api/alimtalk/test-send/route.ts` | 테스트 발송 API |
| 2 | `src/components/alimtalk/TestSendDialog.tsx` | 테스트 발송 다이얼로그 |
| 3 | `src/components/alimtalk/TemplateList.tsx` | 드롭다운에 테스트 발송 추가 |
| 4 | 빌드 검증 | `npx next build` |

## 6. 검증
- `npx next build` 성공
- 승인 템플릿 행에서 "테스트 발송" 메뉴 활성
- 변수가 있는 템플릿: 변수 입력 필드 표시 + 미리보기 치환
- 변수가 없는 템플릿: 수신번호만 입력 후 발송
- 유효하지 않은 번호 입력 시 에러
- 발송 성공/실패 결과 표시
