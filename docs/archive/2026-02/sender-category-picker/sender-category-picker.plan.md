# Plan: sender-category-picker — 발신프로필 카테고리 드롭다운 선택

## 1. 개요

### 배경
현재 발신프로필 등록 시 카테고리 코드를 직접 텍스트로 입력해야 하며, 사용자가 NHN Cloud 콘솔에서 코드를 확인해야 하는 불편함이 있다.

### 기존 인프라
- **NHN Client**: `getSenderCategories()` — `GET /alimtalk/v2.0/appkeys/{appkey}/sender/categories`
- **API 엔드포인트**: `GET /api/alimtalk/sender-categories` — 이미 구현 완료
- **응답 구조**: 3단계 계층 — `{ parentCode, depth, code, name, subCategories[] }`
- **카테고리 코드**: 11자리 (예: `00100010001` — 건강 > 병원 > 종합병원)
- **SenderProfileRegisterDialog**: 현재 `<Input>` 으로 categoryCode 직접 입력

### 목표
1. 카테고리 코드 입력을 **드롭다운 2단계 선택**으로 변경
2. 메인 카테고리 선택 → 해당 서브 카테고리 필터링 → 선택
3. 선택된 서브 카테고리의 `code` 값이 `categoryCode`로 설정

### 범위
- `SenderProfileRegisterDialog.tsx` 수정 — Input → Select 2단계
- SWR 훅 추가 — 카테고리 목록 fetch + 캐시
- 기존 API 엔드포인트 그대로 활용 (변경 없음)

### 범위 제외
- NHN Cloud API 변경 없음
- 카테고리 목록 DB 저장 (실시간 NHN API 호출로 충분)
- 3단계(depth 3) 선택 UI — NHN 카테고리 응답에 depth 3가 있을 수 있으나 depth 2까지만 UI 노출 (depth 3은 code로 자동 설정)

## 2. 기능 요구사항

### FR-01: 카테고리 데이터 fetch 훅
- `useAlimtalkCategories()` SWR 훅
- `GET /api/alimtalk/sender-categories` 호출
- 응답을 `NhnSenderCategory[]` 형태로 캐시
- 다이얼로그 열릴 때만 fetch (조건부 SWR key)

### FR-02: 메인 카테고리 Select
- 기존 `<Input>` 제거, `<Select>` (ShadCN)로 교체
- depth 1 카테고리 목록을 드롭다운으로 표시
- 선택 시 서브 카테고리 목록 필터링

### FR-03: 서브 카테고리 Select
- 메인 카테고리 선택 후 활성화되는 두 번째 `<Select>`
- 선택된 메인의 `subCategories[]`를 드롭다운으로 표시
- 선택 시 해당 카테고리의 `code` 값이 `categoryCode`로 설정

### FR-04: 로딩/에러 상태 처리
- 카테고리 로딩 중: Select 비활성화 + "로딩 중..." placeholder
- 카테고리 로딩 실패: 에러 메시지 + 기존 텍스트 Input fallback

## 3. 기술 설계 방향

### 카테고리 응답 구조
```typescript
interface NhnSenderCategory {
    parentCode: string;
    depth: number;
    code: string;
    name: string;
    subCategories: NhnSenderCategory[];
}
```

### UI 흐름
```
[메인 카테고리 Select] → 선택 → [서브 카테고리 Select 활성화] → 선택 → categoryCode 자동 설정
```

### 상태 관리
- `mainCategoryCode`: 메인 카테고리 선택값
- `categoryCode`: 최종 선택된 서브 카테고리의 code (기존 state 재활용)
- 메인 변경 시 서브 초기화

## 4. 변경 파일 목록

| # | 파일 | 변경 유형 | 설명 |
|---|------|-----------|------|
| 1 | `src/hooks/useAlimtalkCategories.ts` | 신규 | 카테고리 SWR 훅 |
| 2 | `src/components/alimtalk/SenderProfileRegisterDialog.tsx` | 수정 | Input → 2단계 Select |

## 5. 의존성
- 신규 패키지 없음 (ShadCN Select 이미 존재)
- DB 스키마 변경 없음
- API 엔드포인트 변경 없음 (`sender-categories.ts` 그대로 활용)

## 6. 검증 기준
- 메인 카테고리 드롭다운에 NHN Cloud 카테고리 목록 표시
- 메인 선택 후 서브 카테고리 드롭다운 활성화 + 필터된 목록 표시
- 서브 선택 시 categoryCode 자동 설정
- 메인 변경 시 서브 초기화
- 등록 요청 시 올바른 categoryCode 전송
- 카테고리 로딩 중 적절한 UI 상태
