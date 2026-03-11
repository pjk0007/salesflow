# Plan: alimtalk-template-sync (알림톡 템플릿 NHN API 완전 동기화)

## 1. 개요

### 배경
현재 알림톡 템플릿 생성/수정 페이지가 NHN Cloud 실제 API와 차이가 있음.
NHN API가 지원하는 필드 중 UI에서 누락된 것들을 추가하여 실제 NHN 콘솔과 동일한 기능을 제공한다.

### 목표
NHN Cloud 알림톡 템플릿 등록/수정 API의 모든 필드를 UI에서 설정할 수 있도록 한다.

## 2. 현재 상태 vs NHN API 비교

### 지원 중 (13개 필드)
| 필드 | 설명 |
|------|------|
| templateCode | 템플릿 코드 (max 20자) |
| templateName | 템플릿 이름 (max 150자) |
| templateContent | 본문 (max 1300자) |
| templateMessageType | 메시지 유형 (BA/EX/AD/MI) |
| templateEmphasizeType | 강조 유형 (NONE/TEXT/IMAGE/ITEM_LIST) |
| templateTitle | 강조 제목 (max 50자, TEXT 선택 시) |
| templateSubtitle | 강조 부제목 (max 50자, TEXT 선택 시) |
| templateHeader | 헤더 (max 16자) |
| templateExtra | 부가정보 (EX/MI 선택 시) |
| securityFlag | 보안 템플릿 |
| categoryCode | 카테고리 |
| buttons | 버튼 (최대 5개) |
| quickReplies | 바로연결 (최대 5개) |

### 미지원 (누락된 4개 기능)
| 필드 | 설명 | 비고 |
|------|------|------|
| templateItem | 아이템 리스트 | list(2~10개) + summary, ITEM_LIST 강조 시 |
| templateItemHighlight | 아이템 하이라이트 | title/description/imageUrl |
| templateRepresentLink | 대표 링크 | linkMo/linkPc/schemeIos/schemeAndroid |
| templateImageName/Url | 이미지 강조 | IMAGE 강조 시 필수 |

### 버튼 타입 부분 지원 이슈
현재 UI에서 버튼 편집기가 일부 타입의 필수 필드를 노출하지 않을 수 있음:
- `telNumber` (TN: 전화걸기)
- `pluginId` (P1/P2/P3: 플러그인)
- `bizFormId` (BF: 비즈니스 폼)

## 3. 구현 범위

### 우선순위 HIGH — 실사용 빈도 높음
1. **아이템 리스트** (`templateItem`) — ITEM_LIST 강조 선택 시 표시
2. **아이템 하이라이트** (`templateItemHighlight`) — ITEM_LIST 강조 선택 시 표시
3. **대표 링크** (`templateRepresentLink`) — 모든 템플릿에서 설정 가능
4. **이미지 강조** (`templateImageName/Url`) — IMAGE 강조 선택 시 표시

### 우선순위 LOW — 특수 용도
5. 버튼 타입별 추가 필드 (telNumber, pluginId, bizFormId)

## 4. 변경 파일

| 파일 | 변경 |
|------|------|
| `src/components/alimtalk/TemplateFormEditor.tsx` | 누락 필드 추가 (아이템리스트, 하이라이트, 대표링크, 이미지) |
| `src/app/alimtalk/templates/new/page.tsx` | 새 필드 state + payload 전달 |
| `src/app/alimtalk/templates/[templateCode]/page.tsx` | 새 필드 로드 + 수정 전달 |
| `src/app/api/alimtalk/templates/route.ts` | 새 필드 API 전달 |
| `src/app/api/alimtalk/templates/[templateCode]/route.ts` | 새 필드 API 전달 |
| `src/lib/nhn-alimtalk.ts` | 인터페이스 확인 (이미 정의됨) |

## 5. 검증
- `npx next build` 성공
- 템플릿 생성 시 새 필드가 NHN API에 정상 전달
- ITEM_LIST 강조 선택 시 아이템 리스트 편집 UI 표시
- IMAGE 강조 선택 시 이미지 URL 입력 필드 표시
- 기존 템플릿 수정 시 새 필드 정상 로드
