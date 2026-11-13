-- 대화방 팔로우: 담당자가 아니어도 참여해 답장하고 새 메시지 알림을 받는다
CREATE TABLE IF NOT EXISTS "inbox_conversation_followers" (
    "conversation_id" uuid NOT NULL REFERENCES "inbox_conversations"("id") ON DELETE CASCADE,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY ("conversation_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_conversation_followers_user" ON "inbox_conversation_followers" ("user_id");
--> statement-breakpoint
-- 사업부별 상담 매크로 (#이름으로 불러 쓰는 문구)
CREATE TABLE IF NOT EXISTS "inbox_macros" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "name" varchar(50) NOT NULL,
    "body" text NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbox_macros_workspace_name" ON "inbox_macros" ("workspace_id", "name");
--> statement-breakpoint
-- 디자이너하이어(워크스페이스 8 '디하') 첫 매크로
INSERT INTO "inbox_macros" ("org_id", "workspace_id", "name", "body", "sort_order")
SELECT w."org_id", w."id", m.name, m.body, m.sort
FROM "workspaces" w
CROSS JOIN (VALUES
    ('가입승인', $m$안녕하세요, 디자이너하이어입니다 :) 적절한 매칭 건이 생기면 가입 승인 및 매칭 제안이 이루어집니다. 디자이너님께 문자/카톡/전화로 개별 연락드려 제안드리오니 참고 바랍니다. 매칭 건이 생기기 전에도 승인이 이루어질 수 있습니다만, 디자이너 풀 내부 상황에 따라 승인 시기가 달라질 수 있다는 점 많은 양해 부탁드립니다.$m$, 1),
    ('구독중지_환불', $m$🚫환불 규정은 아래와 같습니다.

한달 구독기간 기준 50% 이상 시 : 환불 불가.
한달 구독기간 기준 50% 미만 업무 진행 시 : 영업일 기준 업무일에 대하여 일할계산하여 환불 처리$m$, 2),
    ('기업_개인정보변경', $m$관리자 권한으로는 보안상 계정정보 변경이 어려워, 직접 변경이 필요합니다.🥹 계정정보 변경 방법을 안내드립니다.

🔑 계정정보 변경 방법 안내
디하 웹사이트 로그인 > 좌측 하단 계정명 클릭 > '계정 관리' 메뉴 클릭 > 기본 정보

*위 경로에서 닉네임, 프로필이미지, 등록 휴대폰 번호 변경이 가능합니다.$m$, 3),
    ('기업_팀원초대', $m$(1) 초대하실 팀원분도, 저희 디하 웹사이트에 회원가입 해주셔야 합니다.

(2) 팀원분께서 가입을 마치시면, 채팅방 우측 상단의 가로줄 3개 아이콘을 눌러주시고, 멤버 리스트에서 [팀원 초대] 를 클릭해 주세요.

(3) 초대하실 팀원분의 가입 이메일을 입력해 주시면 됩니다.$m$, 4),
    ('기업매칭', $m$기업 매칭은 업무 분야, 업무 시간대, 희망 디자인 무드 등 여러 복합적인 기준에 의해 이루어지기 때문에 짧게는 며칠, 길게는 몇 달까지 소요될 수 있습니다. 적절한 매칭 건이 생기면 디자이너님께 문자/카톡/전화로 매칭 제안을 드립니다. 좋은 매칭 건 생기면 빠르게 연락드리겠습니다. 감사합니다.$m$, 5)
) AS m(name, body, sort)
WHERE w."id" = 8 AND w."name" = '디하'
ON CONFLICT ("workspace_id", "name") DO NOTHING;
