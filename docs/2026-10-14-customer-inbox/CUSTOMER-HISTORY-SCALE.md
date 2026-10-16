# 문의 목록·검색의 합성 데이터 검증

2026-10-15. 운영/고객 DB와 실제 서버는 사용하지 않았다. 같은 소스에서 PGlite0.5.8와 격리 PostgreSQL17.11로 각각 가상 문의10,000개·메시지100,170개·2사업20회원을 검수했다. 공개 웹 문의7,000개와 과거/이메일/메모만/병합 행을 섞었다.

## 정확성

전체 회원의 공개 목록 ID/순서·50건 커서·미확인 합계, 공개 메시지100건과 이전 페이지, 다른 고객/사업·과거/메일/메모 차단, 직원 본문 검색의100건 커서/집계, 읽음 후 감소량을 기대 데이터와 직접 비교했다. 5개 검사군과7개 측정을 모두 통과했으며 테스트 도중 소스 해시가 변하지 않았다.

## 로컬 PostgreSQL API 측정

각 동작1회 준비 후10회, 단일 클라이언트·따뜻한 캐시·같은 프로세스의 인증/SQL/직렬화 시간을 측정했다. 네트워크 왕복, 실제 사용자 동시 부하, 운영 SLA를 뜻하지 않는다.

| 동작 | p50 ms | p95 ms |
|---|---:|---:|
| customer_list_first_and_total_unread | 21.21 | 26.85 |
| customer_list_next_cursor | 27.09 | 31.03 |
| customer_detail_latest | 12.88 | 20.44 |
| customer_detail_older_cursor | 10.86 | 13.57 |
| staff_body_search_first | 76.98 | 87.86 |
| staff_body_search_next_cursor | 67.15 | 78.99 |
| customer_read_write_and_remaining_unread | 7.06 | 8.90 |

PGlite 전체 검수42.49초, PostgreSQL 전체 검수36.12초였다. 큰 데이터의 정확성/기본 조회 비용 검증이며 실제 배포 환경의 용량 보장은 후속이다.

## 재현과 근거

node --import tsx scripts/check-customer-history-scale.cjs --smoke는 작은 가상 검사, 옵션 없는 실행은 위 규모의 PGlite 검사다. PGlite 시험 런타임이 필요하다. --postgres는 기존 격리 helper가 데이터 디렉터리·PID·loopback55439를 검증한 전용 클러스터와 고유 가상 DB에서만 실행하며 임의 운영 DB URL을 받지 않는다.

원본 JSON의 구성·버전·각 표본·기대 데이터 검사·소스 해시/안정성·DB 정리는 evidence-manifest.json의 customerHistoryScaleQa를 따른다. 전용 시험 DB 삭제와 다른 클라이언트0을 확인하고 해당 시험 서버만 종료했다. 처음 서버가 꺼져 있어 연결 전에 안전 중단한 preflight 기록도 마스터 검수 아티팩트에 보존했다.
