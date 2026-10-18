# 전자서명 검수 기준

기획 기준: [PLAN.md](./PLAN.md). 2026-10-18 최초 구현 검수에서 Node.js 24.19.0으로 관련 검사 **77개 통과, 실패·건너뜀 0개**를 확인했다. 이후 dev 체험 경로를 추가한 관련 검사는 79개이며 최신 저장소 전체 검수 결과는 바로 아래에 기록한다. 가상 고객과 새 PostgreSQL 17.11 DB, 격리 PGlite, 임시 암호화 파일, 캡처 공급자만 사용했다. 체크되지 않은 항목을 통과로 해석하지 않는다.

## 최신 저장소 전체 검수

### 전통 인장·회사 직인 리서치 반영 (2026-10-18)

- Node.js 24.19.0, 격리 PostgreSQL/PGlite·외부 네트워크 차단 환경: **111개 테스트 파일, 1,416개 통과·실패/취소/건너뜀 0개**. 변경 파일 ESLint와 webpack 배포 빌드·타입 검사·224개 페이지 생성도 통과했다.
- 개인 낙관 6종·회사 직인 6종과 전각풍/고전 명조/단정한 명조의 36개 조합, 8자 이름·24자 회사명의 추가 시안 12개를 실제 Chrome에서 생성했다. 모양과 서체가 서로 다른 이미지이며 투명 여백 10px 이상이 유지된다.
- 375×812 화면의 가로 넘침 없음, 직함/서체 변경 후 이전 선택 해제, 기존 손글씨 서명 4종을 확인했다. 선각 한글 11,172음절의 조합/경계와 두 새 폰트의 한글 11,172자 포함을 확인했다.
- 전각풍 음각과 매화문 회사 직인을 선택해 가상 계약서를 완료했다. 완료 PDF **42,369bytes**, SHA-256 `9ea310d11ef5110bb64b62c32dfef98c5a0d056346bc640a0e5fcb3469e52492`가 확인 기록과 일치한다. 최종 확인 PNG 4개의 픽셀과 이미지 예산을 검사하고 Poppler 렌더링을 확인했다.
- 최종 standalone 실행의 가상 요청 → OTP → 서명 → 완료 PDF를 통과했다. 새 두 서체를 포함한 6개 폰트가 HTTP 200·같은 SHA-256으로 제공되고 OFL 고지도 배포 파일에 포함되는지 확인했다.
- 자료: `F:/Dev/.work/esign-live-setup-20261018/seal-v2-qa/`. 디자인·출처·폰트 재현은 [SEAL_DESIGN.md](./SEAL_DESIGN.md)를 따른다. 실제 계약 발송/운영 반영 검수와는 별개다.

### 이름 도장·손글씨 선택 UX (2026-10-18)

- 격리 환경 Node.js 24.19.0: 테스트 파일 **111개, 1,414개 통과·실패/취소/건너뜀 0개**. 기존 실제 고객·메일·알림톡 전송과 분리했다.
- 도장 6종·손글씨 4종이 서로 다른 이미지이며, 한글·영문 이름과 8자 도장에서 글자 바깥 여백이 10px 이상인지 검사했다. 이름 변경 시 이전 선택과 미리보기 무효화, 빠른 연속 변경 시 최신 이름만 표시됨을 실제 Chrome에서 확인했다.
- 375×812 모바일에서 가로 넘침 없이 선택·삽입·그리기·최종 확인이 동작한다. 빈 그리기는 삽입되지 않고, 입력 방식을 전환하면 이전 그리기는 초기화된다. 기존 PNG 입력 경로를 유지했다. 이번 실제 파일 업로드 재검수는 확장 권한 확인 대기다.
- 한글 가상 계약서에 이중 원형 도장과 붓글씨 서명을 골라 이름·날짜와 함께 최종 제출했다. 완료 PDF **53,881bytes**, SHA-256 `eb8b055ada2aaffb2ea2e4345795674edd0d00db2053c72e3a8ad6d00a70d832`가 확인 기록과 일치한다. 최종 확인 화면의 PNG 4개와 PDF 내 이미지를 비교해 픽셀 보존·개별 80,000px/83,886bytes 한도를 확인했고 Poppler 렌더링을 시각 검수했다.
- 새 글씨체는 Google Fonts의 고정 revision 원본을 검증해 이름을 바꾸고 WOFF2로 변환했다. 글리프를 제거하지 않았고 OFL/저작권 고지를 포함한다. 총 약 2.6MB이며 전역 로딩·외부 폰트 서버 전송 없이 선택 화면에서만 불러온다.
- 최종 변경의 ESLint·webpack 배포 빌드·타입 검사·224개 페이지 생성과 standalone 가상 전체 흐름을 통과했다. standalone의 글씨체 4개가 HTTP 200·원본과 같은 SHA-256으로 제공되고 라이선스도 배포 산출물에 포함되는지 확인했다.
- CloudType `sendb-dev / dev`의 적용 소스 `1974527b00b9d9cccb915354b0c7797584d4468b`와 실행 중(1/1)을 확인했다. 실제 개발 주소에서 새 가상 OTP 인증 → 이름 도장 6종 생성 → 사각 인장 선택·문서 삽입 → 손글씨 4종 생성·선택을 확인했다. 기호만 있는 이름도 거절된다. `dev-live-ux.json`, `dev-seal-gallery.png`, `dev-signature-gallery.png`에 근거를 남겼다.
- 검수 자료: 로컬 `F:/Dev/.work/esign-live-setup-20261018/name-marks-qa/`의 전체 검사/빌드 로그, `browser-checks.json`, `pixel-checks.json`, 데스크톱·모바일 화면, 완료 PDF와 확인 기록. 실제 내부 메일 수신 검수나 운영 배포 완료 근거로 사용하지 않는다.

