# Plan: 워크스페이스 아이콘 피커

## 배경

설정 > 워크스페이스 탭에서 아이콘 필드가 텍스트 Input으로 되어 있어 사용자가 아이콘 이름을 직접 타이핑해야 한다. 실질적으로 사용하기 어려운 상태.

### 현재 상태
- DB: `workspaces.icon` (varchar 50) — 저장/조회 완비
- API: POST/PATCH/GET 모두 icon 처리 완비
- **설정 탭(WorkspaceSettingsTab)**: 텍스트 Input — `placeholder="아이콘 이름 (예: briefcase)"`
- **생성 다이얼로그(CreateWorkspaceDialog)**: 텍스트 Input (동일)
- **워크스페이스 목록 카드**: 아이콘 표시 안 됨
- **사이드바**: 워크스페이스 아이콘 미사용 (고정 nav만 있음)

### 요구사항
1. 아이콘 선택을 **그리드형 드롭다운 피커**로 변경
2. Lucide 아이콘 중 비즈니스/조직에 적합한 아이콘 큐레이션
3. 워크스페이스 목록 카드에 선택된 아이콘 표시

## 구현 범위

### 1. IconPicker 공용 컴포넌트 (신규)
**파일**: `src/components/ui/icon-picker.tsx`

- Popover + 그리드 레이아웃 (4~5열)
- 큐레이션된 Lucide 아이콘 20~30개
  - 비즈니스: Briefcase, Building2, Store, Landmark, Factory
  - 사람: Users, UserRound, Contact, HeartHandshake
  - 커뮤니케이션: Phone, Mail, MessageSquare, Megaphone
  - 데이터: BarChart3, PieChart, TrendingUp, Target, ClipboardList
  - 일반: Home, Star, Bookmark, Globe, Rocket, Zap, Shield, Crown, Gem
- 선택된 아이콘 하이라이트
- "없음" 옵션 (아이콘 제거)
- 트리거 버튼: 현재 선택된 아이콘 + 텍스트 표시

### 2. WorkspaceSettingsTab 수정
**파일**: `src/components/settings/WorkspaceSettingsTab.tsx`

- 아이콘 텍스트 Input → IconPicker 교체
- 워크스페이스 목록 카드에 아이콘 렌더링 추가

### 3. CreateWorkspaceDialog 수정
**파일**: `src/components/settings/CreateWorkspaceDialog.tsx`

- 아이콘 텍스트 Input → IconPicker 교체

## 변경 파일 목록

| # | 파일 | 변경 |
|---|------|------|
| 1 | `src/components/ui/icon-picker.tsx` | 신규 — 아이콘 그리드 피커 컴포넌트 |
| 2 | `src/components/settings/WorkspaceSettingsTab.tsx` | Input → IconPicker, 카드에 아이콘 표시 |
| 3 | `src/components/settings/CreateWorkspaceDialog.tsx` | Input → IconPicker |

## 범위 외
- DB 스키마 변경 없음 (varchar 50 유지, Lucide 아이콘 이름 저장)
- API 변경 없음
- 사이드바 아이콘 표시 (별도 기능)

## 검증
- `pnpm build` 성공
- 설정 > 워크스페이스에서 아이콘 피커 드롭다운 동작
- 생성 다이얼로그에서 아이콘 피커 동작
- 워크스페이스 카드에 선택된 아이콘 표시
