# 고객 플랫폼 대체 · 분석 근거

2026-10-14에 확인한 배포 SDK와 공식 계약, 공개 소스 구조를 기준으로 샌드비의 API/SDK·상담·CRM 구조를 설계한다. 인터컴과 허브스팟은 사용자 계정이 없어 실제 계정 화면이나 서버의 동작을 관찰하지 않았다. 공개 SDK 정적 분석으로 SaaS 전체를 복제했다고 판단하지 않는다.

## 공식 배포 아티팩트와 REA

REA CLI 6.4.0, Node 22.23.3으로 다음 **선택된 컴파일 JS**를 분석했다. npm 패키지·원본 파일·전체 Evidence JSON은 로컬 검증 산출물에 보존했다. 모든 JS가 파싱됐지만, 외부 모듈과 실행 환경을 포함한 의미 분석에는 미확인 항목이 있다.

| 대상 | 분석 입력 | REA Evidence | 의미 분석 미확인 |
|---|---|---|---:|
| `@channel.io/channel-web-sdk-loader@2.0.2` | `dist/index.cjs.js` | `ev_a470ee2760cc74a6e6d180f37b4cc7b022842eeb735847bca4bde79337fecaab` | 140 |
| `@intercom/messenger-js-sdk@0.0.20` | index / instance-manager / constants JS | `ev_8515b83d8e8a14e22afa1021464165b8531e84be53ced3dd0c27bd3ba001a1da` | 271 |
| `intercom-client@7.0.3` | contacts / companies / conversations Client JS | `ev_239357329c0df93b688e251e22452cad09e2bfb0cfd180a48f217e52cbe26650` | 4,116 |
| `@hubspot/api-client@14.0.1` | contacts / companies / deals BasicApi, PipelinesApi, SubscriptionsApi JS | `ev_924c71d6f8b3afb3f24213782b1c3faf2fb89e5207372b41c4bf01c811f81e3e` | 3,441 |

패키지 tarball SHA-256:

- 채널톡: `c3b3b2ba7917b78fd23fc6771f1be2b024846cce3f2f019dfe30964ef7241b85`
- 인터컴 Messenger: `8cf985ce381edc4455fd3d229629d1b8e7675c95218cccb0048a07f68da970c1`
- 인터컴 REST: `d581c191f657993dc231259ad9231186a9e3318ee266b7c09c3f2b5e509211bd`
- 허브스팟 REST: `fbab080fb612a0ab5968827281d8e4bb6b2ed596272e7d02ce30454f43b4b2db`

선택 입력 디렉터리 해시는 순서대로 `5352cbf96a326a2f7a0ea4595a6e997fc1124c233a8cf6287b8d2907631cc2a2`, `3d59e9629810eba074378a939c8a85bfbe62e7e9e34a1f03b75ee199ddba59b6`, `5e5c3cb9559ea5fb3d63abc5ec09410298bdc4d6f479042b8a0b9ca99b1cbe08`, `8137c7dc403c87db33e1e8769408c0cc1fe254217a76b5e4065c470610028beb`다. REA의 컨테이너 분석 완료는 이 선택 범위의 완료이며 제품 전체 의미 분석의 완료가 아니다.

## 관찰 → 샌드비 적용

