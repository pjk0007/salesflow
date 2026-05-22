# Design: visitor-record-rematch (방문자-레코드 양방향 자동 연결)

> 작성일: 2026-05-21
> Phase: Design
> Plan: [visitor-record-rematch.plan.md](../../01-plan/features/visitor-record-rematch.plan.md)

## 1. 근본 원인 & 해결 방향

### 근본 원인
매칭이 **단방향 + 일회성**이다.
- visitor `identify`가 호출될 때만 record를 찾는다 (`identify/route.ts`).
- 그 순간 record가 없으면(가입이 늦으면) 실패하고, **식별자(user_id)를 visitor에 저장하지 않고 버린다** → 이후 record가 생겨도 visitor를 되찾을 키가 없다.

### 해결 방향 (근본)
**visitor가 자기 식별자를 들고 있게 만들어 양방향 매칭을 가능하게 한다.**

| 방향 | 시점 | 키 |
|------|------|-----|
| visitor → record | identify 수신 | matchField(있으면) → email |
| **record → visitor (신규)** | record 생성/갱신 | **matchField(있으면) → email** |

핵심 규칙(양방향 공통, **이미 identify에 존재하는 정책 그대로**):
> **사이트에 `matchField`가 지정돼 있으면 그 값으로, 없으면 email(기본)으로 매칭한다.**
> phone은 자동 매칭에 쓰지 않는다(오연결 방지).

- 디하: `site.matchField = "uuid"` → uuid로 정확 매칭 (이메일 우연 충돌 회피)
- 백오피스랩/픽셀앤로직: `matchField` 없음 → email 매칭
- 외부 고객사: 자기 matchField 지정 시 자동 적용 — **제품·필드명 하드코딩 없음**

## 2. 변경 구성요소

### 2-1. [DB] `tracker_visitors.match_value` 컬럼 추가
visitor가 식별된 matchField **값**을 저장 (범용 — 디하는 uuid 값, 다른 데는 NULL).
```
match_value varchar(200) NULL   -- site.matchField에 대응하는 값 (예: record.data.uuid 값)
+ index (site_id, match_value)
```
- 마이그레이션: `drizzle/0051_tracker_visitor_match_value.sql` + `meta/_journal.json` 등록.
- schema.ts `trackerVisitors`에 `matchValue: varchar("match_value", {length: 200})` 추가.
- 운영/로컬 동일 적용 (instrumentation.ts 자동 적용).

> visitor 식별 키는 `match_value`(신뢰) + `email`(기본) 두 가지로 일원화. phone은 매칭 비대상.

### 2-2. [identify 수정] user_id를 match_value에 저장
`src/app/api/tracker/identify/route.ts` 의 visitor update에 `matchValue` 저장 추가.
```ts
.set({
    recordId,
    matchValue: user_id ?? visitor.matchValue,   // ← 추가: 식별자 보존
    email: email ?? visitor.email,
    name: name ?? visitor.name,
    phone: phone ?? visitor.phone,
    updatedAt: new Date(),
})
```
- `user_id`는 site.matchField에 대응하는 값(외부 계약). 이제 버리지 않고 저장 → 역매칭 키로 재사용.
- **외부 페이로드 스펙 불변** (identify는 이미 user_id를 받음). 고객사 스크립트 무수정.

### 2-3. [신규 함수] `rematchVisitorsByRecord`
**위치**: `src/lib/tracker/match-record.ts`
```ts
/**
 * record 기준 역매칭. 같은 워크스페이스의 미연결(record_id IS NULL) visitor를
 * site.matchField 값(신뢰) 또는 email(기본)로 찾아 record에 연결한다.
 * visitorId 비의존 · 제품 무관 · phone 제외 · 멱등.
 */
export async function rematchVisitorsByRecord(input: {
    orgId: string;
    workspaceId: number;
    recordId: number;
    data: Record<string, unknown>;   // record.data
}): Promise<{ linked: number }>;
```
**동작**:
1. 같은 workspace의 활성 `tracker_sites` 조회.
2. site별 매칭:
   - **(우선) matchField**: `site.matchField` 있고 `data[site.matchField]` 있으면 → 그 값과 `tracker_visitors.match_value` 일치 + `record_id IS NULL` visitor 조회. (식별자는 고유 → 충돌 없음)
   - **(기본) email**: matchField 없거나 record에 그 값이 없으면 → `lower(email)` 일치 + `record_id IS NULL` visitor. **단, 같은 workspace에 그 email을 가진 record가 2건 이상이면 매칭 스킵**(어느 record인지 모호 → 오연결 방지).
3. 매칭된 visitor 각각:
   - `tracker_visitors.record_id = recordId` (NULL인 것만)
   - `match_value` 비어있으면 matchField 값으로 채움(선택, 보강)
   - `visitor_record_links` 누적 (`source: "record_rematch"`, onConflictDoNothing)
4. 반환 `{ linked }`.

> **시간근접 가드는 쓰지 않는다.** 트래픽이 많으면 시간 윈도우 안에 같은 이메일 타인이 들 확률이 오히려 커지고 정상 케이스도 시점 어긋나면 놓친다.
> 대신 email 충돌은 **신뢰도로 차단**한다: ① matchField 사이트는 식별자 우선이라 email 자체를 안 씀(충돌 없음). ② matchField 없는 사이트는 email이 **record 1:1일 때만** 연결, 중복이면 스킵.