### 이메일 + 기존 알림톡 연결 (2026-10-18)

- Node.js 24.19.0, 격리 PostgreSQL/PGlite·가상 수신자·외부 네트워크 차단 환경에서 테스트 파일 **109개, 1,405개 통과·실패/취소/건너뜀 0개**다.
- `email + alimtalk` 및 기존 `email + sms` 각각을 조건부/암호문 주소 저장 방식으로 검사했다. PDF 업로드 → 템플릿 저장·복사 → 두 명 순차 요청 → OTP → 서명 → 완료 PDF·확인 기록까지 실제 HTTP handler/DB/worker로 통과했다.
- 알림톡 심사 요청/심사 중/반려/미확인, 차단·휴면, 본문/버튼 변경, 발신 채널 비정상은 발송 전에 차단한다. 정상/수신자 거절/누락/다른 수신자/서버 오류/타임아웃을 구분하고 자동 재시도·SMS 전환이 없음을 확인했다. OTP 인증 전용 API와 공급자 idempotency key도 검사했다.
- 신규 코드로 실제 NHN 상태를 **읽기 전용** 조회해 `@디자이너하이어`, 템플릿 3종 `심사 중`, `ready=false`를 확인했다. 실제 API와 콘솔에서 신청 내용이 일치했다. 카카오·SMS 실제 메시지는 보내지 않았다.
- 변경 TypeScript 파일 린트는 오류·경고 0개다. webpack 운영 형식 빌드·타입 검사·224개 페이지 생성과 standalone 자원 복사를 통과했다. 실제 standalone 서버의 가상 요청·OTP·서명·완료 PDF 전체 검수도 통과했다.
- 통합 전에 새로 올라온 트래커 비교 변경 `f26d938`를 보존했고 해당 추가 테스트 7개도 별도로 통과했다. 위 1,405개와 별도 검사 기록이다.
- 로그는 Git 밖 `F:/Dev/.work/esign-live-setup-20261018/alimtalk-qa/`의 `full-suite-result.json`, `tracker-comparison-result.json`, `full-build-result.json`, `live-provider-status.json`, `template-submissions.json`, `nhn-template-review-pending.png`에 보존한다. 자격증명은 기록하지 않았다.

승인 전 카카오 실수신 검수는 수행할 수 없다. 실제 계약 이메일 요청·OTP·완료 수신 전체 검수도 기존 Chrome 파일 선택 권한 대기 상태로 남아 있다. 이전에 확인한 메일은 발신자 확인 메일이며 계약 전체 수신 성공으로 해석하지 않는다.

개발 서비스의 기능 코드 `9c6fc5b` 적용됨·실행 중(1/1)을 확인했다. 인증된 실제 상태 API는 `emailReady=true`, `alimtalkReady=false`, `smsReady=false`, `databaseReady=true`, `storageReady=true`, `issues=[]`이며, 발신 채널과 3종 심사 중 상태도 화면과 일치했다. 기존 서버 계정·키를 사용하고 전자서명 알림톡 opt-in과 발신 채널 고정 값만 추가했다.