| 근거 | 확인한 사실 | 샌드비의 독립 구현 / 남은 작업 |
|---|---|---|
| 채널톡 loader의 `boot`, `shutdown`, `track`, 콜백 전달 | 웹 SDK가 원격 런타임의 명령 호출을 감싼다. loader만으로 실제 상담 저장 방식을 알 수 없다. | 명시적 SDK 수명주기·이벤트·연결 완료/오류 콜백. 실제 메시지는 샌드비 DB/API에 저장 |
| 인터컴 Messenger의 공개 메서드, instance-manager | 초기화와 표시/숨김, 사용자 갱신, 이벤트, 미확인 개수 알림이 분리되어 있다. | `boot/show/hide/shutdown/identify/trackEvent/on` 제공. 로그아웃 시 이전 인증 제거, 짧은 회원 인증 자동 갱신 |
| 인터컴 REST Client의 경로·HTTP 메서드 | 고객·회사·대화를 별도 리소스로 다루고 검색·답변 API가 있다. 서버 내부 트랜잭션은 미확인이다. | 고객·회사·관계·행동 이벤트 모델, 서비스 API 토큰, 서버 전체 대화 검색·페이지 커서 |
| 허브스팟 Basic/Pipelines/Subscriptions API의 요청 생성 | CRM 객체, 객체 유형별 파이프라인, 웹훅 구독 계약이 분리되어 있다. | 같은 고객 ID를 딜·태스크·단계 이력과 연결하는 기본 API/UI 구현. 이벤트 outbox·웹훅 전달은 후속 |