### 2-4. [호출] v1 records 3개 핸들러 (fire-after-commit)
record 확정 직후 비동기 호출(await 안 함, 에러 catch+log). `dispatchAutoTriggers`와 동일 패턴.

| 파일 | 위치 |
|------|------|
| `src/app/api/v1/records/route.ts` | POST — 신규 생성 후 / merge 후 |
| `src/app/api/v1/records/[id]/route.ts` | PUT — 갱신 후 |
| `src/app/api/v1/records/[id]/events/route.ts` | POST — 이벤트(signup 등) 후 |

```ts
rematchVisitorsByRecord({
    orgId: tokenInfo.orgId,
    workspaceId: partition.workspaceId,
    recordId: result.record.id,
    data: result.record.data as Record<string, unknown>,
}).catch((err) => console.error("rematchVisitorsByRecord error:", err));
```

### 2-5. [과거분 backfill] 운영 1회성 (코드 미포함)
이미 들어온 미연결 visitor는 `match_value`가 비어있음(저장 전 생성) → **email로만** 정리.
- dry-run: workspace 격리 + `lower(email)` **1:1**(email→record, record→email 모두 단일) 검토.
- email이 여러 record에 매칭되면 스킵(수동 판단). 시간근접 조건 없음.
- 대상 규모(운영): 디하 14, 백오피스랩 1 (email 보유 미연결).

## 3. 우선순위/충돌 정리

| 사이트 | matchField | 신규 역매칭 키 | 충돌 위험 |
|--------|-----------|----------------|-----------|
| 디하 | uuid | match_value(uuid) → 정확 | 없음 (식별자 고유) |
| 백오피스랩 | 없음 | email (record 1:1일 때만) | 낮음 (중복이면 스킵) |
| 픽셀앤로직 | 없음 | email (record 1:1일 때만) | 낮음 (중복이면 스킵) |

email 충돌 시나리오(타인이 같은 이메일)는 **matchField 사이트(디하)에선 애초에 uuid가 우선**이라 해당 없음. matchField 없는 사이트는 email record가 1:1일 때만 연결(중복이면 스킵)해 차단.

## 4. 데이터 흐름 (디하 카카오 가입 예)

```
[방문/로그인 시도] identify({ visitor_id, user_id:"kakao-49..", email:"x@x.com" })
   → record 아직 없음 → recordId=NULL, 단 match_value="kakao-49.." 저장 ✅ (근본 변경)
   ↓ (41초 후)
[가입] POST /api/v1/records (data.uuid="kakao-49..", data.email="x@x.com")
   ↓ tx commit
[역매칭] rematchVisitorsByRecord
   → site.matchField="uuid", data.uuid="kakao-49.."
   → match_value="kakao-49.." & record_id IS NULL visitor 발견 → 연결 ✅ (시간근접 가드 불필요)
   ↓
[결과] 방문자 상세/여정 즉시 연결 (uuid 기준이라 정확)
```

## 5. 엣지 케이스

| 케이스 | 처리 |
|--------|------|
| matchField 사이트, record에 그 값 없음 | email fallback (record 1:1일 때만) |
| email 같은 record 여러 개 (matchField 없는 사이트) | 모호 → 매칭 스킵 |
| 같은 사람 여러 visitor(다기기) | 모두 연결 (동일 식별자/이메일) |
| 이미 record_id 있는 visitor | 비건드림 (`record_id IS NULL`) |
| 다른 workspace visitor | workspace 격리 제외 |
| 과거 미연결(match_value 없음) | email backfill로만 |

## 6. Definition of Done

- [ ] 마이그레이션 `0051_tracker_visitor_match_value.sql` + journal 등록 + schema.ts 반영
- [ ] identify가 `user_id`를 `match_value`에 저장
- [ ] `rematchVisitorsByRecord` 구현 (matchField→email, email은 record 1:1일 때만, workspace 격리, phone 제외, 멱등)
- [ ] v1 records POST/PUT/events 3곳 fire-after-commit 호출
- [ ] 로컬 e2e: 방문(identify로 match_value 저장) → 41초 후 가입 → uuid 역매칭 연결 확인
- [ ] email-only 사이트: record 1:1이면 연결, email 중복 record면 스킵 확인
- [ ] 이미 연결/다른 workspace 비매칭 확인
- [ ] 운영 backfill dry-run(email 1:1+시간근접) → 적용
- [ ] 제품/필드명 하드코딩 0건 · 외부 페이로드 스펙 불변
- [ ] gap-detector Match Rate ≥ 90%

## 7. 변경 파일 요약

- `drizzle/0051_tracker_visitor_match_value.sql` (신규) + `drizzle/meta/_journal.json`
- `src/lib/db/schema.ts` — `trackerVisitors.matchValue` 추가
- `src/app/api/tracker/identify/route.ts` — match_value 저장
- `src/lib/tracker/match-record.ts` — `rematchVisitorsByRecord` 추가
- `src/app/api/v1/records/route.ts` / `[id]/route.ts` / `[id]/events/route.ts` — 호출 3곳
- (운영) email backfill 스크립트 — 별도 실행
