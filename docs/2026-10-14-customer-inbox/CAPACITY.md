# 상담원 자동 배정 수용량과 대기열 재처리

2026-10-15 · `dev` / 초안 PR14. `0108_inbox_agent_capacity.sql`을 추가했다. 운영/개발 고객 DB·서버 설정·키·배포에는 적용하지 않았다.

## 사용 순서

1. 사업 운영 관리자가 **고객 상담 → 배정 수용량**을 연다. 사업별 직원의 현재 진행중 상담 수와 자동 배정 한도를 확인한다. 일반 상담원은 상단의 자기 응대 상태 아래에서 자신의 수와 한도를 조회하며 다른 직원의 한도를 바꾸지 못한다.
2. 한도는0~1,000건, 빈칸은 무제한이다. 기본은 무제한이며0은 새 자동 배정 중지다. 한도를 낮춰도 이미 맡은 상담을 이관하지 않는다. 사람이 명시적으로 담당자를 지정하거나 기존 담당 상담을 다시 열면 한도보다 많아질 수 있다. 이 수치는 새 자동 배정에 적용한다.
3. 같은 사업에서 여러 팀에 속하더라도 진행중 상담을 합산한다. 보류/종료·과거 이력·병합된 원본은 합산하지 않는다. 다른 사업의 한도와 상담 수는 분리한다. 담당자가 그대로인 팀 이동은 현재 상담을 중복 계산하지 않는다. 팀이 수동이면 그대로 수동 큐를 유지하며, 접속 필터를 켠 자동 팀은 기존 접속/응대 가능 조건도 함께 확인한다.
4. 한도가 찼거나 한도가 있는 직원의 동시 배정을 다른 요청이 처리 중이면 그 사람을 새로 선택하지 않는다. 다른 후보를 확인하고, 후보가 없으면 팀 대기열에 남긴다. 상담을 종료/보류하거나 한도를 늘리면 **대기 상담 배정**으로 다시 확인할 수 있다.
5. 재처리는 한 번에 최대50건이다. 확인하지 않은 대기 상담을 먼저, 이후 마지막 확인이 오래된 순으로 본다. 한 팀의 오래된 막힌 상담이50건 이상 있어도 다른 팀의 뒤쪽 상담을 다음 회차에 확인한다. 이미 개인 담당이 있거나 종료/보류·수동/보관 팀·과거/병합 상담은 재배정하지 않는다. 결과에 확인/배정/대기 건수를 표시한다.
6. 편집 중 다른 창에서 개인 응대 상태 또는 한도가 바뀌면 저장 충돌을 표시하고 작성한 값을 보존한다. **최신 설정 불러오기**를 명시적으로 누르면 서버 설정으로 바꾼다. 한도·직원 이름·수정자를 상담창 변경 이력에 남긴다.

자동 큐 워커는 `INBOX_ROUTING_WORKER=on`과 production 런타임을 함께 요구하며 기본 꺼짐이다. 검토 중에는 켜지 않았다. 설치 후 별도로 활성화하면15초마다 확인하고, 각 사업의 현재 운영 관리 권한이 있는 직원을 확인해 처리한다. 관리자가 없거나 권한이 회수되면 해당 사업을 임의 권한으로 처리하지 않는다. 상태/한도 변경 자체가 모든 기존 상담을 소급 이관하는 기능은 아니다.

## 배정과 복구

실제 진행중 상담을 집계하므로 별도 사용량 카운터를 맞추는 작업이 필요하지 않다. 한도가 있는 직원은 사업/직원의 트랜잭션 잠금을 얻은 뒤 최신 수용량을 확인하고, 실제 담당 변경·자동 배정 순서·감사/outbox를 같은 트랜잭션으로 저장한다. 다른 팀의 요청이 먼저 처리 중이면 기다리는 대신 다른 후보 또는 대기열을 선택한다. 실패/롤백되면 잠금과 변경을 함께 해제한다.

