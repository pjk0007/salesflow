# Gmail 연결과 자동 수신

2026-10-15, dev 구현·격리 QA. 실제 Google 계정 승인·공급자 배달·운영 설치를 완료했다는 뜻은 아니다.

## 사용 흐름

1. 고객 상담 → **이메일 연결**에서 현재 사업의 메일함 이름과 기본 Gmail 주소를 등록한다.
2. **연결할 때 가져올 메일**을 선택한다. 연결 시작 이후 / 최근 7일부터 / 최근 30일부터이며, 재연결에도 새 선택이 적용된다.
3. **Google 계정 연결**을 누르고 등록 주소와 같은 계정을 선택한다. 메일 읽기와 발송 권한을 승인한다. 기존 마케팅 회신용 계정·권한은 변경하지 않는다.
4. 돌아오면 **Google 계정 · 연결됨**을 확인하고 **수신·발송 켜기**를 누른다. 서버 자동 처리가 꺼져 있으면 화면에서 별도로 안내한다. 계정 연결과 처리 허용은 별도 상태다.
5. 새 문의는 이메일 상담과 같은 고객 활동에 나타난다. 담당자는 상담함에서 답장한다. 첨부 준비와 발송 결과는 기존 [이메일 첨부 흐름](EMAIL-FILES.md)을 따른다.
6. 설정 화면에서 마지막 메일 확인·가져오기 시각과 대기/완료/확인 필요 건수를 본다. 실패한 원본은 **실패한 메일 다시 가져오기**로 재요청한다. 발송 실패 답장의 재시도는 대화 내 기존 버튼을 사용한다.

연결·재연결·해제는 아직 발송을 시작하지 않은 답장을 취소한다. 승인 완료 뒤 사람이 다시 수신·발송을 켜야 한다. 이미 공급자에 전달한 요청은 되돌릴 수 없으며 늦게 확인된 결과는 기존 발송 이력에 반영한다. 연결 해제는 샌드비의 갱신 토큰을 삭제하고 수신·발송을 중지한다. Google 계정의 앱 전체 권한을 자동으로 취소하지 않는다.

## 서버 설치

관리자가 Gmail API를 사용할 Google 프로젝트와 웹 앱 OAuth 클라이언트를 준비하고 정확한 redirect URI를 등록한다. 이 앱에는 `gmail.readonly`, `gmail.send` 두 범위가 필요하다. 실제 계정의 앱 사용 가능 여부·조직 정책·Google 승인 요구사항은 설치 단계에서 확인한다.

| 환경 변수 | 의미 |
|---|---|
| `CUSTOMER_EMAIL_GOOGLE_CLIENT_ID` | 전용 Google 앱 클라이언트 ID |
| `CUSTOMER_EMAIL_GOOGLE_CLIENT_SECRET` | 서버 전용 클라이언트 비밀값 |
| `CUSTOMER_EMAIL_GOOGLE_REDIRECT_URI` | 서비스 출처 + `/api/email-google/callback`; HTTPS, 로컬 loopback HTTP 허용 |
| `CUSTOMER_EMAIL_ENCRYPTION_KEY` | 갱신 토큰/PKCE 저장 암호화용 안정된 비밀값; 미설정 시 기존 JWT_SECRET 사용 |
| `CUSTOMER_EMAIL_WORKER` | 명시적으로 `on`일 때 서버 스케줄러 허용, 기본 꺼짐 |

마이그레이션 **0100**은 연결 상태, 일회성 OAuth 요청, 수신 원본 대기열을 추가한다. 기존 앱 시작 절차에서 마이그레이션 후 스케줄러를 등록한다. 배포 런타임의 production 모드와 명시적 on을 모두 확인한다. 격리 QA는 이 플래그를 켜거나 개발 환경을 운영으로 위장하지 않고 DB·가상 HTTP를 주입해 처리 함수를 직접 호출했다. 현재 dev/운영 서버에 실제 계정이나 스케줄러 설정을 설치하지 않았다.

비밀값은 서버 환경에만 넣고 Git·브라우저·문서에 넣지 않는다. 암호화 키를 바꾸면 이전 토큰을 읽을 수 없어 재연결을 요구한다. 연결한 관리자가 조직에서 제거되거나 비활성화/권한 회수되면 자동 처리가 중단된다. 외부 relay 예제도 유지하며, 설치 시 메일함별 처리 주체를 정한다.

## 자동 처리와 복구

