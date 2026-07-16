# SPEC — 이메일 에셋(이미지) 관리

## 목표

이메일 CRM 발송 시 HTML 본문에 넣을 이미지를 워크스페이스 단위로 업로드·재사용한다.
지금은 알림톡 업로드(`/api/upload`, `alimtalk/` 경로 고정)를 빌려 쓰고 URL을 수동 복붙해야
한다. 이메일 전용 에셋 저장소와 관리 페이지를 만들고, AI 자동발송 규칙에 에셋을 지정하면
그 이미지 URL을 프롬프트에 실어 AI가 생성 HTML에 `<img src>`로 넣도록 한다(기존 `ctaUrl`
패턴 확장, vision 분석은 하지 않음).

## 결정 사항 (인터뷰 확정)

- 메타데이터: **이름만** (파일명 자동 + 수정 가능한 이름 1개)
- AI 규칙당 에셋: **여러 개** — 프롬프트에 URL 목록으로 전달, AI가 배치 판단
- 삭제: **DB(목록)에서만 제거, R2 파일은 유지** — 이미 발송된 메일의 `<img>`가 깨지지 않게
- 업로드 경로: **`email/{workspaceId}/{random}.{ext}`**
- 범위: **워크스페이스별 공유** (한 워크스페이스 팀원끼리 재사용)

## 건드릴 파일

### DB
- `src/lib/db/schema.ts` — `emailAssets` 테이블 추가, `emailAutoPersonalizedLinks`에 `assetIds jsonb` 추가
- `drizzle/0061_email_assets.sql` — 신규 마이그레이션
- `drizzle/meta/_journal.json` — 등록

### API
- `src/app/api/email/assets/route.ts` — `GET`(워크스페이스별 목록), `POST`(업로드)
- `src/app/api/email/assets/[id]/route.ts` — `PATCH`(이름 수정), `DELETE`(목록에서 제거)
- `src/lib/r2.ts` — 변경 없음(재사용). 단 업로드 라우트에서 `key`를 `email/{workspaceId}/…`로 생성

### 컴포넌트 (feature 구조)
- `src/components/email/assets/types/index.ts`
- `src/components/email/assets/api/assets.ts` — fetch wrapper
- `src/components/email/assets/hooks/useEmailAssets.ts` — 목록/업로드/삭제 상태
- `src/components/email/assets/ui/AssetManager.tsx` — 관리 뷰(그리드, 업로드, URL 복사, 삭제)
- `src/components/email/assets/ui/AssetPicker.tsx` — **재사용 피커 모달**. 에셋 그리드에서
  하나 이상 선택 → 선택된 URL/id를 콜백으로 반환. AI 규칙 편집·(향후)템플릿 에디터가 공용
- `src/app/email/page.tsx` — "에셋" 탭 추가 (조립만)

### AI 연동
- `src/lib/ai/email.ts` — `generateEmail` 입력에 `assetUrls?: string[]` 추가, 프롬프트에 규칙 삽입
- `src/lib/auto-personalized-email.ts` — 규칙의 `assetIds`로 에셋 URL 조회 → `generateEmail`에 전달
- `src/app/email/ai-auto/new/page.tsx`, `src/app/email/ai-auto/[id]/page.tsx` — 규칙 편집에 `AssetPicker`로 에셋 선택, 선택된 썸네일 표시 + 해제
- `src/app/api/email/auto-personalized/route.ts`, `[id]/route.ts` — `assetIds` 저장
- `src/hooks/useAutoPersonalizedEmail.ts` — 타입에 `assetIds` 추가

## 데이터 / 타입

### emailAssets 테이블
```
id            serial PK
org_id        uuid  NOT NULL → organizations (cascade)
workspace_id  integer NOT NULL → workspaces (cascade)
name          varchar(200) NOT NULL      -- 표시 이름(초기값=파일명)
url           varchar(500) NOT NULL       -- R2 공개 URL
r2_key        varchar(300) NOT NULL       -- email/{workspaceId}/{random}.{ext}
content_type  varchar(50)  NOT NULL
size          integer      NOT NULL       -- bytes
created_at    timestamptz  NOT NULL default now()

INDEX (workspace_id)
```

### emailAutoPersonalizedLinks 확장
```
asset_ids  jsonb  -- number[] (에셋 id 목록). null/[] 이면 이미지 없음
```

