# 전자서명 운영 반영과 실제 검수 — 2026-10-18

개발 실제 이메일 검수 후 사용자의 운영 배포 요청과 운영 저장소 연결 승인을 받아 CloudType **sendb / main**에 반영했다. 기능 코드 `a02095291949f63a9c78c083191edddecae3a62c`는 적용됨·실행 중(1/1)이며, 운영에서도 실제 이메일 전 과정을 통과했다. 이 기록 커밋은 문서만 변경한다.

## 현재 운영 상태

- 접속: https://sendb.kr/esign. `ESIGN_ENABLED=on`, `ESIGN_WORKER=on`, `ESIGN_PREVIEW=off`, `ESIGN_ALIMTALK=off`.
- 인증된 상태 응답: enabled / emailReady / databaseReady / storageReady **true**, issues **빈 배열**. SMS·알림톡은 false다.
- Node.js는 기존 22.4.1에서 검수한 24 계열로 맞췄으며 실제 컨테이너는 **v24.3.0**이다. 기존 메일·상담 worker 설정은 유지했다.
- 운영 DB 호스트 `salesflow-db`, 명시적인 전자서명 연결과 기존 DB 연결의 일치를 확인했다. 배포 SQL SHA-256 `68ca79b0143c3a608b3ea9f57e7e9c515cd3027868380c09236bed214cdac910`과 사전 조건을 검사한 뒤 전용 스키마 준비가 exit 0으로 완료됐다.
- 계약 발신 프로필 `전자서명 · 김이삭` / `ceo@matchesplan.com`을 추가하고 실제 확인 메일 수신을 확인했다. 기존 조직 기본 발신자는 유지했다.

## 운영 실제 이메일 검수

- 운영 `테스트 DB` 워크스페이스의 `QA-PROD-20261018-01`만 사용했다. PDF에 법적·금전적 효력이 없는 가상 내부 시험이라고 명시했다. 실제 고객이나 작성 중인 문서는 사용하지 않았다.
- 발신·수신 `ceo@matchesplan.com`: 요청 **21:21:20**, 인증코드 **21:22:05**, 완료 **21:23:20 KST**의 실제 받은편지함 도착을 확인했다. 요청·완료 링크의 origin은 모두 `https://sendb.kr`이며 SPF/DKIM/DMARC pass다.
- 실제 수신 코드로 인증 → 손글씨 선택 → 가상 회사 매화문 직인·고전 명조 선택 → 이름·날짜 입력 → 최종 확인·제출을 완료했다.
- 서명자 확인 기록과 직원 완료 PDF를 각각 실제 내려받았다. PDF **53,882bytes·1페이지**, SHA-256 `b672de71e11b5c05fae6e71fec7f7a029a3699489b660dd06b7bde7f6601c5b1`이 기록과 일치한다. 원본 해시·최종 입력 PNG 4개 픽셀 보존·이미지 예산을 검사하고 Poppler 렌더링도 시각 검수했다.
- 완료 후 동일 활성 빌드의 재배포 요청은 컨테이너를 교체하지 않아 재시작 통과로 기록하지 않았다. 문서만 추가한 `cf4e17f7da19c27507366d6b7b73648780126b69`를 최종 배포하고 적용됨·실행 중(1/1)을 확인했다. 기능 소스는 최초 실제 이메일 검수 코드와 동일하다.
- 근거: `F:/Dev/.work/esign-live-setup-20261018/production-live-qa/production-email-result.json`, `audit.json`, `completed.pdf`, 최종 입력 이미지·화면. OTP 값, 서명 URL, 비밀키는 Git 문서에 넣지 않는다.

## 서버 교체 후 보존 검수 통과

