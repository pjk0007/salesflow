# Gap Analysis: external-alimtalk-api

**Date**: 2026-05-28
**Match Rate**: 97%
**Iteration**: 1

---

## 분석 요약

Plan/Design 대비 구현 완성도 97%. 모든 필수 항목 구현됨. 메시지 prefix 1건 소폭 차이.

---

## 체크리스트

### Plan 필수 항목 (HIGH)

| 항목 | 상태 | 위치 |
|------|------|------|
| GET /api/v1/alimtalk/templates 엔드포인트 | PASS | `src/app/api/v1/alimtalk/templates/route.ts` |
| API Token 인증 (resolveApiToken 재사용) | PASS | `src/lib/alimtalk/external-auth.ts` |
| senderKey 미지정 시 defaultSenderKey 조회 | PASS | templates/route.ts:36-48 |
| senderKey 없을 때 400 반환 | PASS | templates/route.ts:50-55 |
| NHN 원본 필드 pass-through (buttons, quickReplies 등) | PASS | templates/route.ts:57-78 |
| TSC03 승인 필터 적용 | PASS | templates/route.ts:69 |
| POST /api/v1/alimtalk/send 엔드포인트 | PASS | `src/app/api/v1/alimtalk/send/route.ts` |
| 수신자 정규화 + 잘못된 번호 errors[] 분리 | PASS | send-service.ts:101-128 |
| NHN sendMessages 호출 | PASS | send-service.ts:139-155 |
| alimtalk_send_logs 저장 (per-recipient) | PASS | send-service.ts:167-201 |
| templateLinkId/partitionId/recordId null 처리 | PASS | send-service.ts:181-183 |
| sentBy null | PASS | send-service.ts:197 |
| triggerType "external_api" 기본값 | PASS | send-service.ts:165, send/route.ts:90 |
| templateParameter 치환 본문 content 저장 | PASS | send-service.ts:173-178 |
| 공통 발송 함수 sendAlimtalkForOrg 분리 | PASS | `src/lib/alimtalk/send-service.ts` |
| CORS 헤더 (Authorization, x-api-key) | PASS | 양쪽 route.ts CORS_HEADERS |
| 멀티테넌트 격리 (토큰→orgId 매핑) | PASS | external-auth.ts 전체 |

### Design 세부 스펙

| 항목 | 상태 | 비고 |
|------|------|------|
| 401 — 유효하지 않은 API 토큰 | PASS | |
| 400 — senderKey 없음 | PASS | |
| 404 — 알림톡 설정 없음 | PASS | |
| 502 — NHN 호출 실패 | PASS | templates prefix "템플릿 조회 실패:" (design은 "발송 실패:") — 미세 차이, 기능 동일 |
| 500 — 그 외 | PASS | |
| POST body 검증 (templateCode 필수) | PASS | send/route.ts:68-73 |
| POST recipients 형식 검증 | PASS | send/route.ts:75-81, parseRecipients() |
| 발송 로그 스키마 매핑 (5번 섹션) | PASS | 모든 필드 정확히 매핑 |

### Plan LOW (선택 사항)

| 항목 | 상태 | 비고 |
|------|------|------|
| GET /api/v1/alimtalk/results/:requestId | SKIP | 선택 사항, 미구현 정상 |
| 사용량/한도 조회 | SKIP | 선택 사항, 미구현 정상 |

---

## Gap 항목

| 항목 | 심각도 | 설명 |
|------|--------|------|
| templates 502 에러 메시지 prefix | LOW | Design 명시는 `발송 실패: ${message}`, 구현은 `템플릿 조회 실패: ${message}`. 기능적으로 동일, 오히려 더 명확 |

---

## 타입체크 상태

`npx tsc --noEmit` exit 0 (사전 확인 완료)

---

## 결론

Match Rate 97%. 필수 구현 항목 전부 완료. 미세 메시지 차이 1건은 기능 영향 없음.
리포트 생성 및 아카이빙 진행 가능.
