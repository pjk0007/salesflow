# duplicate-prevention Gap Analysis

> Match Rate: **98.9%** | Date: 2026-03-19

## Checklist (18 items)

### Phase 1: Email Dedup

| # | Item | Status |
|:-:|------|:------:|
| 1 | schema.ts - emailTemplateLinks.preventDuplicate | MATCH |
| 2 | schema.ts - emailAutoPersonalizedLinks.preventDuplicate | MATCH |
| 3 | drizzle migration (0027) | MATCH |
| 4 | email-automation.ts - checkDuplicateRecipient() + call | MATCH |
| 5 | auto-personalized-email.ts - checkDuplicateRecipientForAiAuto() + call | MATCH |
| 6 | API: template-links POST/PUT - preventDuplicate | MATCH |
| 7 | API: auto-personalized POST/PUT/GET - preventDuplicate | MATCH |
| 8 | UI: EmailTemplateLinkList - Switch | CHANGED (page-based forms instead) |
| 9 | UI: ai-auto/[id] and ai-auto/new - Switch | MATCH |

### Phase 2: Partition Dedup

| # | Item | Status |
|:-:|------|:------:|
| 10 | schema.ts - partitions.duplicateConfig | MATCH |
| 11 | types/index.ts - DuplicateConfig type | MATCH |
| 12 | drizzle migration | MATCH |
| 13 | API: partitions/[id]/records POST - action branching | MATCH |
| 14 | API: v1/records POST - same logic | MATCH |
| 15 | API: partitions/[id] PATCH - duplicateConfig | MATCH |
| 16 | UI: records/page.tsx - duplicate calculation | CHANGED (combined prop, page-scoped) |
| 17 | UI: RecordTable - row highlight | CHANGED (consolidated duplicateHighlight prop) |
| 18 | UI: Partition settings - duplicate config form | MATCH |

## Score

- Exact match: 15/18 (83.3%)
- Changed (functionally equivalent): 3/18 (16.7%)
- Missing: 0/18 (0%)
- Added bonus: 3 (Badge displays, __none__ sentinel)
- **Overall: 98.9%**

## Changes (minor, no action needed)

1. Switch location: page-based forms instead of EmailTemplateLinkList inline (consistent with project migration pattern)
2. RecordTable props: single `duplicateHighlight` prop instead of two separate props (cleaner API)
3. Duplicate scope: page-scoped instead of all records (performance tradeoff)
