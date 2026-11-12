# Sendb 개발 작업 규칙

## 작업 환경

- 기준 브랜치는 `main`이다. `main`은 운영 서버(CloudType `sendb`)에 배포되는 브랜치다. `dev` 브랜치는 더 이상 `main`과 맞춰 두지 않으며 기본 작업 대상이 아니다.
- 시작할 때 작업 트리 상태를 확인하고 기존 변경을 보존한다.
- 개발자 검토와 사용자의 운영 반영 요청 없이 `main`에 푸시·병합하거나 운영 서비스를 배포하지 않는다.
- CloudType 프로젝트: https://app.cloudtype.io/@pjk8197/project:main (URL의 `project:main`은 프로젝트 환경 이름이며 Git 브랜치가 아니다.)

## 데이터와 외부 발송

- 개발·운영이 R2를 공유하므로 개발 환경에서도 R2 파일 삭제를 시험하지 않는다.
- 고객 여정 기능은 검토 동안 `off` 또는 격리된 시험 환경의 `dry_run`으로 확인한다. 개발 환경을 운영으로 위장하거나 실제 전송 시험 플래그를 켜지 않는다.
- 웹훅·API 키·DB 접속 정보는 저장소, PR 설명, 문서, 터미널 출력에 넣지 않는다.

## 상담 이력과 고객 식별

- 확인된 회원 ID/명시된 기존 CRM 연결과 메일 링크·방문 브라우저의 유입 근거를 구분한다. 브라우저/입력 이메일만으로 회원 본인이나 과거 상담 공개 권한을 부여하지 않는다.
- 과거 채널톡 상담은 확인된 고객 본인과 직원만 이어 본다. 고객에는 공개 대화만 제공하고 내부 메모·메모 첨부는 직원 전용으로 유지한다. 과거 상담은 읽기 전용이다.
- 확인되지 않은 이름·이메일·익명 원본 ID로 고객을 자동 연결하지 않는다.

## 검토와 참고

- PR 생성은 운영 배포 승인이 아니다. 운영 반영용 PR은 자동 병합하지 않는다.
- 폴더 구조·재사용·API 응답 규칙은 `CLAUDE.md`를 따른다. 커밋 메시지는 한국어로 쓴다. 기존 대화에서 받은 커밋 승인을 반복해서 묻지 않는다.
- 현재 고객 여정 검토와 배포 상태는 `docs/2026-10-11-customer-journey/HANDOFF.md`를 확인한다.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
