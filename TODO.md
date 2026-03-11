# SalesFlow TODO

## In Progress

## Bug Fixes

## Pending
- [x] 알림톡 템플릿 추가 페이지와 기능이 실제 NHN 알림톡 템플릿 추가 페이지, 기능과 차이가 있음 -> 똑같이 만들기
- [ ] 승인된 알림톡 템플릿을 발송 테스트하는 기능 (수신번호, 변수들 직접 입력)

## Done
- [x] 이메일을 전송 후 n일 후 메일을 읽지 않았을 때 전송하는 이메일, 읽었을 때 전송하는 이메일 세팅하여 정해진 날짜 후 발송하는 프로세스 추가
- [x] 발송 결과 분석 (읽음률 카드, triggerType별 성과 테이블, 일별 추세 차트)
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
