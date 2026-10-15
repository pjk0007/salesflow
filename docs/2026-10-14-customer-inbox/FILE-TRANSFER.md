# 채널톡 보관 첨부 일괄 보충

2026-10-15 · D1 개발 브랜치 `codex/sendb-file-transfer`. [원본 추출 도구](IMPORTS.md#채널톡-내보내기-cli)의 PR #16 위에서 검토하는 후속이다. 검증된 로컬 바이트와 **이미 가져온 상담의 파일 목록**을 연결해 검토 계획을 만들고, 사람이 승인한 계획만 기존 단건 `uploadImportFile`로 순서대로 보충한다. 서버·DB·SDK 계약과 마이그레이션은 추가하지 않았다.

## 준비와 검토

원본 추출을 종료하고 `--include-files`로 만든 보관 폴더를 준비한다. `chunks/`는 먼저 같은 사업·`source=channel`·namespace로 검토/가져오기를 마쳐야 한다. 오래된 가져오기 작업에 파일 목록이 없으면 기존 관리 화면에서 준비한다. 이 CLI는 CRM 자료 가져오기나 파일 목록 준비를 대신 실행하지 않는다.

`scripts/supplement-channel-source-files.cjs`는 로컬 원본 manifest/checkpoint/receipt와 실제 가져오기 작업·원본행·파일 목록의 모든 페이지를 대조한다. 상담 ID, `${chatId}/${messageId}`, 파일 key/index/sourceKey와 메타데이터 버전으로 유일하게 연결하며 이름만으로 추정하지 않는다. 같은 바이트라도 다른 메시지·공개 답변·비공개 메모의 관계는 각각 유지한다. 중복 후보·원본 누락·손상 바이트·이전 버전은 차단 행이나 미연결 대상으로 남긴다.

기본 검수는 허구 대상 fixture를 사용하며 네트워크를 호출하지 않는다. 출력 폴더는 원본 보관 폴더 밖의 새 위치여야 한다.

```sh
node scripts/supplement-channel-source-files.cjs --export-dir <closed-export> --fixture <fictional-targets.json> --out <new-review-directory> --workspace-id 8 --namespace fictional-demo --channel-id qa-fictional-channel-export
```

fixture 형식은 `--help`에서 확인한다. 이는 SDK 응답 계약의 로컬 모의 실행이며 실제 API/DB 저장의 증거가 아니다. `fixture-state.json`은 다음 모의 실행의 fixture로 사용할 수 있다. 실제 대상 조회는 `--fixture` 대신 명시적인 `--online --api-base <exact-origin>`과 프로세스 환경변수 `SENDB_FILE_TRANSFER_API_TOKEN`을 요구한다. `.env`를 읽지 않으며 키를 문서나 출력에 기록하지 않는다. `--online`만으로는 조회·계획 생성만 한다.

`plan.json`의 사업·계정·대상 origin, 파일별 관계와 보충/완료/차단/미연결 결과 및 SHA-256을 검토한다. `--job-ids id1,id2`로 검토할 기존 가져오기 작업을 제한할 수 있다. 계획의 SHA에는 실행 모드·대상 origin·원본 파일 해시와 대상 버전이 포함된다. 모의 실행→실제 API 또는 대상 origin 변경에는 새 계획 검토가 필요하다.

## 승인한 계획 실행과 재개

같은 인수에 `--execute --approve-sha256 <reviewed-plan-sha256>`를 추가해야 보충을 실행한다. 실행 때는 `--job-ids`를 다시 지정하지 않는다. 중단 후에는 같은 계획과 승인 SHA에 `--resume`을 추가한다. 실제 대상 쓰기에는 `--online`, `--execute`, 승인 SHA가 모두 필요하다. 이 개발 검수에서는 실제 키·계정·고객 DB를 사용하지 않았다.

실행 직전에 로컬 원본 파일 해시와 대상 사업·namespace·관계·버전을 다시 확인한다. 파일 바이트 SHA/크기를 확인한 뒤 기존 multipart API에 원본 이름으로 전송하고, 응답으로 받은 첨부를 **보호된 다운로드 API로 다시 읽어 SHA/크기를 대조**한다. 이미 완료된 파일이나 재개 시 확인하는 파일에도 이 검증을 적용한다. 다른 관리자가 같은 이름·크기의 다른 내용으로 먼저 완료한 경우는 덮어쓰지 않고 `target_bytes_mismatch`로 중단한다. 원본 버전/CAS·권한 변경도 중단하며 새 검토 없이 최신 버전을 자동 채택하지 않는다.

실행 결과의 `targetVerified`는 대상에 원본과 같은 바이트가 있음을 확인한 수다. `uploaded`는 POST 응답 후 내용 검증까지 끝난 수이며, 해당 POST가 새 첨부를 만들었다는 증거는 아니다. 같은 바이트를 다른 관리자가 먼저 저장할 수 있으므로 **`newAttachmentsCreated:null`**을 유지한다. `complete`는 승인한 선택 범위의 완료이며 전체 계정 이전 완료를 의미하지 않는다. 차단·미연결·미확정 수와 파일별 사유를 함께 확인한다.

서버 저장 후 응답이 사라지거나 보호 다운로드 전에 취소되면 `failed/operation_uncertain`과 해당 파일의 `unknown` 상태를 남긴다. 재개 시 현재 완료 상태와 실제 바이트를 확인해 중복 POST 없이 이어갈 수 있다. 다음 작업 전에 취소하면 새 전송을 시작하지 않고 이미 확인한 결과를 보존한다. 결과·체크포인트는 원자 저장하며 같은 검토 폴더의 동시 실행은 잠금으로 막는다. 프로세스 강제 종료 후 잠금이 남으면 실행 중인 프로세스와 기록을 확인한 뒤 수동으로 제거해야 하며 자동 우회하지 않는다.

## 검증과 범위

승인된 소스 7개를 추출 도구 커밋 `65f2d04b2f067d7bc7037172d8fc606bcafe2b13` 위에 통합했다. Git 줄바꿈을 정규화한 SHA-256이 승인 패치와 모두 같으며 기존 exporter/API 소스는 변경하지 않았다. 세부 해시·로그와 검증 기록은 `evidence-manifest.json`의 `channelFileTransferQa`에 있다.

- 코어 28개·로컬/CLI 11개 단위 검사: 유일 매칭, 페이지 누락 방지, 손상·경로 이탈 거절, 승인 SHA와 대상 origin/모드 고정, 중단/재개와 대상 바이트 증명을 확인했다.
- 실제 API·메모리 PGlite 9개 흐름: 허구 원본 첨부 124개를 3개 가져오기 묶음과 100개 파일 페이지 경계로 처리했다. 실제 multipart 124회, 보호 다운로드 124개 SHA 일치, 최종 `targetVerified:124`, 내부 메모 4개 격리를 확인했다.
- 실제 CLI→SDK→API 5개 흐름과 ready 경합 4개 경계: 권한/CAS, 목적지 변경 거절, 응답 유실/취소 재개, 다른 바이트 거절 및 같은 바이트의 관계 증명을 확인했다. 경합 전 실패 재현과 수정 후 결과를 함께 보존했다.
- 통합 트리 전체 단위 1,256개·타입·변경 파일 lint·네트워크 차단 전체 webpack 빌드를 확인한다. 기존 124개 파일/CLI/경합/UI 검수는 내용 해시가 같은 승인 증거를 승계했으며 이번 통합에서 반복하지 않았다.

실제 ChannelTalk 계정의 접근 가능 범위·원본 총계·수집 시점 일관성과 실제 대상 서버/Firebase/고객 파일은 미검수다. 로컬 해시는 승인 자료의 변경·손상을 확인하며 공급자 서명이나 전체 원본 완전성을 증명하지 않는다. 기존 파일당 20MiB·사업별 저장 한도와 과거 상담의 직원 전용 정책을 유지한다. 실제 원본 전체 이전·대용량 정책·현업 전환/복귀 인수와 R16은 남아 있으며, 이 PR은 병합·배포 승인이 아니다.
