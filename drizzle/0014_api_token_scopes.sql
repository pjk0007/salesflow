CREATE TABLE IF NOT EXISTS "api_token_scopes" (
    "id" serial PRIMARY KEY NOT NULL,
    "token_id" integer NOT NULL REFERENCES "api_tokens"("id") ON DELETE CASCADE,
    "scope_type" varchar(20) NOT NULL,
    "scope_id" integer NOT NULL,
    "permissions" jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS "api_token_scopes_token_idx" ON "api_token_scopes" ("token_id");