### 업로드 제약 (기존 /api/upload와 동일)
- 포맷: `image/jpeg | png | gif | webp`
- 용량: 5MB 이하

## 동작 (behavior) — 테스트 가능한 단위

**업로드**
1. `POST /api/email/assets` (multipart, `workspaceId` + `file`) — 인증 필요, 워크스페이스 접근 권한 확인
2. 포맷·용량 검증 실패 시 400
3. `key = email/{workspaceId}/{randomHex}.{ext}` 로 R2 업로드
4. `emailAssets` INSERT (name=파일명), 생성된 레코드 반환

**목록**
5. `GET /api/email/assets?workspaceId=` — 해당 워크스페이스 에셋만, 최신순

**이름 수정 / 삭제**
6. `PATCH /api/email/assets/[id]` `{ name }` — 소유 org 확인 후 name 갱신
7. `DELETE /api/email/assets/[id]` — DB row만 삭제, **R2 파일은 남긴다**(이미 발송된 메일 보호)

**AI 연동**
8. 규칙에 `assetIds` 저장/수정 가능
9. `runAutoPersonalizedEmail`이 규칙의 `assetIds`로 `emailAssets`에서 URL 조회
10. `generateEmail`에 `assetUrls` 전달 → 프롬프트에 `[이미지 에셋]` 블록으로 URL 목록 삽입,
    "본문에 `<img src>`로 자연스럽게 배치, URL은 그대로 사용" 규칙 명시 (ctaUrl 패턴과 동일한 톤)
11. `assetUrls`가 비면 프롬프트에 아무것도 추가하지 않음(기존 동작 불변)

**관리 페이지**
12. 이메일 페이지에 "에셋" 탭 — 그리드(썸네일 + 이름), 업로드 버튼, 각 항목에 URL 복사·삭제
13. URL 복사 시 클립보드에 공개 URL — 운영자가 HTML 직접 작성할 때 붙여넣기용

**에셋 피커 (재사용)**
14. `AssetPicker` — 그리드에서 에셋을 하나 이상 클릭 선택 → 선택된 `{id, url}[]`을 콜백 반환
15. AI 규칙 편집이 이 피커로 `assetIds`를 채운다. 선택된 에셋은 썸네일로 표시하고 개별 해제 가능
16. 같은 피커를 URL 삽입 용도로도 쓸 수 있게 설계(선택 결과가 id와 url 둘 다 포함)

## 범위 밖 (이번에 안 함)

- 이미지 vision 분석 (URL만 전달, AI가 이미지 내용을 보지는 않음)
- 이미지 리사이즈/최적화/썸네일 생성 (원본 그대로, `<img>`가 브라우저에서 축소)
- 템플릿 에디터(비-AI)의 이미지 업로드 버튼 — 별개 작업. 지금은 URL 복붙으로 커버
- 알림톡 업로드(`/api/upload`) 변경 — 그대로 둠
- 태그·폴더·검색 — 이름만
- 에셋 사용처 추적("이 이미지 어디서 쓰나") — 안 함
- R2 orphan 파일 정리(cron) — 삭제 시 파일 유지가 정책이므로 별도

## E2E 검증

1. dev 서버 + 로컬 DB, 마이그레이션 적용
2. `POST /api/email/assets`로 PNG 업로드 → R2 URL 반환, 브라우저에서 그 URL 이미지 뜨는지
3. key가 `email/{workspaceId}/…` 형태인지 DB에서 확인
4. `GET`으로 워크스페이스별 목록 격리 확인(다른 워크스페이스 에셋 안 나옴)
5. `DELETE` 후 목록에서 빠지되 R2 URL은 여전히 살아있는지(직접 접근)
6. AI 규칙에 assetIds 지정 → 테스트 발송 → 생성된 HTML에 `<img src="{에셋URL}">` 포함 확인
7. assetIds 없는 규칙은 이미지 없이 정상 생성(기존 동작 불변)

## 완료 기준 (DoD)

- [ ] `tsc --noEmit` 통과, 신규 파일 eslint 통과
- [ ] 마이그레이션 로컬 적용 + drizzle 기록 정합
- [ ] 업로드→목록→삭제 워크스페이스 격리 검증
- [ ] 삭제 후 R2 파일 유지 검증
- [ ] AI 규칙 assetIds → 생성 HTML에 img 삽입 검증
- [ ] page.tsx는 조립만, .tsx에 로직 없음(훅/유틸 분리)
