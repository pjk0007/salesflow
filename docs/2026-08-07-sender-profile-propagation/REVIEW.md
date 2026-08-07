# REVIEW — 2026-08-07-sender-profile-propagation

범위: `git diff` working tree (10 modified) + 신규 4개
판정: 🔴 0 · 🟡 2(수정 완료) · 🟢 3

## 지적 및 조치

### 🔴 → 강등: 템플릿 후속의 서명 규칙 전파 누락 (`email-followup.ts:368`)

리뷰어가 "발신자는 상속하는데 바로 다음 줄 서명은 후보 ID를 안 넘긴다"고 지적. **확인 결과 버그 아님** — `emailTemplateLinks`에는 `signatureId` 컬럼이 없다(`schema.ts` grep: `signatureId`는 `emailAutoPersonalizedLinks:800`에만 존재). 템플릿 규칙은 서명을 지정할 수 없으므로 기본 서명이 맞다.

다만 지적의 취지는 타당했다 — 위아래 두 줄의 처리가 달라 누락으로 읽힌다. **주석 추가로 조치**:
```
// emailTemplateLinks에는 signatureId 컬럼이 없다 — 템플릿 규칙은 서명을 지정할 수 없으므로 기본 서명을 쓴다
```

### 🟡 수정: `"requestedId" in opts` 판정이 무의미 (`email-sender-resolver.ts:75`)

JS `in`은 키 존재만 보므로 `{ requestedId: undefined }`도 `true`다. 즉 이 삼항은 `opts.requestedId`를 그대로 넘기는 것과 동치이고, 주석이 약속한 "키 부재와 null의 구분"을 실제로 수행하지 않았다.

**동작은 옳았다** — `pickSignature`가 `null`/`undefined`를 값으로 이미 3-state 구분하므로 결과가 같다. 버그가 아니라 무의미한 코드 + 잘못된 주석이었고, "값 undefined와 키 부재가 다르게 처리된다"는 오해를 심는 게 더 위험했다.

→ `requestedId: opts.requestedId`로 단순화, 주석을 사실대로 정정.

### 🟡 수정: 기본 행 선택의 순서 보장 상실 (`email-sender-resolver.ts`)

기존 `resolveDefaultSender`는 `where(isDefault=true).limit(1)`(DB가 순서 결정)였는데 전량 조회 후 `find(isDefault)`(JS 배열 순서)로 바뀌었다. `is_default`가 여러 행이면 뽑히는 행이 달라질 수 있다.

**확인**: `psql \d email_sender_profiles` → 인덱스는 pkey뿐, `is_default` partial unique 제약 **없음**. 두 방식 모두 `ORDER BY`가 없어 원래도 비결정적이었으므로 신규 버그는 아니지만 리스크가 실재한다.

→ 두 조회에 `.orderBy(id)` 추가로 결정적으로 고정. 컬럼도 실제 쓰는 3~4개만 명시(`signature` 같은 큰 text를 안 끌어옴).

## 🟢 확인 (이상 없음)

- **org 격리는 오히려 개선** — 리졸버가 `eq(orgId)`로만 조회하고 `preferredIds`는 그 결과 안에서 `find`한다. 타 org id를 넘겨도 후보에 없어 기본값으로 흐른다. 추가로 `test-followup/route.ts`의 `parentLog` 조회에 orgId 필터를 넣어 기존 IDOR성 결함(타 org 로그의 `recordId`가 `recordPreview`로 새어나갈 수 있던 경로)을 수정했다.
- **N+1 없음** — `send/route.ts`는 리졸버 호출이 레코드 루프 바깥이고, `auto-personalized-email.ts`는 규칙 루프 안이지 레코드 루프가 아니다.
- **`pickSignature`의 fallback 비대칭은 의도된 설계** — `requestedId`가 number인데 후보에 없으면 기본 서명으로 흐른다(서명은 fallback해도 오배송 아님). 발신 주소는 반대로 임의 선택을 막아뒀다(`pickSender`가 기본 프로필 없으면 null). 테스트와 주석에 근거가 남아 있다.
- **`any` 없음** — `req.json()`을 명시 타입으로 좁혔고, `auto-personalized-email.ts`의 기존 `as Record<string, unknown>` 캐스팅이 제거되어 타입 안정성이 올라갔다.
- **에러 swallow 없음**, 에러 메시지 한국어 유지, `appendSignature` 순서(치환 → 서명) 정상.
- `.tsx` 렌더 전용 분리, 기존 훅 재사용(바퀴 재발명 없음), 마이그레이션 주석에 FK 미사용·backfill 미실시 근거 명시.

## 이월 (다음 사이클)

- `resolveDefaultSender`/`resolveDefaultSignature` 래퍼 2개는 `email-automation.ts:83,89` 한 곳에서만 쓰인다. 호출부가 1개뿐이라 정리하면 deprecated 표면이 줄어든다. 이번엔 요청 밖 리팩터링이라 보류.
- `email_sender_profiles.is_default`에 partial unique index 추가 검토 — `.orderBy`로 결정성은 확보했으나 근본적으로는 제약이 맞다.

## 수정 후 재검증

| 명령 | 결과 |
|---|---|
| `pnpm test` | 35/35 통과 |
| `npx tsc --noEmit` | 클린 |
| `npm run lint` | `100 problems (44 errors, 56 warnings)` — baseline 동일, 신규 0 |