이후 화면 안내 문구만 다듬은 `f225436`도 개발 서비스 적용됨·실행 중(1/1)으로 확인했다. 변경 화면 3개 파일의 린트도 오류·경고 0개다. 배포 후 로그인·익명 API 차단·가상 PDF·한글 PDF 표시 자원 상태를 재확인했다. 발송·DB·서명 로직 변경은 없다.

배포 후 Chrome에서 가상 요청의 **알림톡 인증 선택 → 체험 코드 확인 → 이름 도장·이름·날짜 → 동의·제출 → 완료 PDF·확인 기록 다운로드**를 직접 수행했다. 내려받은 1페이지 PDF는 29,360바이트이며 SHA256 `103fa4b6f9be57ae3574ac7bebee4def801e0d48cdb4def0d0fad97bcf67cb76`이 확인 기록의 완료 파일 해시와 일치했다. `dev-live-status.json`, `dev-live-delivery-status.png`, `dev-preview-ui-qa.json`, `dev-preview-alimtalk-completed.png`, `dev-preview-completed.pdf`로 보존했다. 이 과정은 가상 자료·메모리 저장·캡처 발송만 사용했다.

### 개발 서버 실제 연결 준비 결과

코드 `399e914`의 CloudType `sendb-dev / dev` 적용됨·실행 중(1/1)을 확인했다. NHN 비공개 저장소 키와 새 저장 방식을 반영하고 개발 기능·worker를 켰다. Chrome의 인증된 상태 API는 `enabled=true`, `emailReady=true`, `smsReady=false`, `databaseReady=true`, `storageReady=true`, `issues=[]`다. 재배포 전 저장한 암호화 시험 객체를 같은 참조로 다시 읽어 내용 일치도 확인했다. `dev-live-esign-status.json`, `dev-email-enabled.png`, `nhn-storage-after-redeploy.json`에 보존했다.

실제 이메일 전체 흐름 검수는 법적 효력 없는 시험 PDF 선택 단계에서 대기 중이다. Chrome 확장프로그램의 파일 URL 접근 권한이 꺼져 `fileChooser.setFiles`가 거절됐으며, 설정 화면 `chrome://extensions`도 브라우저 URL 정책으로 거절됐다. 우회하지 않고 사용자 설정 완료를 요청했다. 실제 계약 요청·OTP·완료 알림은 아직 보내거나 수신 검수하지 않았다. 처음의 발신 확인 메일 수신과 구분한다.

NHN 연결 보완 후 최신 전체 검수는 Node.js 24.19.0에서 테스트 파일 **108개·1,380개 통과, 실패·건너뜀 0개**다. 조건부 PUT을 지원하지 않는 공급자의 501을 재현하고, 새 객체 주소에서 동시 저장·서명 재제출·완료 PDF/확인 기록까지 검사했다. 변경 파일 5개 린트도 오류·경고 0이다. 아래 1,370개는 NHN 저장 방식 보완 전 기록이다.

사용자가 키 발급·개발 서버 연결을 승인해 NHN S3 키 1개를 발급했다. 기존 방식은 실제 API에서 `501 Conditional object PUTs are not supported`로 실패했다. 이를 무조건 덮어쓰기로 재시도하지 않고 암호문 해시를 포함한 별도 버전 주소를 추가했다. 새 코드로 실제 NHN 암호화 저장·읽기·서로 다른 버전·기존 암호문 보존·잘못된 내용의 쓰기 차단을 통과했다. SDK 기본 체크섬 설정도 유지했다. `nhn-storage-content-live-qa.json`에 결과를 보존했으며 고객 문서를 사용하거나 객체를 삭제하지 않았다.

개발 서비스는 코드 `2f0df64`에서 Node 24로 재배포해 적용됨·실행 중(1/1), 실제 Node.js v24.3.0과 명시적 dev DB/서명 origin·기능/worker off를 확인했다. 로컬 Node 24 새 빌드·타입 검사·224페이지 생성·standalone 가상 전체 서명 흐름도 통과했다. 공개 dev 로그인·가상 PDF·한국어 문자표는 200, 미인증 체험 API는 401이다. `node24-deploy/`에 결과를 보존했다. 이후 저장소 호환 코드와 실행 설정 배포는 별도로 확인한다.

