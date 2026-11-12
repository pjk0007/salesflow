# Salesflow (Sendb) - Claude Code Guidelines

작업 환경·배포 규칙은 먼저 루트 `AGENTS.md`를 따른다. 기준 브랜치는 `main`(운영 배포 브랜치)이다. `dev` 브랜치는 따로 맞춰 두지 않는다.

## 폴더 구조 규칙

### 새로운 기능 또는 기존 기능 수정 시 반드시 아래 구조를 따를 것

```
src/components/{feature-name}/
├── ui/             # UI 컴포넌트
├── hooks/          # 커스텀 훅 (SWR, 상태 등)
├── api/            # API 호출 함수 (fetch wrapper)
├── contexts/       # React Context (필요 시)
├── types/          # 타입 정의
└── utils/          # 유틸리티 함수 (필요 시)
```

- `app/{route}/page.tsx`는 **조립만** 한다. 비즈니스 로직, 상태 관리, API 호출을 직접 하지 않는다.
- 기존 코드를 수정할 때도 가능하면 위 구조로 리팩토링한다.
- 공통 UI 컴포넌트는 `src/components/ui/`에 유지한다.

## 코드 작성 규칙

- 새 유틸/훅/컴포넌트를 만들기 전에 기존에 같은 역할을 하는 게 있는지 먼저 확인한다.
- 있으면 그걸 쓴다. 없을 때만 새로 만든다.
- 중복 코드를 만들지 않는다.

## UI 규칙

- 버튼·입력창·셀렉트 높이는 `h-9`(36px)로 통일한다. `Button`의 `default`/`sm`, `Input`, `SelectTrigger`는 모두 h-9다.
- 한 줄에 같이 놓이는 버튼·입력창·셀렉트에 높이 클래스(`h-8`, `h-10` 등)를 따로 붙이지 않는다. 더 작은 컨트롤이 꼭 필요하면 `size="xs"`/`"icon-xs"`를 쓰고 같은 줄의 다른 컨트롤도 맞춘다.
- 정사각 아이콘 버튼은 `size="icon"`(36px) 계열을 쓴다.
- 브라우저 기본 UI를 쓰지 않는다. 날짜는 `<input type="date">` 대신 `DatePicker`(`src/components/ui/date-picker.tsx`, 달력 팝오버), 선택은 `<select>` 대신 `Select` 또는 `DropdownMenu`, 확인창은 `window.confirm`/`alert` 대신 `AlertDialog`·`AsyncAlertDialog`를 쓴다. 디자인된 컴포넌트가 없으면 `src/components/ui/`에 먼저 만들고 쓴다.
- 입력창 안의 작은 도구 버튼(종류 선택·날짜 지정 등)은 genius-hub-erp처럼 테두리 없는 `h-7 px-2 text-xs hover:bg-accent` 트리거 + 디자인된 드롭다운/달력으로 만든다.
- 카드·패널에는 그림자를 넣지 않는다. 테두리는 아주 연하게(`border-border/40`)만 쓰고, 바탕색 차이(페이지 옅은 회색 + 카드 흰색)로 구분한다. 라운드는 `rounded-lg` 이하로 쓴다 (`rounded-xl`·`rounded-2xl` 금지).
- 카드 테두리는 `border-border/40`, 테두리 버튼(`variant="outline"`)·입력창·셀렉트·텍스트영역은 `border-border/70`으로 같은 진하기(한 줄에 놓일 때 높이가 같아 보이게). 그림자 없음. 필터처럼 값을 고르면 옆에 "초기화" 버튼을 둔다.
- 모달은 머리·아래 버튼을 고정하고 가운데만 스크롤한다(`flex flex-col p-0` + 본문 `overflow-y-auto scrollbar-thin`). 스크롤바가 창 둥근 모서리 밖으로 나가지 않게 한다.
- 누를 수 있는 것(버튼·링크·탭·메뉴·행 클릭)에는 손가락 커서가 나와야 한다. 버튼·role 요소는 globals.css에서 자동, `div`·`tr`에 onClick을 달면 `cursor-pointer`를 붙인다.
- 담당자·사업부처럼 칸 안에서 고르는 선택은 테두리 없이 두고, 마우스를 올렸을 때만 연회색(`hover:bg-muted`) 바탕을 보인다.
- 바로 저장하는 글 칸(메모·요약·댓글 등)은 Enter로 저장, Shift+Enter로 줄바꿈한다. 한글 조합 중 Enter(`isComposing`)는 무시한다.
- 삭제처럼 되돌릴 수 없는 확인 버튼은 `variant="destructive"`(빨간색)를 쓴다. `AlertDialogAction`에 `bg-destructive` 클래스를 붙이지 말고 `variant`로 지정한다.

## 커밋 규칙

- 커밋 전에 사용자에게 확인을 받는다.
- 여러 작업을 모아서 한 번에 커밋해도 된다.
- 커밋 메시지는 한국어로 작성한다.

## 기술 스택

- Next.js 16 (App Router, Turbopack)
- PostgreSQL + Drizzle ORM (마이그레이션: `drizzle/`에 SQL, `meta/_journal.json`에 등록)
- Tailwind CSS 4 + Radix UI
- SWR (데이터 페칭)
- Sonner (토스트)

## API 패턴

- 응답: `{ success: true, data }` 또는 `{ success: false, error: "메시지" }`
- 인증: `getUserFromNextRequest(req)` → `{ userId, orgId, email, name, role }`
- 관리자 체크: `user.role === "member"` 이면 403
- 에러 메시지는 한국어
