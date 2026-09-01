# PROGRESS — docs/2026-08-07-sender-profile-propagation/

- 2026-08-07 plan: PLAN.md + behaviors.json 작성, 승인 대기
- 2026-08-07 plan: 승인됨. 후속 발신자 정책을 "원본 상속 + 프로필 삭제 시 현재 기본값 fallback"으로 확정(사용자 결정) → B16 추가, behavior 16개
- 2026-08-07 design: architect 위임, DESIGN.md 작성 완료. 착수 전 확인 항목이던 `emailAutoPersonalizedLinks.senderProfileId/signatureId`는 schema.ts:798-799에 이미 선언돼 있음을 확인 — 스키마 추가 불필요, `auto-personalized-email.ts`의 `as Record<string, unknown>` 캐스팅은 불필요한 레거시로 판명(리팩토링 중 제거)
- 2026-08-07 design: 순수함수를 `email-sender-pick.ts`로 분리하기로 결정 — 테스트가 resolver를 import하면 `@/lib/db` 커넥션이 딸려 열리는 문제 회피
- 2026-08-07 design: 승인됨
- 2026-08-07 do(1-2): TDD — `email-sender-pick.test.ts` 22케이스 작성 → RED 확인 → `email-sender-pick.ts` 구현 → GREEN (35/35, 기존 13 + 신규 22)
- 2026-08-07 do(3): `resolveSender`/`resolveSignature` 구현, 기존 두 함수는 래퍼로 전환. `resolveSignature`는 `"requestedId" in opts`로 키 부재와 null을 구분한다
- 2026-08-07 do(4): schema.ts에 senderProfileId 추가, 0064 마이그레이션 + _journal 등록. 로컬 DB 2회 적용해 멱등성 확인 (B15 ✅)
- 2026-08-07 do(5): 최초 발송 2경로(send/route.ts, auto-personalized-email.ts) 리졸버 전환 + 로그에 senderProfileId 기록. 인라인 55줄 제거, `as Record<string, unknown>` 캐스팅 제거
- 2026-08-07 do(6): email-followup.ts 템플릿/AI 두 분기 + generateAiFollowupPreview 전환
- 2026-08-07 do(7): AI 테스트 2경로 전환. test-followup의 parentLog 조회에 orgId 필터가 빠져 있던 것을 함께 수정
- 2026-08-07 do(8): test-send API에 프로필/서명 수신 + appendSignature 신규 적용(B8), EmailTestSendDialog에 Select 2개 추가
- 2026-08-07 do(8): 다이얼로그가 217줄로 200줄 임계를 넘어 DESIGN 3-8 조건대로 `hooks/useEmailTestSend.ts`로 상태·핸들러 추출 → .tsx 167줄(렌더 전용), 훅 105줄
- 2026-08-07 do: 검증 — `pnpm test` 35/35 통과, `npx tsc --noEmit` 클린, lint 총계 100 problems/44 errors로 변경 전과 동일(기존 에러, 신규 없음)
- 2026-08-07 do: behaviors.json 갱신 — B1~B6·B14·B15·B16 evidence 확보(9건 통과). B7~B13은 NHN 실발송/큐 실행이 필요해 수동 검증 대기