`bfc9b0a`의 CloudType `sendb-dev / dev` 적용됨·실행 중(1/1)을 확인했다. 서버에서 비밀 값 자체를 출력하지 않고 명시적인 전자서명 DB의 개발 호스트·기존 dev 연결과의 일치·개발 origin·기능/worker off를 검사했다. `/app/standalone/drizzle/esign/0001.sql`의 SHA256 `68ca79b0143c3a608b3ea9f57e7e9c515cd3027868380c09236bed214cdac910` 일치 후 portable DB 준비 명령을 실행해 전자서명 스키마 준비 완료를 확인했다. 고객 테이블 조회·변경과 운영 DB 접근은 없다. 경로와 결과를 `dev-db-ready.json`, `dev-db-ready.png`에 보존했다.

사용자는 새 계약 저장소에 Cloudflare를 사용하지 않도록 지시했다. 기존 R2 키로 새 버킷 생성을 시도한 결과는 403이며 생성된 버킷이나 삭제된 객체는 없다. 이후 R2 작업을 중단하고 기존 NHN 프로젝트에 계약 전용 컨테이너 `sendb-esign-dev-20261018-21ba51`을 생성했다. 콘솔의 성공 메시지와 `PRIVATE`·Standard·0개 객체 상태를 확인하고 `nhn-private-bucket.json`, `nhn-private-bucket.png`에 보존했다. 접근 키 발급은 사용자 확인 대기이며 키 등록·실제 읽기/쓰기·재시작 후 보존을 통과로 기록하지 않는다.

NHN SMS 공식 발신번호 조회는 HTTP 200·성공 응답이지만 지정한 번호가 없었다. 계정/키 유효성과 발신번호 승인은 구분한다. 콘솔 내부 등록 화면을 직접 열어 개인정보 수집 동의·본인 인증/명의 증빙 절차를 확인했으며 동의·등록 제출과 실제 SMS 발송은 하지 않았다. `sms-sender-readiness.json`, `sms-registration-consent.png`에 근거를 보존했다. 위 연결 준비는 자동 테스트 통과나 실제 계약 전체 수신 검수와 별개다.

### 실제 발송 준비 변경 검수

전자서명 전용 발신 주소와 standalone DB 준비 명령을 추가한 코드에서 Node.js 24.19.0 전체 테스트 파일 **107개·1,370개 통과, 실패·건너뜀 0개**를 확인했다. 전용 주소는 해당 조직의 프로필/기존 설정과 일치할 때만 사용하며, 잘못된 주소를 다른 브랜드로 대체하지 않는다. 조직 기본 발신자 보존·조직에 없는 주소 거부·이메일 단독 transport 접수도 검사했다.

배포용 빌드·타입 검사·224개 페이지 생성·배포 자료 복사를 통과했다. 전자서명 코드와 배포 스크립트 52개 파일 린트는 오류·경고 0이다. 이번 standalone 서버의 화면/인증 경계와 가상 요청·OTP·서명·완료 PDF 흐름도 다시 통과했다. 추가한 DB 준비 명령과 postgres 라이선스의 원본/배포 해시도 일치한다.

postgres 패키지가 없는 임시 standalone 구조에서 DB 준비 명령을 실행했다. 명시적인 `ESIGN_DATABASE_URL`이 없으면 `DATABASE_URL`이 있어도 연결하지 않고 실패하며, 별도 새 loopback DB에 두 번 실행해 전자서명 테이블 5개만 준비되고 public 테이블은 생성되지 않는 것을 확인했다.

기존 dev 이메일 계정으로 승인된 내부 주소 `ceo@matchesplan.com`에 **[Sendb] 발신자 이메일 확인** 1건을 보냈다. NHN 접수와 해당 Gmail 받은편지함 도착을 확인했고 dev에 전자서명용 발신 프로필을 저장했다. 이는 연결 테스트이며 실제 계약 요청·OTP·완료 알림 전체 실수신 검수는 비공개 저장소 연결 후 진행한다.

근거는 `F:/Dev/.work/esign-live-setup-20261018/`의 `full-suite-result.json`, `full-build-result.json`, `esign-lint.json`, `migration-cli-qa.json`, `standalone-http-qa.json`, `dev-preview-standalone-qa.json`, `email-live-receipt.json`에 보존했다. 아래 1,366개 결과는 전용 발신 주소를 추가하기 전의 검수 기록이다.

