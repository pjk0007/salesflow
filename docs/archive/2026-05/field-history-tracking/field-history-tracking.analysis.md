# field-history-tracking Gap Analysis

> Date: 2026-05-20 | Match Rate: **100%**

## Match Summary

| Category | Items | Matched | Notes |
|----------|:-----:|:-------:|-------|
| DB Migration SQL (0049) | 2 | 2 | SQL + journal idx 49 등록 |
| schema.ts trackHistory | 1 | 1 | integer default 0 notNull |
| Types (FieldDefinition / CreateFieldInput / UpdateFieldInput) | 3 | 3 | boolean / optional boolean |
| 필드 생성 POST (커스텀 select만 1, 시스템 0) | 1 | 1 | `!isSystemField && fieldType==="select" && trackHistory ? 1 : 0` |
| 필드 수정 PATCH (trackHistory 갱신) | 1 | 1 | `typeof trackHistory === "boolean"` 조건 처리 |
| records PATCH — partition 조회 + resolvedTypeId 폴백 (D-Q2) | 1 | 1 | `partition.fieldTypeId ?? ws.defaultFieldTypeId` |
| records PATCH — trackedFields 조회 (track_history=1) | 1 | 1 | |
| records PATCH — before/after diff + skip 조건 | 1 | 1 | `key in sanitized`, same-value skip, undefined skip |
| records PATCH — insertRecordEvent 이벤트 형태 (type/label/meta) | 1 | 1 | `{type:key, label:String(toVal), meta:{field,from,to,by}}` |
| records PATCH — 트랜잭션 (D-Q1) | 1 | 1 | `db.transaction` + `insertRecordEvent(args, tx)` |
| CreateFieldDialog — select일 때만 체크박스 + resetForm | 2 | 2 | |
| EditFieldDialog — select일 때만 Switch + 초기값 | 2 | 2 | |
| **Total** | **17** | **17** | **100%** |

## Design 의도 (Gap 아님)

아래 항목은 설계 단계에서 명시적으로 결정된 사항이며 Gap으로 계상하지 않는다.

| 항목 | 근거 |
|------|------|
| "변경 이력 추적" 토글을 select 타입에만 노출 | Design §4 D-UI: "fieldType === 'select'일 때만 노출" 명시 |
| bulk 수정 미지원 (단건 PATCH만) | Plan §7.2: "이번엔 단건 PATCH만. bulk는 향후." |
| record UPDATE + 이벤트를 트랜잭션으로 묶음 | Design §8 D-Q1: 트랜잭션 원자적 처리 확정 |

## Gap 상세

없음. 모든 Design 항목이 구현에 반영됨.

## Added Features (Design 범위 초과)

없음. 설계 범위 내에서 정확하게 구현됨.

## E2E 검증 결과 (사용자 확인)

- status 변경 시 이벤트 기록 (from/to/by 정확)
- 추적 안 켠 필드 변경 시 이벤트 없음
- 같은 값 저장 시 이벤트 없음
- 트랜잭션 원자적 동작
- 백오피스랩 리드관리 record #159755에 consult + status 이벤트 시간순 통합 확인

## Conclusion

Design 17개 항목 전부 구현 일치. Match Rate **100%**. 리포트 단계 진입.
