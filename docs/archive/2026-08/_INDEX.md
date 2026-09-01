# Archive Index - 2026-08

| Feature | Behaviors | Archived | Documents |
|---------|:---------:|----------|-----------|
| form-attribution | 8/8 | 2026-09-01 | [Plan](form-attribution/PLAN.md), [Design](form-attribution/DESIGN.md), [Behaviors](form-attribution/behaviors.json) |
| sender-profile-propagation | **9/16** | 2026-09-01 | [Plan](sender-profile-propagation/PLAN.md), [Design](sender-profile-propagation/DESIGN.md), [Gap](sender-profile-propagation/GAP.md), [Review](sender-profile-propagation/REVIEW.md), [Progress](sender-profile-propagation/PROGRESS.md) |
| claude-ai-provider | 17/17 | 2026-09-01 | [Plan](claude-ai-provider/PLAN.md), [Design](claude-ai-provider/DESIGN.md), [Gap](claude-ai-provider/GAP.md), [Progress](claude-ai-provider/PROGRESS.md) |

## 비고

세 사이클 모두 REPORT.md 없이 아카이빙됐다 — 당시 구현·배포는 마쳤으나 리포트 단계를 밟지 않았다.

- **sender-profile-propagation**: behaviors 9/16으로 **미완**이다. 아카이빙은 정리 목적이며 완료를 뜻하지 않는다. 남은 7건은 GAP.md 참조.
- **claude-ai-provider**: 17/17 통과. 운영 배포 및 ai_usage_logs에서 provider='claude' 확인까지 마쳤다. GAP이 미해결로 인계한 2건(search.ts 폴백의 usage 유실, senderPersona가 사용자 프롬프트 고정문구를 덮어씀)은 후속 대상.