2026-10-18 코드 `c5a5478` 기준으로 저장소의 테스트 파일 106개를 모두 실행했다. Node.js 24.19.0에서 **1,366개 통과, 실패·취소·건너뜀 0개**다. 전자서명 검사와 실제 PostgreSQL의 동시 연결 검사도 포함한다. 실행 환경은 새 loopback 검수 DB와 가상 값만 사용하고 외부 네트워크를 차단했으며 실제 고객·공급자 자격증명은 불러오지 않았다.

- 배포용 webpack 빌드: 컴파일·타입 검사·224개 페이지 생성·standalone 자원/SQL/worker 복사 성공.
- 전자서명 코드·연결 route·검수/배포 스크립트 53개 파일 린트: 오류 0, 경고 0. 저장소 전체 린트 통과를 뜻하지 않으며 기존 records 페이지 오류는 아래 기록을 유지한다.
- 이번 빌드의 실제 standalone 서버: 로그인·트래커·전자서명·서명 화면과 CSS/JS·한국어 PDF 표시 자원 200, 미인증 API 401, 기능 off 계약 API 503. 배포 파일 해시 일치.
- 이번 빌드의 체험 전체 HTTP 흐름: 가상 양채널 발송함 → 확인 코드 → 인증 → 서명 제출 → 완료 → PDF 다운로드 통과. 완료 PDF는 3,664bytes·1페이지이며 실제 파서로 확인했다. 일반 전자서명 모듈은 계속 off다.
- 배포된 dev의 공개 검사: 로그인 200, 미인증 체험 상태 401, 가상 PDF 200·로컬 해시 일치, 한국어 문자표 200.

근거는 `F:/Dev/.work/esign-full-qa-20261018/`의 `full-suite-result.json`, `all-repository-tests.log`, `full-build-result.json`, `full-build.log`, `esign-lint.json`, `standalone-http-qa.json`, `dev-preview-standalone-qa.json`, `dev-public-health.json`에 보존했다. 검수용 standalone 서버는 확인 후 종료했다. 기능 코드 수정은 필요하지 않았다.

**실제 이메일·SMS 수신과 실제 계약용 저장소 연결 검수는 아직 미완료다.** 이번 통과는 격리 검사와 가상 발송 흐름에 대한 결과다. 계정·발신번호·저장소를 준비하고 승인된 내부 수신자로 실제 요청·확인 코드·완료 알림을 확인해야 한다. 설정 절차는 [OPERATIONS.md](./OPERATIONS.md)를 따른다.

## 문서와 필드

- [x] 정상 PDF의 실제 페이지 크기·개수·해시를 읽고 10MB·30페이지 한도를 적용한다.
- [x] 빈 파일, 확장자 위장, 깨진 PDF, 암호화 PDF, 과한 페이지·이미지를 거부한다.
- [x] PDF 직접 업로드와 템플릿 재사용에서 동일한 필드 배치를 사용한다.
- [x] 0·90·180·270도 회전, 다른 CropBox·페이지 크기, 50~200% 렌더링 확대에서 완료 PDF 위치가 맞는다.
- [x] 서명자별 필수 필드와 도장·이름·날짜·텍스트 PNG가 보존된다. 실제 화면 입력은 아래 브라우저 검수를 별도로 기록한다.
- [x] 원본과 완료 PDF의 키·해시는 다르며 원본을 덮어쓰지 않는다.
- [x] 계약 전체 이미지의 8MiB·800만 픽셀 한도를 서명 저장과 같은 트랜잭션에서 검사한다. 동시 제출에서 초과한 요청은 상태 변경 없이 거부하며, 같은 이미지의 재사용은 SHA로 중복 제거한다. 브라우저는 입력란별 80,000픽셀·83,886bytes 이내로 만들므로 최대 100개 입력란도 전체 한도에 맞는다.
- [x] 비내장 한국어 CID 폰트 PDF를 실제 브라우저에 올려 제목·본문·이름·날짜가 표시되는 것을 확인했다. `UniKS-UCS2-H.bcmap`, `Adobe-Korea1-UCS2.bcmap` 실제 요청 모두 200이다.

## 발송과 인증

