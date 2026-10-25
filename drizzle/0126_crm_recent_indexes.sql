-- CRM 고객·회사·딜 목록을 최근 순(created_at DESC, id DESC)으로 바꾼 UX-087의 정렬 색인.
-- 데이터 변경 없음. 마이그레이션은 트랜잭션 안에서 실행되므로 CONCURRENTLY를 쓰지 않는다 —
-- 생성하는 동안 해당 표 쓰기가 잠깐 막히므로 큰 표는 사용이 적은 시간에 적용한다. 되돌리기: DROP INDEX IF EXISTS crm_*_recent;
CREATE INDEX IF NOT EXISTS crm_contact_recent ON crm_contacts (org_id, workspace_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS crm_company_recent ON crm_companies (org_id, workspace_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS crm_deal_recent ON crm_deals (org_id, workspace_id, created_at DESC, id DESC);