한도 설정도 같은 직원의 잠금과 기존 개인 상태의 버전 CAS를 사용한다. 이미 진행 중인 배정을 일괄 취소하지 않으며 한도 변경은 이후 판단에서 적용한다. 수동 지정은 명시적 선택으로 별도 허용한다. AI의 설정된 이관 직원도 새 자동 배정 한도를 확인하고, 막히면 현재 팀의 다른 후보/대기열을 따른다. 기존 개인 담당은 유지한다. 조건별 자동화의 모의 실행도 같은 수용량을 확인하되 배정하지 않는다. 사람이 게시한 뒤 실제 실행 시점의 한도·상담 수를 다시 확인한다.

대기열은 상담별 트랜잭션으로 처리한다. 실패한 회차 이전에 완료한 상담은 유지되고 재시도는 아직 미배정인 상담만 본다. 배정이 안 된 상담의 마지막 검사 시각은 큐 순환용 내부 값으로만 갱신하며 상담 버전·고객 변경 이력을 불필요하게 늘리지 않는다.

잠금의 반환/트랜잭션 범위는 [PostgreSQL 공식 문서](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS)의 계약을 사용한다. 검증은 기본 READ COMMITTED인 별도 PostgreSQL17.11에서 수행했다. 다른 트랜잭션 격리 설정이나 실제 다중 서버 부하를 검수한 결과는 아니다.

## API/SDK와 설치

| 경로 | 계약 |
|---|---|
| `/api/inbox-capacity?channelId=…` GET | 현재 사업 운영 관리자의 직원/진행중 수/한도/개인 설정 버전, 워커 상태 |
| `/api/inbox-capacity` PATCH | `{channelId,userId,version,maxOpenConversations:number|null}`. 같은 사업의 현재 응대 직원만 변경 |
| `/api/inbox-capacity` POST | `{channelId,action:"dispatch"}`로 최대50건 재처리. `{examined,assigned,waiting}` 반환 |
| `/api/v1/inbox/capacity` | 같은 GET/PATCH/POST. 사업 read/update 키 범위와 발급자의 현재 manage 역할을 함께 확인 |
| 기존 `/api/inbox-presence`와 서비스 조회 | 직원별 `openConversations`, `maxOpenConversations` 추가. 자신의 상태 변경은 한도와 다른 필드를 보존 |

`SendbClient.inboxCapacity(channelId)`, `updateInboxCapacity(input)`, `dispatchInbox(channelId)`와 `sdk/capacity-types.ts`를 제공한다. 최초 개인 설정 version0, 생략한 기존 응대 상태는 유지한다. 같은 한도 저장은 버전/감사를 중복하지 않는다. 서비스 키나 일반 직원에게 직원 권한을 새로 부여하지 않는다.

0108은 개인 상태의 nullable 한도와0~1,000 검사, 진행중 직원 집계 인덱스, 상담의 큐 검사 시각/대기 인덱스를 추가한다. 기존 한도는 무제한으로 유지한다. 실제 설치 전 앱보다 먼저 검토/적용해야 하며 이번 작업에서 운영/개발 고객 DB에 실행하지 않았다.

## 검수와 발견한 기존 오류

`node --import tsx scripts/check-inbox-capacity.cjs`: PGlite SQL/API12개와 플랫폼 기본11개. 사업/직원/키·0/1/무제한·CAS/멱등·직원 이름 감사·여러 팀 합산·같은 담당자 팀 이동·자동화 모의 실행/실제 재확인·종료/보류/수동 초과·AI 이관·제외 대상·앞50건 회전·워커 현재 사업 관리자·감사 INSERT 실패 롤백·재시도·백오랩 독립 한도를 검증한다.

`node --import tsx scripts/check-inbox-capacity.cjs --postgres`: 같은12개와 실제 독립 연결/커밋 전 잠금, 여덟 팀의 한도2 동시 요청/빈 슬롯 복구, 실제 드라이버의 메시지/접속/보고 시각까지15개를 별도 PostgreSQL17.11에서 통과했다. 플랫폼 기본11개도 같은 실제 드라이버로 수행했다. 임시 가상 DB만 생성/삭제하며 고정 loopback55439·sendb_qa와 준비한 `.testenv/pg-capacity-data` 프로세스를 확인한다. 운영/개발 환경 파일이나 기존 서버 URL을 읽지 않는다. 검수 후 임시 DB를 정리하고 이 시험 서버를 종료했다.