- [x] 이메일 단독, SMS 단독, 두 채널 동시 선택이 각각 이메일·NHN SMS transport로 분기된다. 공급자 응답 fixture로 검사했으며 실제 발송 검사는 아니다.
- [x] 두 채널을 선택해도 계약과 서명자 링크를 중복 생성하지 않는다.
- [x] 잘못된 주소·번호·미설정 발신번호를 거부한다. `+82` 국내 번호도 정규화한다.
- [x] 공급자 거절·한 채널 실패·시간 초과·불확실한 접수·worker 재실행이 중복 발송으로 이어지지 않는다.
- [x] 확인 코드 만료·실패 횟수·재발송 대기·다른 서명자 코드가 검사된다. 안내 문구도 실제 5분 유효시간과 일치한다.
- [x] 오래된 일반 안내 작업이 쌓여 있어도 확인 코드를 먼저 처리한다. claim 이후 취소·만료·새 코드로 변경된 요청은 실제 transport 호출 전에 다시 검사한다.
- [x] 전자서명 모듈은 토큰·확인 코드·서명 PNG·계약 내용을 로그에 출력하지 않는다. 배포 프록시의 서명 URL 접근 로그 보관/가림 설정은 별도 확인 대상이다.

## 서명과 상태

- [x] 모바일(390×844)과 데스크톱에서 그리기·이름 도장·PNG 업로드 및 미리보기가 가능하다.
- [x] 빈 서명, 다른 서명자 칸 입력, 링크만 가진 미인증 입력을 거부한다.
- [x] 명시적인 동의 뒤에만 서명 상태가 저장된다. 실제 브라우저에서 최종 입력 미리보기·동의·제출까지 확인했다.
- [x] 복수 서명자의 병렬·순차 순서와 만료·거절·취소를 서버에서 검사한다.
- [x] 이중 클릭과 동시 서명 제출이 중복 기록이나 상태 역행을 만들지 않는다.
- [x] 서명이 끝나면 입력을 수정할 수 없다.
- [x] 완료 PDF 저장 실패나 worker 중단 시 완료로 표시하지 않고 제한적으로 재시도한다.
- [x] 완료 PDF와 진행 기록을 권한 있는 요청자·서명자만 다운로드한다.

## 운영 부담과 배포

- [x] 기존 고객·발송 테이블의 변경과 PDF bytes 저장이 없다. 메인 SQL journal 변경도 없다.
- [x] PDF.js는 전자서명 미리보기 컴포넌트에서만 동적 import한다. 공통 레이아웃에는 PDF import가 없다.
- [x] 외부 발송과 PDF 처리 동안 DB 트랜잭션·연결을 오래 보유하지 않는다.
- [x] 작업 배치·PDF 동시성·V8 heap·업로드 크기가 제한된다. 15초 hang 종료와 대기열 과부하 이후 회복도 통과했다.
- [x] 기능을 껐을 때 전자서명 worker를 import/시작하지 않고 DB를 조회하지 않는다. 기존 고객·발송 스키마는 새 빈 DB에 기존 마이그레이션 그대로 적용했다.
- [x] 격리 자료로 타입·린트·단위·상태 전이·DB·브라우저·PDF 시각 검수를 완료한다.
- [ ] 실제 시험 발송은 승인된 내부 수신자만 사용하고 성공·실패 결과를 확인한다.
- [ ] 운영 설정 준비와 사용자 검수 뒤 배포하며 문제 시 기능 플래그로 즉시 끌 수 있다.

## 보존한 검수 근거

