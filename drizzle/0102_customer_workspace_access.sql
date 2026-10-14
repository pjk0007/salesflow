CREATE TABLE customer_workspace_access (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES organizations(id),
    workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role varchar(20) NOT NULL CHECK (role IN ('none','viewer','agent','manager')),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_by uuid REFERENCES users(id),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
);
CREATE INDEX customer_access_user ON customer_workspace_access(org_id, user_id);
CREATE TABLE customer_access_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES organizations(id),
    workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id),
    actor_id uuid REFERENCES users(id),
    actor_name varchar(100) NOT NULL,
    before_role varchar(20) NOT NULL CHECK (before_role IN ('none','viewer','agent','manager')),
    after_role varchar(20) NOT NULL CHECK (after_role IN ('none','viewer','agent','manager')),
    version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_access_audit_recent ON customer_access_audit(org_id, workspace_id, created_at, id);
