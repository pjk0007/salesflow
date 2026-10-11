# 샌드비 고객 여정 카드

메일 링크를 클릭해 사이트를 방문한 고객의 한 방문을 Google Chat 카드로 정리한다. 회사·담당자, 유입 메일, 페이지 이동 순서, 페이지별 체류 추정, 영역별 체류 측정, 누른 버튼, 마지막 도달 단계와 CRM 링크를 담는다.

사업별 전용 스페이스:

- [디자이너 하이어 고객여정](https://chat.google.com/app/chat/AAQASH-gyo4)
- [백오피스랩 고객여정](https://chat.google.com/app/chat/AAQAbqhHk2A)

## 표시와 발송 기준

- 메일 열람은 기존 서비스에서 수집하지 않는다. 카드에 `메일 열람 여부: 수집하지 않음 · 링크 클릭 확인`을 표시한다.
- 명시적으로 허용한 워크스페이스의 활성 사이트에서, 해당 워크스페이스의 발송·클릭·CRM 고객과 직접 연결된 방문만 처리한다.
- 최근 48시간의 방문 중 마지막 활동 후 10분이 지난 방문을 정리한다. 기존 사람/기계 방문 판정 함수를 재사용한다.
- 페이지별 시간은 다음 페이지 이동 또는 측정된 세션 종료까지의 간격이다. 마지막 페이지의 측정값이 없으면 `측정 없음`으로 남긴다.
- 영역별 시간은 `SECTION_VIEW.properties.dwell_ms` 합계다. 영역이 함께 노출되면 시간은 겹칠 수 있다.
- 신청·구독·구매 완료 신호가 있으면 완료 카드로 표시한다. 그 외에는 마지막 도달 단계와 `이탈 추정`을 표시하며 이탈 이유를 단정하지 않는다.
- 방문당 카드 한 장이다. 같은 고객의 재방문은 새 카드로 같은 Chat 스레드에 모은다. 이미 정리한 동일 방문의 뒤늦은 이벤트는 기존 카드를 수정하지 않는다.
- 전송 실패는 재시도 가능한 오류에 한해 10분 뒤 다시 시도하며 최대 5회다. 응답 시간 초과는 이미 도착했을 수 있으므로 `uncertain`으로 남기고 자동 재전송하지 않는다. 24시간 넘게 대기한 카드는 닫는다.
- 실제 연결 시험에서 수신 웹훅이 `requestId`를 400으로 거절함을 확인했다. 새 워커에서는 이 옵션을 쓰지 않는다. 같은 방문의 반복 처리는 DB 고유 키로 막는다.

## 운영 연결

1. 배포 시 `0077_customer_journey_alerts.sql`을 기존 마이그레이션 절차로 적용한다.
2. 각 스페이스의 수신 웹훅을 만들고 배포 환경의 비밀 설정에 사업별 주소를 넣는다. 웹훅 주소는 저장소·문서에 기록하지 않는다.
3. 아래 설정으로 허용할 워크스페이스를 명시한다. 번호는 실제 운영 워크스페이스를 확인한 후 넣는다.

```dotenv
JOURNEY_ALERT_MODE=dry_run
JOURNEY_ALERT_WORKSPACE_IDS=<쉼표로 구분한 워크스페이스 번호>
JOURNEY_ALERT_WEBHOOKS_BY_WORKSPACE={"<디하 워크스페이스 번호>":"<디하 웹훅>","<백오피스랩 워크스페이스 번호>":"<백오피스랩 웹훅>"}
JOURNEY_ALERT_START_AT=<운영을 시작할 시각, ISO 8601>
NEXT_PUBLIC_BASE_URL=https://sendb.kr
```

4. `dry_run`으로 카드와 대상이 맞는지 확인한 후 `JOURNEY_ALERT_MODE=live`로 전환한다. `dry_run`으로 기록한 방문은 전환 후 소급 전송하지 않는다. 기본값은 `off`다.
5. 기존 `POST /api/tracker/deep-alerts/process`가 새 워커도 함께 호출하도록 연결했다. 운영 스케줄러에 이 경로가 5분 주기로 등록되어 있는지 확인한다. 필요하면 전용 `POST /api/tracker/journey-alerts/process`를 `x-secret: <CRON_SECRET>` 또는 Bearer 헤더로 호출할 수 있다. 중복 호출은 DB 잠금과 방문별 고유 키로 막는다.

`live`는 기존 운영 서버 판정을 통과해야 한다. 로컬 통합 검증에서만 `JOURNEY_ALERT_TEST_SERVER_LIVE=1`을 쓰며 운영 설정에는 넣지 않는다. 기존 깊이 방문 알림의 설정과 발송 기록은 별개다.

사업별 주소 목록을 지정한 경우 주소 없는 사업은 대기하고 다른 사업의 주소나 공통 웹훅으로 대체하지 않는다. 주소 목록 자체가 잘못되면 `configurationError`를 반환하고 발송을 중단한다. 목록의 키만으로 허용 사업이 늘어나지 않으며, 주소가 있는 사업부터 대기 카드를 조회하므로 연결되지 않은 사업 때문에 발송이 밀리지 않는다. 기존 단일 `JOURNEY_ALERT_WEBHOOK_URL`은 사업별 목록을 지정하지 않은 배포에만 호환용으로 남아 있다.

## 검증

- 운영 main의 발신자 검색·페이지 이동과 사업별 발송 경로를 통합한 코드에서 전체 단위 시험 916개 통과. 고객 여정 카드 시험 9개와 사업별 주소 설정 시험 6개를 포함한다.
- TypeScript 검사 및 변경 코드 ESLint 통과.
- 격리된 로컬 PostgreSQL에서 가상 고객으로 발송, 같은 방문 중복 방지, 완료/이탈 구분, 기계·진행 중 방문 제외, dry run, 실패 후 재시도, 웹훅의 요청 ID 미사용, 응답 불명확 시 자동 재전송 중지, 두 사업의 스페이스 분리, 연결 누락 사업 대기, 잘못된 주소 목록 중단 등 13항목을 검증했다. 각 실행마다 별도 시험 조직·사업을 만들며 외부 발송은 대체 함수로 수행했다.
- 최적화 프로덕션 빌드 통과. 전용 스페이스에 가상 고객 카드 1장을 실제 전송하고 Google Chat 화면에서 수신·표시를 확인했다.
- 검증 결과와 가상 카드 JSON/텍스트: `F:/Dev/sendb-recovery-20261011/customer-journey/`.

## 구현 위치

- `src/lib/customer-journey-card.ts`: 방문 요약·카드 생성 (DB/외부 호출 없음)
- `src/lib/customer-journey-alert.ts`: 후보 조회·중복 방지·저장·발송
- `src/lib/customer-journey-alert-config.ts`: 사업 허용 목록과 스페이스별 주소 설정
- `src/lib/google-chat.ts`: 기존 텍스트 발송 경로를 유지하고 `cardsV2` 발송 추가
- `drizzle/0077_customer_journey_alerts.sql`: 새 발송 기록 테이블
- `src/app/api/tracker/journey-alerts/process/route.ts`: 전용 실행 엔드포인트

API 근거: [수신 웹훅](https://developers.google.com/workspace/chat/quickstart/webhooks), [카드 형식](https://developers.google.com/workspace/chat/api/reference/rest/v1/cards).
