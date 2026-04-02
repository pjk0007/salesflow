# Salesflow (Sendb) - Claude Code Guidelines

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

## 커밋 규칙

- 커밋 전에 사용자에게 확인을 받는다.
- 여러 작업을 모아서 한 번에 커밋해도 된다.
- 커밋 메시지는 한국어로 작성한다.

## 기술 스택

- Next.js 16 (App Router, Turbopack)
- PostgreSQL + Drizzle ORM
- Tailwind CSS 4 + Radix UI
- SWR (데이터 페칭)
- Sonner (토스트)

## API 패턴

- 응답: `{ success: true, data }` 또는 `{ success: false, error: "메시지" }`
- 인증: `getUserFromNextRequest(req)` → `{ userId, orgId, email, name, role }`
- 관리자 체크: `user.role === "member"` 이면 403
- 에러 메시지는 한국어

## DB

- 로컬: `postgresql://jaehun@localhost:5432/salesflow`
- 운영: CloudType (주석 처리된 URL 참고)
- 마이그레이션: `drizzle/` 디렉토리에 SQL, `meta/_journal.json`에 등록