- `F:/Dev/.work/esign-ui-qa-20261018/all-tests-final.log`: Node.js 24.19.0 최종 자동화 77개 통과(동시 실행 2개). OTP 우선순위·송신 직전 재검사도 포함한다.
- `F:/Dev/.work/esign-ui-qa-20261018/production-build-final.log`: 최종 Node.js 24.19.0 webpack 운영용 빌드 성공. 타입 검사·224개 페이지 생성·standalone 자료 복사까지 완료했다. 운영 배포를 실행했다는 뜻은 아니다.
- `F:/Dev/.work/esign-ui-qa-20261018/standalone-http-qa.json`: 실제 standalone 서버를 격리 DB와 기능 off로 시작해 로그인·트래커·전자서명·공개 서명 페이지, CSS/JS/favicon, 한국어 문자표·WASM을 200으로 확인했다. 미인증 API는 401, 기능 off의 계약 API는 503이며 worker·라이선스·SQL 해시도 원본과 일치한다. 누락됐던 standalone 공개 화면 자원 복사를 보완한 뒤 재검수했다.
- `F:/Dev/.work/esign-ui-qa-20261018/asset-http-regression.log`: PDF 표시 자원 경계 2개와 HTTP 전체 흐름 회귀 2개 통과.
- `F:/Dev/.work/esign-native-pg-20261018/native-checks.log`: 실제 PostgreSQL의 서로 다른 backend PID 두 개로 CAS·rollback·잠금·중복 서명·취소 경합·lease 복구 검증. deadlock 증가 0.
- `F:/Dev/.work/esign-native-pg-20261018/priority-checks.log`, `priority-native-index-checks.log`: OTP 우선 처리와 활성 작업 부분 인덱스 2개 확인. 작은 fixture에서는 `SET LOCAL enable_seqscan=off`로 적용 가능한 index 경로도 검사했으며 실제 운영 옵티마이저의 항상 선택·성능 보장은 아니다.
- `F:/Dev/.work/sendb-esign-pdf-20261018/render-verification.json`, `rotation-crop-visual.png`: Poppler로 12회 렌더링, 방향·위치 확인점 96개 일치, 입력란 바깥 픽셀 변경 0. 실제 AES 암호화 PDF도 거부했다.
- `scripts/migrate-esign.cjs`: 새 UI QA DB에 명시적으로 3회 실행해 재실행 가능함을 확인했다.
- 신규 전자서명 및 연결 파일 린트: 오류 0. `src/app/records/page.tsx`의 기존 렌더 중 `Math.random`/선언 순서 오류 2개·의존성 경고 1개는 HEAD 원본에서도 동일하게 재현했다. 이번 변경은 해당 파일에 workspaceId 전달 1줄만 추가한다.

실제 postgres.js를 검수하면서 JSONB 이중 직렬화 문제를 발견·수정했다. PGlite 단독 통과를 실제 다중 연결 검증으로 대체해서 기록하지 않는다. 실제 이메일/SMS·운영 비공개 저장소는 이 격리 검수의 범위에 포함되지 않는다.

2026-10-18 사용자가 SMS 계정·등록 발신번호와 계약용 저장소 미준비를 확인했다. 실제 발송·운영 활성화 항목은 체크하지 않았으며 준비 절차는 OPERATIONS 문서에 정리했다.

## 실제 화면 검수

Playwright의 새 headless Chrome 세션에서 localhost 3158만 사용했다. 사용자의 기존 모두싸인·운영 Chrome 탭과 프로필은 검수에 사용하지 않았다. CUA Chrome 제어 시간 초과와 IAB unavailable은 통과로 기록하지 않았으며, 이후 별도 브라우저로 실제 화면 동작을 검수했다.

PDF 업로드 → 5종 입력란 배치 → 템플릿 저장 → 원본 보존 복사 → 가상 고객 이메일/SMS 선택 → 최종 발송 확인 → 두 채널 접수 → SMS 확인 코드 → 모바일 서명·도장·PNG·한글 이름·날짜·텍스트 → 동의·최종 확인 → 완료 PDF/확인 기록 다운로드를 통과했다. 완료 PDF 생성 중에는 내려받기 버튼이 비활성화되는 것도 확인했다. 빈 서명과 필드 누락을 차단했고 PNG를 PDF로 올리면 400을 반환했다.

화면과 실제 다운로드는 `F:/Dev/.work/esign-ui-qa-20261018/`의 `02-review.png`부터 `11-korean-preview-ready.png`, `completed-browser.pdf`, `completed-browser-audit.json`에 보존했다. root가 모바일 완료·직원 완료·한국어 CID·체험 화면을 직접 시각 확인했다.

최종 전역 이미지 예산 수정 후 격리 API를 재시작하고 새 한글 계약서로 전체 흐름을 다시 통과했다. `final-backend-raster-metadata.json`에 실제 5종 입력 합계 391,019픽셀·65,190bytes와 개별 한도 통과를 보존했다. `15-final-backend-quality-top.png`, `16-final-backend-quality-bottom.png`, `17-final-backend-completed.png`, `completed-final-backend-browser.pdf`와 개인 확인 기록이 결과물이다. root가 이미지 축소 후 서명·도장·한글의 읽힘과 최종 완료 화면을 직접 확인했다.