- 처음에는 고정된 시작 시각 이후 원본 번호를 50개씩 읽는다. INBOX 필터를 강제하지 않아 보관된 메일도 포함한다. 보낸 메일·임시보관·스팸·휴지통은 제외한다. 원본을 가져올 때 라벨과 정확한 시작 시각을 다시 검사한다.
- 원본 번호 대기열 등록과 페이지 커서 저장은 같은 SQL 트랜잭션이다. 실패하면 둘 다 롤백한다. 원본 한 건의 형식 오류가 나도 뒤의 문의를 계속 처리하고 해당 건을 확인 필요로 남긴다.
- 초기 조회가 끝나면 연결 시작 시 캡처한 Gmail history ID부터 증분 조회한다. 여러 페이지를 끝낸 후에만 최종 history ID를 전진한다. ID는 큰 정밀도를 잃지 않도록 문자열로 저장한다.
- history가 만료되어 404이면 현재 baseline을 잡고 **최초 수신 시작 범위**부터 다시 조회한다. 원본 번호의 유일성과 수신 fingerprint로 상담 중복을 막는다. 라벨 변경으로 제외 대상에서 돌아온 원본은 다시 검사한다.
- 처리 순서는 원본 목록 → 수신 한 건 → 첨부 한 페이지 → 답장 한 건이다. 각 회차는 제한된 작업량이며 처리 임대는 120초, 외부 HTTP 단계는 최대 90초다. 공급자 POST 30초를 확보하지 못하면 발송 시작 전에 멈추고 준비 임대 만료 후 복구한다. 대규모 처리량·지연 목표는 실제 메일함 부하 검수에서 정한다.
- 원본 수신의 일시 실패는 최대 5회·백오프 후 확인 필요로 남긴다. 잘못된 원본은 사람이 재시도한다. 파일은 자체 영속 대기열·커서와 기존 재요청 흐름으로 처리한다. 원본 메일의 읽음·라벨·삭제는 변경하지 않는다.
- 연결 세대와 메일함 버전이 바뀌면 이전 수신/첨부/발송 시작을 거부한다. 연결 처리 중에는 SQL 잠금을 잡은 채 Google HTTP를 기다리지 않는다. 재시작 뒤 살아 있는 임대는 건드리지 않고 만료 뒤 복구한다.
- 같은 상담의 답장은 메시지 순서로 준비한다. 준비/발송 중인 이전 답장을 뒤의 답장이 추월하지 않는다. 실제 POST는 한 번이며 결과 미확인은 자동으로 재전송하지 않는다.
- 403 사용량 제한은 자동 백오프한다. 권한·앱 설정·계정 불일치·암호화 설정 문제는 재연결 필요로 표시하고 수신·발송을 중지한다.

등록한 기본 주소가 To, Cc, 또는 Gmail의 Delivered-To에 있는 원본만 연결한다. BCC 문의는 Delivered-To로 확인한다. 여러 참여자/전체 회신/발신 별칭은 아직 지원하지 않으며 답장은 확인된 원래 고객 한 명에게 보낸다. 회원 웹 상담과 이메일 고객은 자동으로 합치지 않는다.

## API와 코드

관리자 UI 전용:

- `GET /api/email-mailboxes/:id/google`: 공개 가능한 연결 상태·처리 시각·집계·서버 준비 여부. 갱신 토큰과 암호문을 반환하지 않는다.
- `POST .../google`: `{action:"connect",version,lookbackDays:0|7|30}` → authorizationUrl + HttpOnly 일회성 nonce cookie. `{action:"disconnect",version}`은 연결 버전 CAS, `{action:"retry"}`는 실패한 수신 원본 재시도.
- `GET /api/email-google/callback`: 현재 관리자·조직/계정·일회성 state·브라우저 cookie·만료/설정 버전을 확인하고 고정된 상담 화면으로 돌려보낸다. 승인 코드/비밀값을 redirect URL이나 로그에 남기지 않는다.

`google-connection.ts`는 승인·해제, `google-worker.ts`는 영속 처리/체크포인트/복구, `google-transport.ts`는 기존 수신·첨부·발송 저장소를 직접 재사용한다. 서버 내부 실행을 위해 별도 API 키를 DB에 저장하거나 loopback API를 호출하지 않는다. 공유 암호화 도우미는 기존 웹훅 암호화 형식을 유지한다.

## 검증

```sh
npm ci
npm install --prefix .testenv/test-runtime --no-save @electric-sql/pglite@0.5.8
node --import tsx scripts/check-inbox-google.cjs
node --import tsx scripts/check-inbox-email-files.cjs
node --import tsx scripts/check-platform-webhooks.cjs
```

Google 연결·자동 수신 SQL/API **19개**, 기존 이메일14·첨부11·웹훅14, 전체 단위 **1,067개**, 타입/lint/격리 빌드를 검증한다. Google 검사는 가상 HTTP만 사용하며 OAuth 성공 callback·잘못된 계정/권한/nonce·만료·원자 롤백·history 페이지/만료·CC/BCC·기존 fingerprint 호환·원본 오류 분리·파일 실제 바이트·임대 복구·발송 순서·권한/키 변경 중단을 포함한다.

Chrome에서는 디하 실패 원본 재시도 → 대기 1 → 완료 1 → 실제 대화 표시, 백오랩 재시도 접수 → 연결 해제/중지, 디하 상태 유지, 수신 범위 선택을 확인했다. 모두 가상 계정이며 Google 승인 화면에서 실제 권한을 부여하지 않았다. 캡처와 로그는 evidence-manifest의 `googleConnectionQa`에 기록한다.

실제 OAuth 앱·계정 승인·배달·수신 지연/처리량·장애 모니터링, push, 다중 참여자와 별칭, 반송/공급자 결과 조정은 남아 있다. 카카오·네이버·전화와 전체 자료 이전/전환도 [전체 장부](REPLACEMENT.md)의 미완료 항목으로 유지한다.

설계 근거: [Google OAuth 웹 서버 흐름](https://developers.google.com/identity/protocols/oauth2/web-server), [Gmail 동기화](https://developers.google.com/workspace/gmail/api/guides/sync), [history.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list), [Google 공식 PKCE 구현](https://github.com/googleapis/google-auth-library-nodejs/blob/main/src/auth/oauth2client.ts). 공개 계약을 참고해 기존 샌드비 구조로 구현했다.
