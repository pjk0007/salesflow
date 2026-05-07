-- 트래커가 사용하는 records 파티션 연결
ALTER TABLE "tracker_sites"
    ADD COLUMN IF NOT EXISTS "field_type_id" integer REFERENCES "field_types"("id") ON DELETE SET NULL;
ALTER TABLE "tracker_sites"
    ADD COLUMN IF NOT EXISTS "partition_id" integer REFERENCES "partitions"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "tracker_sites_partition_id_idx" ON "tracker_sites" ("partition_id");

-- visitor 식별자로 records 검색 시 빠르게 (mirror upsert 키)
CREATE INDEX IF NOT EXISTS "records_partition_tracker_visitor_id_idx"
    ON "records" ("partition_id", ((data->>'tracker_visitor_id')));
