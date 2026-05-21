# Plan: 고객 여정 시각화 v2 (Customer Journey Visualization v2)

> **Summary**: 기존 customer-journey(MVP)의 시각화를 강화한다. 유입 경로(메타/구글/네이버/메일/직접) 세분, 채널 가로 타임라인(스윔레인) + 세로 상세 타임라인 결합, First/Last touch 어트리뷰션, 다음 액션 제안. claude design 시안(A 세로상세 + B 가로레인) 기반.
>
> **Project**: Sendb (Salesflow)
> **Author**: jaehun
> **Date**: 2026-05-21
> **Status**: Draft
> **Base**: customer-journey (archive/2026-05/customer-journey), visitor-multi-record
> **브랜치**: feat/customer-journey

---

## 1. 배경 — MVP의 약점
v1은 데이터 통합·세로 목록 타임라인까지 됐으나 시각적으로 약함:
- 유입 경로(어떻게 들어왔나)가 "사이트"로만 뭉개짐 — 메타광고/구글/네이버/메일 구분 없음
- 타임라인이 단조로운 세로 목록
- 채널이 어떻게 교차해 전환됐는지 흐름이 안 보임
- 어트리뷰션(무엇이 전환을 만들었나) 없음

## 2. v2 목표 (claude design 시안 반영)
1. **유입 경로 세분** — referrer/utm 해석 → 메타 광고/구글 검색광고/구글 자연검색/네이버/메일/직접
2. **채널 가로 타임라인(스윔레인)** — 채널별(사이트/메일/가입/단계) 가로 레인, 시간축 위 교차 (시안 B)
3. **세로 상세 타임라인** — 이벤트별 상세(메일 제목/CTA, 페이지별 체류, UTM, 디바이스) (시안 A)
4. **어트리뷰션** — First touch / Last touch / 전환 경로 + 터치 간 간격
5. **다음 액션 제안** — 간단한 룰 (가입 직후 48시간→온보딩콜 등)
6. **관여도/지표 강화** — 일별 폭증 강조, 단계별 전환·소요, 페이지 관여도(선택)

## 3. Scope

### In Scope
- [ ] 유입 경로 분류 유틸 (referrer + utm → 채널 라벨)
- [ ] journey API summary에 어트리뷰션(firstTouch/lastTouch/conversionPath) 추가
- [ ] 사이트 세션 normalize에 유입 채널 라벨 부여
- [ ] 다음 액션 제안 룰 (서버 또는 클라)
- [ ] UI: 상단 채널 가로레인 + 하단 세로 상세 (시안 A+B 결합)
- [ ] 세로 타임라인 이벤트 상세 강화 (메일/페이지/UTM 메타)
- [ ] 어트리뷰션 카드, 액션 제안 카드

### Out of Scope
- ❌ C(분석 대시보드) — **별도 워크스페이스 대시보드**로 분리 (다음 작업)
- ❌ 페이지 관여도 순위 — 선택, 여유되면

## 4. 결정사항 (확정)
- **레이아웃**: 상단 채널 가로레인(B) + 하단 세로 상세(A) 한 화면
- **유입 세분**: 광고매체까지 (메타/구글검색광고/구글자연/네이버/메일/직접)
- **어트리뷰션**: 포함 (First/Last touch + 경로)
- **액션 제안**: v2에 간단히 (룰 몇 개)
- **C 대시보드**: 별도, 나중

## 5. Next Step
- [ ] `/pdca design customer-journey-v2` (이미 작성)
- [ ] 구현 → 로컬 검증(더미 데이터)