재현 시 [EDB 공식 Windows 바이너리](https://www.enterprisedb.com/download-postgresql-binaries)로 `.testenv/pg17/pgsql/bin`을 준비한다. 이 작업에서는 `postgresql-17.11-3-windows-x64-binaries.zip`, SHA256 `4b8db0930c38f6ef845db919551dedda3b6b845aeb0927b3d79a6e8e9e4537cf`를 사용했다. 로컬의 `.testenv/setup-capacity-postgres.cjs`로 가상 클러스터만 시작하고 위 검사를 실행한 뒤 `.testenv/cleanup-capacity-postgres.cjs`로 종료했다. 바이너리와 가상 DB는 저장소에 포함하지 않는다.

검토자가 새 체크아웃에서 재현할 때의 PowerShell 명령은 다음과 같다. PGlite0.5.8은 시험 디렉터리에만 설치한다. `initdb`는 새 가상 데이터 디렉터리에서 한 번만 실행하며, 이 주소/포트를 기존 고객 DB로 바꾸지 않는다. 테스트 자체가 임시 DB를 생성하고 정리하며 마지막 명령은 이 가상 클러스터만 종료한다.

```powershell
npm install --prefix .testenv/test-runtime --no-save --package-lock=false @electric-sql/pglite@0.5.8
& ./.testenv/pg17/pgsql/bin/initdb.exe -D ./.testenv/pg-capacity-data -U sendb_qa -A trust --encoding=UTF8 --locale=C
& ./.testenv/pg17/pgsql/bin/pg_ctl.exe -D ./.testenv/pg-capacity-data -l ./.testenv/capacity-pg-server.log -o '-h 127.0.0.1 -p 55439 -c max_connections=30 -c shared_buffers=32MB' -w start
node --import tsx scripts/check-inbox-capacity.cjs
node --import tsx scripts/check-inbox-capacity.cjs --postgres
& ./.testenv/pg17/pgsql/bin/pg_ctl.exe -D ./.testenv/pg-capacity-data -m fast -w stop
```

실제 드라이버 검수에서 기존 메시지의 `greatest(last_message_at, Date)` 전달이 실패하는 것을 확인했다. 메시지·응대 목표/성과·접속 조건의 SQL 시각을 ISO 문자열과 timestamptz 형식으로 전달하도록 고쳤다. 직원 집계의 바깥 users.id도 명시적으로 연결해0건으로 보이던 집계를 수정했다. PGlite만으로는 이 드라이버 오류가 드러나지 않았다.

기존 상담팀18·AI16·상담22·응대 운영23·접속14·조건별 자동화12·회원 연결12의7개 회귀 묶음, 단위1,095·기능 lint·타입 포함 격리 전체 Next 빌드가 통과했다. Chrome에서는 가상 직원 한도0/1 저장·기존 상담 유지·첫 자동 배정/추가 문의 대기·기존 상담 종료 후1건 재배정·두 창 저장 충돌/초안/최신 복구·일반 상담원의 한도 조회/설정 제한을 확인했다.

코드·마이그레이션·가상 DB 종료·로그·화면 증거는 `evidence-manifest.json`의 `capacityQa`에 기록한다. 운영 서버/DB·키·직원 설정·main/master 병합·배포·실제 고객 발송은 변경하지 않았다. 직원별 교대표·실제 다중 서버/대규모 부하·전체 채널/사이트 설치·자료 이전/전체 전환 검수는 남아 있다. 사업 업무시간에만 자동 배정하는0109의 흐름은 [BUSINESS-HOURS-ROUTING.md](BUSINESS-HOURS-ROUTING.md)에 추가했다. 전체 목표는 [REPLACEMENT.md](REPLACEMENT.md)를 유지한다.

고객 공개 답변의 서버 작성 잠금·인계·새 대화 재검토·초안 보존은0110의 [REPLY-GUARD.md](REPLY-GUARD.md)에 추가했다. 내부 메모는 함께 작성할 수 있다.
