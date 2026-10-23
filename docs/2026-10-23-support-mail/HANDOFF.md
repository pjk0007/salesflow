# 통합 support 메일함의 사업별 수신·답장

## 수정 내용

사업의 문의 주소(`address`)와 실제 Google 로그인 계정(`googleAccount`)을 구분한다. 예를 들어 오피오 문의 주소는 `support@offio.kr`, 로그인 계정은 `support@100office.kr`로 등록한다. 같은 Google 계정으로 서로 다른 사업의 문의 주소를 연결할 수 있다. 기존 메일함은 로그인 계정이 비어 있으면 기존 주소를 그대로 사용한다.

각 사업에는 등록된 문의 주소가 To/Cc/Delivered-To에 포함된 원본만 수신한다. 답장은 그 사업 문의 주소를 From으로 사용한다. Google 승인 완료와 매 답장 발송 전 Gmail의 인증된 Send Mail As 주소를 읽어 확인한다. 미인증·삭제·조회 실패 시 기본 주소로 대체하지 않고 발송을 차단한다. Gmail 설정을 수정하거나 별칭 인증 메일을 보내지는 않는다. 기존 gmail.readonly·gmail.send 범위로 작동하며 추가 OAuth 범위를 요구하지 않는다.

전체 회신에서 사업 문의 주소와 통합 로그인 계정 자신을 제외한다. 사업 접근 권한, 토큰 암호화·연결 세대, 중지/해제 시 대기 발송 취소 및 조직 전체 수신거부 차단을 유지한다. 로그인 계정 변경은 기존 Google 연결을 해제한 뒤 가능하고 수신·발송을 중지한다.

`0124_inbox_google_account.sql`은 기존 메일함에 nullable 컬럼 하나를 추가한다. 기존 데이터·연결 상태를 변경하지 않는다.

## 운영에서 확인한 상태 (2026-10-23)

- 운영 CloudType `sendb`, Git `main`, Node 24 / standalone.
- 서비스 설정의 환경변수 이름을 확인했으며 `CUSTOMER_EMAIL_GOOGLE_CLIENT_ID`, `CUSTOMER_EMAIL_GOOGLE_CLIENT_SECRET`, `CUSTOMER_EMAIL_GOOGLE_REDIRECT_URI`, `CUSTOMER_EMAIL_WORKER`는 미등록이다. 비밀값을 열거나 복사하지 않았다.
- 고객상담의 백오피스랩에 `매치스플랜 서포트 / support@100office.kr` 메일함이 등록돼 있고 Google 미연결·수신 발송 중지 상태다. 디자이너하이어에는 메일함이 아직 없다.
- 현재 로그인된 Google Cloud 계정은 ceo@matchesplan.com이며, 선택된 프로젝트의 OAuth 목록에서 샌드비 전용 앱을 확인하지 못했다. `sendb` 프로젝트 검색 결과도 없다. 다른 계정/프로젝트 전체에 앱이 없다는 뜻은 아니다.
- 실제 Google 계정 승인·운영 환경변수 변경·메일 발송·운영 자료 수정은 하지 않았다.

## 실제 연결을 마치는 순서

1. 회사 관리 Google Cloud 프로젝트에서 Gmail API와 웹 앱 OAuth 클라이언트를 준비한다. 리디렉션 URI는 정확히 `https://sendb.kr/api/email-google/callback`으로 등록한다. Google 앱 사용 대상·조직 정책도 확인한다. 기존 다른 서비스의 OAuth 앱을 임의 변경하지 않는다.
2. 발급한 ID/비밀값과 위 URI를 CloudType `sendb`의 `CUSTOMER_EMAIL_GOOGLE_CLIENT_ID`, `CUSTOMER_EMAIL_GOOGLE_CLIENT_SECRET`, `CUSTOMER_EMAIL_GOOGLE_REDIRECT_URI`에 서버 전용으로 등록한다. 토큰 저장용 암호화 키는 `CUSTOMER_EMAIL_ENCRYPTION_KEY` 또는 기존 안정된 `JWT_SECRET`을 사용한다. 새 앱/메일 접근 권한 발급은 사용자 확인 후 진행한다. 비밀값은 채팅·문서·Git에 넣지 않는다.
3. 이 변경의 main 반영·운영 배포와 0124 마이그레이션 완료를 확인한다.
4. 사업별 상담함에 **사업 문의 주소**와 **Google 로그인 계정**을 등록한다. 문의 주소는 Gmail의 '다른 주소에서 메일 보내기'에서 인증돼 있어야 한다. 보내는 이름은 메일함 이름을 사용하므로 `support`로 보이게 하려면 메일함 이름도 `support`로 등록한다.
5. 해당 사업 메일함에서 Google 계정을 연결하고 읽기·발송을 승인한다. 계정은 등록한 로그인 계정과 같아야 한다. 수신 시작 범위는 업무 담당자와 정한다.
6. `CUSTOMER_EMAIL_WORKER=on`으로 서버 자동 처리를 활성화하고, 승인된 메일함별 수신·발송을 켠다. 기존 통합 기본 주소 메일함은 전체 브랜드 문의를 받을 수 있으므로 사업별 문의 주소 설정을 마치기 전에 일괄 활성화하지 않는다.
7. 직원 시험 메일로 브랜드 주소별 수신 격리·From/표시 이름·전체 회신 대상·첨부·중복 여부를 확인한다. 실제 고객 대상 시험 발송은 하지 않는다.

오피오/디하/매치스플랜/픽셀앤로직은 공유된 주소를 사용한다. 설비지원몰·KSFC는 DNS·도메인·Gmail 발신 인증 완료 후 등록한다. `dihi@matchesplan.com`, `contact@ksfcenter.com`처럼 한 사업에 주소가 여러 개면 각각 같은 로그인 계정으로 등록한다. 이번 변경은 Gmail의 라벨을 샌드비 라벨로 복제하는 기능을 포함하지 않는다.

## 검증

- 단위 검사 20개: 기존 MIME·수신·회신 대상 + 별칭 인증/오류/정규화/자기 회신 차단.
- `node --import tsx scripts/check-inbox-google-aliases.cjs`: 플랫폼 11 + 기존 Google 19 + 새 별칭 7개 통과. 두 사업의 같은 계정 승인, 미인증 차단, 다른 조직 차단, 사업 수신 격리, From 유지, 발신 인증 회수 후 차단, 계정 변경 시 중지/세대를 실제 PGlite와 가상 Google HTTP로 확인했다.
- `node --import tsx scripts/check-email-suppression-transport.cjs`: 플랫폼 11 + 이메일 14 + NHN/Gmail 조직 수신거부 회귀 검사 통과. 실제 외부 발송·운영 DB 접근 0건.
- 타입 검사·변경 파일 ESLint·운영 webpack 빌드 통과. 정적 페이지 231개 생성과 SQL 마이그레이션 126개 standalone 패키징을 확인했다. 빌드는 접근 불가능한 로컬 더미 DB 설정을 사용했다.

공식 근거: [sendAs.list의 gmail.readonly 지원](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.sendAs/list), [인증 상태 accepted](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.sendAs), [웹 OAuth 연결](https://developers.google.com/workspace/gmail/api/auth/web-server).
