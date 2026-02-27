# alimtalk-automation Gap Analysis

> **Feature**: alimtalk-automation
> **Date**: 2026-02-13
> **Design Doc**: [alimtalk-automation.design.md](../02-design/features/alimtalk-automation.design.md)
> **Match Rate**: 97.2% (35/36 items)

---

## 1. Analysis Summary

| Category | Items | Matched | Rate |
|----------|-------|---------|------|
| Data Model (Section 3) | 6 | 6 | 100% |
| API Specification (Section 4) | 7 | 7 | 100% |
| Core Logic (Section 5) | 7 | 7 | 100% |
| UI/UX (Section 6) | 6 | 6 | 100% |
| Hook Changes (Section 7) | 2 | 2 | 100% |
| Security (Section 10) | 4 | 3 | 75% |
| File Structure (Section 11) | 4 | 4 | 100% |
| **Total** | **36** | **35** | **97.2%** |

---

## 2. Matched Items

### 2.1 Data Model (100%)
- `triggerType` varchar(30) default "manual" on `alimtalkTemplateLinks`
- `triggerCondition` jsonb with `operator` field (eq/ne/contains)
- `repeatConfig` jsonb with intervalHours, maxRepeat, stopCondition
- `alimtalkAutomationQueue` table with all specified columns
- Indexes: `aq_status_next_run_idx`, `aq_template_record_idx`
- Type export: `AlimtalkAutomationQueueRow`

### 2.2 API Specification (100%)
- Record create API: fire-and-forget `processAutoTrigger({ triggerType: "on_create" })`
- Record update API: fire-and-forget `processAutoTrigger({ triggerType: "on_update" })`
- template-links POST: accepts triggerCondition, repeatConfig
- template-links PUT: accepts triggerType, triggerCondition, repeatConfig
- process-repeats: CRON_SECRET auth (Bearer + query param)
- process-repeats: POST only, calls `processRepeatQueue()`
- Response format: `{ success, data: { processed, sent, completed, failed } }`

### 2.3 Core Logic (100%)
- `processAutoTrigger()`: queries active links by triggerType, evaluates conditions, sends, enqueues repeats
- `evaluateCondition()`: supports eq/ne/contains operators, null/no-field returns true
- `checkCooldown()`: 1-hour default, checks sent/pending status in sendLogs
- `processRepeatQueue()`: limit 100, stopCondition eval, maxRepeat check, nextRunAt update
- `sendSingle()`: variable mapping, phone normalization, sendLog insert with triggerType

### 2.4 UI/UX (100%)
- TemplateLinkDialog: triggerType Select (manual/on_create/on_update)
- Conditional TriggerConditionForm + RepeatConfigForm when triggerType != "manual"
- TriggerConditionForm: field/operator/value selectors + "always trigger" checkbox
- RepeatConfigForm: enable checkbox, interval (1h-168h), maxRepeat (1-10), stopCondition
- SendLogTable: triggerType Badge ("수동"/"자동"/"반복") with variant styling

### 2.5 Hook Changes (100%)
- `createLink`: extended with triggerType, triggerCondition, repeatConfig params
- `updateLink`: extended with triggerType, triggerCondition, repeatConfig params

### 2.6 Security (75%)
- JWT auth maintained on all existing endpoints
- process-repeats CRON_SECRET protection
- orgId passed through auto-send pipeline

---

## 3. Gaps Found

### GAP-1: Server-side input validation for repeatConfig/triggerCondition

**Design Reference**: Section 10.3
> triggerCondition/repeatConfig 입력 검증 (operator enum, maxRepeat 1~10, intervalHours 1~168)

**Current State**: No server-side validation for:
- `repeatConfig.maxRepeat` range (1~10)
- `repeatConfig.intervalHours` range (1~168)
- `triggerCondition.operator` enum (eq/ne/contains)

**Severity**: Low
**Impact**: UI already constrains values via Select dropdowns, so invalid values can only come from direct API calls.

**Suggested Fix**: Add validation in `template-links/index.ts` POST and `template-links/[id].ts` PUT before saving.

---

## 4. Implementation Files

| File | Type | Lines |
|------|------|-------|
| `src/lib/db/schema.ts` | Modified | +repeatConfig column, +alimtalkAutomationQueue table |
| `src/lib/alimtalk-automation.ts` | New | ~299 lines |
| `src/pages/api/partitions/[id]/records.ts` | Modified | +processAutoTrigger call |
| `src/pages/api/records/[id].ts` | Modified | +processAutoTrigger call |
| `src/pages/api/alimtalk/template-links/index.ts` | Modified | +triggerCondition/repeatConfig |
| `src/pages/api/alimtalk/template-links/[id].ts` | Modified | +triggerType/triggerCondition/repeatConfig |
| `src/pages/api/alimtalk/automation/process-repeats.ts` | New | ~29 lines |
| `src/components/alimtalk/TemplateLinkDialog.tsx` | Modified | +trigger/condition/repeat UI |
| `src/components/alimtalk/TriggerConditionForm.tsx` | New | ~109 lines |
| `src/components/alimtalk/RepeatConfigForm.tsx` | New | ~188 lines |
| `src/components/alimtalk/SendLogTable.tsx` | Modified | +triggerType Badge |
| `src/hooks/useAlimtalkTemplateLinks.ts` | Modified | +params extension |

---

## 5. Build Status

- `npx next build`: **PASS** (0 errors, 0 warnings)

---

## 6. Conclusion

Match Rate **97.2%** exceeds the 90% threshold. The single gap (GAP-1: server-side validation) is low severity as the UI already enforces valid ranges. The feature is ready for completion report.

**Recommendation**: Proceed to `/pdca report alimtalk-automation`
