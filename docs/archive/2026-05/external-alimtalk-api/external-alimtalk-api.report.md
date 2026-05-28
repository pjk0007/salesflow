# Report: external-alimtalk-api

**Date**: 2026-05-28
**Match Rate**: 97%
**Iteration Count**: 1
**Status**: DONE

---

## 개요

외부 프로젝트(예: 디자이너하이어어드민)가 자기 org의 알림톡을 발송할 수 있는 공개 API 2개 추가.
API Token 인증 기반, 멀티테넌트 격리 확보.

---

## 구현 완료 항목

### 신규 파일

| 파일 | 역할 |
|------|------|
| `src/lib/alimtalk/external-auth.ts` | 외부 API 인증 헬퍼 — `authenticateExternalAlimtalk()` |
| `src/lib/alimtalk/send-service.ts` | 공통 발송 로직 — `sendAlimtalkForOrg()` |
| `src/app/api/v1/alimtalk/templates/route.ts` | GET 핸들러 — 템플릿 목록 조회 |
| `src/app/api/v1/alimtalk/send/route.ts` | POST 핸들러 — 알림톡 발송 |

### 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/components/settings/ApiTokensTab.tsx` | API 문서 카드에 알림톡 섹션 추가, 레코드/알림톡 그룹화 리팩터 |

---

## API 스펙

### GET /api/v1/alimtalk/templates

- 인증: `Authorization: Bearer {token}` 또는 `x-api-key: {token}`
- Query: `senderKey` (선택, 미지정 시 org defaultSenderKey 사용)
- 응답: `{ success: true, data: { senderKey, totalCount, templates: [...] } }`
- 필터: NHN status=TSC03 (승인된 템플릿만)
- NHN 원본 필드 그대로 노출 (buttons, quickReplies, templateContent 등)

### POST /api/v1/alimtalk/send

- 인증: 위와 동일
- Body: `{ templateCode, senderKey?, recipients: [{ phoneNumber, templateParameter? }], requestDate?, triggerType? }`
- 제약: recipients 1~1000건
- 처리: 전화번호 정규화 → NHN 발송 → alimtalk_send_logs per-recipient 저장
- 응답: `{ success: true, data: { requestId, totalCount, successCount, failCount, results, errors? } }`

---

## 보안/격리

- API Token → orgId 자동 매핑 (기존 resolveApiToken 재사용)
- Cross-tenant 데이터 누출 없음 (토큰의 orgId 범위만 접근)
- 외부 토큰이므로 sentBy=null, templateLinkId/partitionId/recordId=null로 로그 저장
- CORS: `Access-Control-Allow-Headers: Content-Type, Authorization, x-api-key`

---

## 기술 결정

- 내부 라우트(`/api/alimtalk/send`) 리팩터는 이번 범위 제외 (YAGNI + 리스크 최소화)
- 드리즐 마이그레이션 없음 — alimtalk_send_logs의 nullable 컬럼이 이미 nullable
- 별도 rate limiting 없음 — 향후 미들웨어 레벨에서 추가 예정

---

## Gap 분석 요약

| 필수 항목 | 완료 | 미완료 |
|---------|:----:|:-----:|
| Plan HIGH | 17 | 0 |
| Design 스펙 | 8 | 0 |
| 메시지 미세 차이 | 1건 (기능 무영향) | - |

Match Rate: **97%**