- CloudType 이벤트에서 기존 `salesflow-node-5b94bb89d5-8v6rq` 종료·삭제와 새 `salesflow-node-8576dd6b96-99d4d` 시작을 확인했다. 새 서버 실행 상태는 **1/1**이다.
- 새 직원 탭에서 같은 요청이 완료 상태로 복원됐다. **21:33:17 KST**에 다시 내려받은 완료 PDF **53,882bytes**는 이전 SHA-256과 정확히 일치한다. 상태 API도 이메일·DB·저장소 준비 true, issues 없음이다.
- 재시작 이후 요청/OTP/완료 메일은 각각 기존 1건으로, 자동 중복 발송이 관찰되지 않았다. 이후 완료 메일 링크의 재방문 검수를 위해 OTP를 의도적으로 1회 더 요청했고 **21:33:55** 실제 수신·재인증 후 **21:34:23** 서명자 완료 PDF 다운로드를 통과했다. 이 파일도 동일한 해시다. 재방문 때 본인 인증을 다시 받으며 완료된 문서를 다시 서명하지 않는다.
- 근거: 같은 디렉터리의 `restart-result.json`, `completed-after-restart.pdf`, `completed-returning-signer.pdf`, `post-restart-mail-counts.json`, `status-after-restart.json`, 완료 화면. 설정 준비용 임시 자격증명 파일은 로컬에서 제거했다.
- 최종 보존 결과를 적는 후속 커밋은 문서만 바꾼다. 실제 운영 아티팩트는 위 `cf4e17f`이고 기능 재배포나 추가 발송을 요구하지 않는다.

## 남은 채널

전자서명용 `SB_ESIGN_REQ_V1`, `SB_ESIGN_OTP_V1`, `SB_ESIGN_DONE_V1`은 최신 조회에서도 모두 **심사 중**이다. 이번 실제 검수는 이메일로 진행했으며 알림톡·SMS는 보내지 않았다. 알림톡 승인 후 내부 수신 검수와 운영 opt-in을 별도로 진행해야 한다.

## 운영 구성과 중지 방법

- 대상: CloudType **sendb**, 내부 서비스 식별자 **salesflow**, Git **main**. 기존 운영 코드 `f87de560`의 트래커·상담·메일 기능을 유지한다.
- 코드: 전자서명 관련 변경만 결합한 운영 준비본. 격리 테스트 **1,480개**, 빌드·타입·224개 페이지·standalone 검수 통과.
- 파일: NHN **sendb-esign-prod-20261018-b71e42** 새 운영 전용 버킷. 버킷·시험 객체의 인증된 ACL은 소유자만 허용하며 공개 그룹 권한이 없다. 암호화 저장·읽기를 확인했다. 인증 없는 S3 요청의 400 응답은 권한 검증으로 해석하지 않는다.
- 키: 이미 발급한 NHN 프로젝트 S3 키를 재사용한다. 이 키는 버킷 한 개만으로 제한된 키가 아니므로 운영 앱에 연결하면 해당 NHN 프로젝트 저장소에 접근할 수 있다. 새 S3 키 발급은 없다. 계약 암호화 값은 운영 전용으로 새로 만든다.
- DB: 운영 서비스의 기존 DB 연결을 명시적인 `ESIGN_DATABASE_URL`로 지정하고 **esign namespace의 전용 테이블 5개**만 준비한다. 고객·영업 테이블이나 메인 마이그레이션 journal은 변경하지 않는다.
- 발신: 계약 메일 발신만 `ceo@matchesplan.com`. 조직 전체 기본 발신자는 그대로 둔다. 알림톡은 승인 상태를 확인하기 전 활성화하지 않는다. SMS는 켜지 않는다.
- 배포: 기능·worker off → 배포 파일/Node 버전/SQL 해시/DB 대상 확인 → 전자서명 SQL 적용 → 준비 상태 확인 → 기능·worker on → 운영 화면·파일 보존 확인.
- 중지: `ESIGN_ENABLED=off`, `ESIGN_WORKER=off`로 새 전자서명 처리를 멈춘다. 완료 파일·원본·기존 고객 데이터는 보존한다.

격리·개발 검수 근거는 [RELEASE_PREP.md](./RELEASE_PREP.md)를 따른다. 저장소/SQL/배포 근거는 `F:/Dev/.work/esign-live-setup-20261018/actual-email-qa/`에 보존했다.
