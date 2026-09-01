# PROGRESS — docs/2026-09-01-token-version-revocation/

- 2026-09-01 plan: PLAN.md + behaviors.json 작성, 승인 대기
- 2026-09-01 plan: 발단은 앞 사이클(partition-member-permissions)에서 확인된 문제 — role이 JWT에 구워져 있고 토큰 수명이 30일이라 admin→member 강등 후에도 최대 30일간 옛 권한이 유지된다. 실측으로 DB는 admin인데 기존 토큰은 member라 403 나는 것을 확인
- 2026-09-01 plan: 방식은 사용자 결정으로 tokenVersion. 무효화 범위는 **role 변경만**(멤버 제거·비밀번호 변경은 범위 밖)
- 2026-09-01 plan: 검증 위치는 사용자 결정으로 **관리자 경로만**. getUserFromNextRequest가 동기 함수이고 164개 파일이 쓰기 때문 — 전체 적용은 async 전환 + 모든 요청에 쿼리 1개 추가를 뜻한다. 대가로 강등된 admin의 데이터 접근은 지연 반영되며, 이 잔여 리스크는 PLAN에 명시
- 2026-09-01 design: PLAN 승인됨. DESIGN 단계 착수