사용자 체험: `http://127.0.0.1:3158/esign` → **서명 요청 → 한글 계약서 체험 (가상 자료)**. 이 로컬 체험은 실제 발송을 하지 않는다.

## dev 가상 체험 추가 검수

사용자가 dev에서 직접 예시를 확인하도록 요청해 `/esign?preview=1`과 개발 전용 API를 추가했다. `dev-preview-tests.log`에서 기존 검사와 신규 체험 검사 **79개 통과, 실패·건너뜀 0개**를 확인했다. 지정된 개발 origin과 명시적 opt-in이 함께 있을 때만 활성화되며, 비활성·미인증 요청은 메모리 런타임을 생성하지 않는다. 실제 주소·번호를 거부하고 가상 요청·OTP·서명·완료 PDF를 기존 HTTP handler와 worker로 처리했다. 다른 조직의 가상 발송함은 분리된다. 실제 DB나 전송 공급자를 쓰지 않는다. 새 코드·관련 화면·로컬 검수 스크립트 린트도 통과했다.

`dev-preview-build.log`에서 Node.js 24.19.0 최종 webpack 빌드·타입 검사·224개 페이지 생성·standalone 자원 복사 성공을 확인했다. 새 체험 API도 배포 대상 route에 포함된다.

`dev-preview-standalone-qa.json`: 실제 배포용 서버에서 별도 가상 JWT로 로그인 경계를 검수했다. 미인증 체험 상태 API는 401, 인증 후 예시 문서·양채널 발송함·공개 OTP·코드 확인·서명 제출·완료 상태는 200이다. 완료 PDF(3,664bytes)는 실제 PDF 파서로 1페이지를 확인했다. 일반 전자서명 모듈의 상태는 여전히 enabled=false다. 이 검수도 새 격리 DB 외 실제 고객 DB를 사용하지 않았다.

Chrome에서 체험 안내·디하 가상 사업·발송함·예시 서명 진행 중 목록이 표시되는 것을 직접 확인했다. 고객 페이지의 새 빈 탭을 관찰하려던 도구 요청은 URL 정책에 막혀 로컬 브라우저 전체 서명 통과로 기록하지 않는다. 고객 흐름은 위 HTTP/worker 검사와 이전 가상 자료 전체 화면 검수로 구분한다. 개발 배포 후 접근 결과는 별도로 확인한다.

### 실제 dev 배포 후 검수

2026-10-18 CloudType에서 `sendb-dev`, 브랜치 `dev`, 소스 커밋 `54065de8b21eab47f8279c58b61aafd1d410d5f8`의 적용됨과 실행 중(1/1)을 확인했다. Node 22 배포 환경의 빌드·타입 검사·224개 페이지 생성이 성공했다. 새 체험 플래그만 추가했으며 기존 DB 연결·비밀 값·워커 off 설정은 바꾸지 않았다. 직전 실행 커밋 `090077e`와 새 코드 사이의 main SQL journal/기존 마이그레이션 차이는 없고 별도 전자서명 SQL만 추가됐다.

공개 HTTP 검사에서 체험 API 미인증 401, 가상 PDF 200·로컬 원본 해시 일치, 한국어 문자표 200을 확인했다. 기존 로그인 상태의 Chrome으로 실제 dev 체험 화면을 열어 디하·백오랩 예시를 준비했다. dev 화면에 명시된 HTTPS 고객 주소를 별도 탭으로 열어 백오랩의 가상 SMS 코드 → 코드 확인 → 도장·이름·날짜 → 동의·제출 → 완료를 실제 검수했다. 로컬의 빈 탭 관찰 차단을 통과로 바꾸지 않고 별도의 dev 주소 검수로 기록한다.

`dev-live-qa.json`, `dev-live-preview.png`, `dev-live-completed.png`, `dev-live-completed.pdf`, `dev-live-audit.json`을 검수 디렉토리에 보존했다. 완료 PDF는 실제 Downloads 폴더에 저장된 29,360bytes·1페이지이며 개인 확인 기록의 최종 SHA256과 일치한다. 브라우저 다운로드 이벤트 대기는 시간 초과했지만 실제 저장 파일을 별도로 확인·파싱했다. 디하 요청은 미완료 상태로 남겨 직접 체험할 수 있게 했다. 실제 전송과 운영 활성화는 하지 않았다.