회원 식별은 서버가 확인한 사이트 로그인에서 발급한다. 브라우저가 보내는 이름·이메일만으로 기존 회원의 대화를 선택하지 않는다. 이 판단은 인터컴의 [회원 인증 문서](https://developers.intercom.com/installing-intercom/web/identity-verification)와 [로그아웃 수명주기 문서](https://developers.intercom.com/installing-intercom/web/methods)도 참고했다. 샌드비 SDK는 원본 SDK와 동일한 호환 구현을 표방하지 않는다.

REST 계약 참고: [인터컴 공식 Node SDK](https://github.com/intercom/intercom-node), [허브스팟 공식 Node SDK](https://github.com/HubSpot/hubspot-api-nodejs), [허브스팟 파이프라인](https://developers.hubspot.com/docs/api-reference/legacy/crm/pipelines/guide), [허브스팟 웹훅](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/features/configure-webhooks), [채널톡 개발 문서](https://developers.channel.io/en/articles/20516f31).

### 채널톡 자료 추출의 최신 공개 계약

2026-10-15 [현재 Open API 소개](https://docs.channel.io/developers/en/articles/What-is-Open-API-c8c76fba)에서 연결되는 [공식 API 문서](https://api-doc.channel.works/)와 [공개 OpenAPI YAML](https://api-doc.channel.works/docs/openapi.en.yaml)을 저장해 대조했다. YAML은408,324바이트, SHA-256 `dc1a99f9319f7b4b65c775f1ae80e02d108e7ab72a57ac7e83694d4fba99eb92`다. 공개 문서 파일만 조회했으며 실제 `api.channel.io` 계정·키·고객 API를 호출하지 않았다. 이 계약 검토는 기존 배포 SDK의 REA 증거와 구분한다.

- 현재 계약은 `/open` 경로와 `Channel-Version: 2026-06-01`, `cursor`·`nextCursor`·`hasNext`를 사용한다. 기존 `/open/v5`의 `since`·`next`와 섞지 않는다.
- 상담 목록의 `deskUpdatedAt`은 기간 생략을 허용하지만 상태를 생략하면 열린 상담만 반환한다. 따라서 `opened`·`closed`·`snoozed`·`queued`·`initial`·`missed`를 각각 조회해야 한다. `managedAt`의 기간·2026년 시작 제한을 전체 과거 자료 수집의 근거로 삼지 않는다.
- 상담 목록에 함께 담기는 메시지는 최신 메시지다. 상담마다 메시지 페이지가 끝났는지 별도로 기록해야 한다. 고객·상담원·봇·메모·파일·스레드 등 원본 필드를 유지하며, 텍스트 화면에서 원본 블록 레이아웃을 재현했다고 주장하지 않는다.
- 전체 고객을 열거하는 `GET /open/users`는 이 스키마에 없다. 상담에 참조된 고객의 상세 조회가 끝나도 상담 없는 고객까지 확보한 것은 아니다.
- 익명 방문자의 `memberId`가 `veilId`와 같을 수 있다. 이름·이메일 또는 `memberId` 존재만으로 회원을 판별하지 않는다. CRM 연결 후보와 사이트 본인 인증·과거 이력 공개 정책은 별개다.
- 첨부의 `key`로 파일 주소를 조회하는 응답은 `{result: string}`이다. 파일 메타데이터, 서명 주소 발급, 실제 바이트 백업·크기/해시 검증을 구분한다. 최신 스키마에 없는 주소 유효기간을 이전 v5 설명에서 추정해 확정하지 않는다.

페이지 종료는 해당 엔드포인트의 순회 완료다. 수집 중 자료가 바뀌지 않는 스냅샷, 삭제·보관 만료 복구, API 권한으로 제외된 상담·내부 스레드의 완전성까지 증명하지 않는다. 실제 계정 원본 대조와 전환 인수는 여전히 별도 검수다.

## GitHub 공개 구현체

전체 소스가 공개된 저장소는 일반 소스 분석으로 확인했다. 이를 REA로 SaaS의 비공개 코드를 분석한 것처럼 표현하지 않는다. 소스 파일별 URL·SHA-256은 `evidence-manifest.json`에 기록한다.

### Chatwoot

[고정 커밋 ab0c81a](https://github.com/chatwoot/chatwoot/tree/ab0c81af87ae1176abd452538a551b854bcadba1)에서 contact / contact_inbox / conversation / message 모델, 자동화 rule·listener·조건·행동 서비스를 확인했다.

자동화 listener는 계정과 이벤트별 활성 규칙을 선택하고 조건을 검사한다. 자동화가 만든 이벤트를 다시 실행하는 루프를 거르는 장치가 있다. 지연 규칙은 즉시 동작으로 바꾸지 않고 예약 실행 대상으로 기록한다. 행동 서비스는 고객 메시지와 비공개 메모를 구분한다. 따라서 샌드비도 이벤트의 원인, 게시 버전, 실행 ID, 예약 시점과 취소·재시도 기록을 분리해야 한다. 이 부분은 현재 공통 자동화 구현의 후속 요구사항이다.

[라이선스](https://github.com/chatwoot/chatwoot/blob/ab0c81af87ae1176abd452538a551b854bcadba1/LICENSE)는 enterprise 등 예외를 구분한다. 현재 샌드비 코드에 원본 구현을 복사하지 않았다.

### Twenty

[고정 커밋 41507af](https://github.com/twentyhq/twenty/tree/41507af138a38448e8e95388d5be0b25486a154b)에서 company / person / opportunity / task 객체와 workflow runner를 확인했다.

영업 기회는 회사·연락 담당자·소유자·금액·단계·태스크/타임라인 관계를 가진다. workflow runner는 버전 정의를 확인하고 실행 레코드를 만든 다음 큐에 넣으며, 수동/자동 트리거와 실행 제한을 구분한다. 샌드비에서는 기존 자유형 CRM 레코드를 유지하면서 명시적인 딜·태스크·다음 행동 모델로 확장한다. 사람이 적용·게시하는 정책은 기존 사용자의 요청을 따른다.

[라이선스](https://github.com/twentyhq/twenty/blob/41507af138a38448e8e95388d5be0b25486a154b/LICENSE)는 AGPL과 패키지별 예외를 포함한다. 구조 참고만 했고 해당 소스 구현은 복사하지 않았다.

## 미확인과 다음 검증

- 인터컴·허브스팟의 실제 계정 UX, 유료 기능 및 서버 실행 방식은 관찰하지 못했다.
- 현재 사용 중인 모든 상담 채널, 기존 데이터의 내보내기 형태·첨부·관계 보존, 실제 사이트 로그인 연동은 아직 전환 검수가 필요하다.
- API/SDK와 웹 텍스트 상담 QA의 통과는 AI 상담·옴니채널·자동화·이전·SLA까지 완성했다는 의미가 아니다. 전체 완료 여부는 `REPLACEMENT.md`의 R01~R16으로 판단한다.
