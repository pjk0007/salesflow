# SalesFlow TODO

## In Progress

## Bug Fixes
- [ ] extractJson Step 1~3 실패 시 본문 빈 이메일 발송되는 문제 — Step 4 복구 로직 개선 완료, 검증 필요
- [ ] Gemini htmlBody 안 이스케이프 안 된 따옴표 → JSON 파싱 실패 빈도 모니터링

## Pending
- [ ] 대량 발송 결과 분석 (발송 성공률, 읽음률)

## Done
- [x] CSV 파일 정리 (TSV→CSV, N샵→네이버, 이메일 치환)
- [x] test.csv 3000건 → test1/2/3.csv 1000건씩 분할
- [x] Gemini hallucination 원인 규명 (프롬프트 내 하드코딩 데이터)
- [x] hallucination 대응 코드 revert (불필요한 순차실행/재시도/pending log)
- [x] bulk-import AI 자동발송 순차 실행 (rate limit 방지)
- [x] AI 이메일 subject HTML 태그 strip
- [x] UTM 파라미터 코드 레벨 자동 추가 (&amp; 문제 해결)
- [x] CTA 표시 텍스트에 URL 대신 자연스러운 문구 사용
- [x] 문단 구조 `<br><br>` → `<p>` 태그 기반으로 변경
- [x] 이모지 금지 규칙 추가
- [x] AI 사용량 breakdown undefined 수정
- [x] AI 쿼터 플랜 변경 시 자동 동기화
- [x] AI 토큰 한도 상향 (Free 1M, Pro 10M, Enterprise 100M)
- [x] AI 사용량 숫자 타입 변환 버그 수정
- [x] test1.csv (1000건) 대량 발송 테스트
- [x] AI 이메일 프롬프트 품질 튜닝 (줄바꿈 일관성, CTA 문구 등)
