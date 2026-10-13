import json, subprocess, urllib.request, sys
S=sys.argv[1]; TOK=open(S+"/token.txt").read().strip(); ORG="d3adb8d3-db1d-4fab-aac0-61c7f8644f13"
B="http://localhost:3100"; R="startDate=2025-01-01&endDate=2026-12-31"
def get(p):
    req=urllib.request.Request(B+p, headers={"Cookie":"token="+TOK})
    return json.load(urllib.request.urlopen(req, timeout=180))
def q(s): return subprocess.check_output(["psql","postgresql://jaehun@localhost:5432/salesflow","-Atc",s]).decode().strip()
out=[]
def chk(name, ok, detail): out.append(("PASS " if ok else "FAIL ")+name+" "+json.dumps(detail, ensure_ascii=False)[:300])
human=int(q(f"select count(distinct c.send_log_id) from email_click_logs c join email_send_logs s on s.id=c.send_log_id where s.org_id='{ORG}' and c.is_bot=false"))
allc=int(q(f"select count(distinct c.send_log_id) from email_click_logs c join email_send_logs s on s.id=c.send_log_id where s.org_id='{ORG}'"))
out.append(f"INFO 클릭한 발송: 전체 {allc} → 사람 {human}")
s=get("/api/analytics/summary?"+R); d=s["data"]
em=d.get("email") or d
clicked=em.get("clicked") if isinstance(em,dict) else None
chk("B16 summary clicked = 사람 클릭 발송 수", clicked==human, {"api":clicked,"sql":human,"keys":list(d.keys())[:8]})
t=get("/api/analytics/trends?channel=email&"+R); rows=t["data"]
tc=sum(r.get("clicked",0) for r in rows)
chk("B18 trends clicked 합 = 사람", tc==human, {"api":tc,"sql":human})
e=get("/api/analytics/email-daily?"+R); rows=e["data"]
ec=sum(r.get("clicked",0) for r in rows)
chk("B18 email-daily clicked 합 = 사람", ec==human, {"api":ec,"sql":human})
tp=get("/api/analytics/templates?channel=email&limit=1000&"+R); rows=tp["data"] if isinstance(tp["data"],list) else tp["data"].get("email",[])
out.append("INFO templates 샘플 "+json.dumps(rows[:2],ensure_ascii=False)[:300])
l1=get("/api/email/logs?isClicked=1&pageSize=5&"+R); l0=get("/api/email/logs?isClicked=0&pageSize=5&"+R)
exp0=int(q(f"select count(*) from email_send_logs s where s.org_id='{ORG}' and s.status='sent' and not exists(select 1 from email_click_logs c where c.send_log_id=s.id and c.is_bot=false)"))
chk("B19 isClicked=1 총건수 = 사람", l1.get("totalCount")==human, {"api":l1.get("totalCount"),"sql":human})
chk("B19 isClicked=0 총건수 = 사람 클릭 없는 sent", l0.get("totalCount")==exp0, {"api":l0.get("totalCount"),"sql":exp0})
row=l1["data"][0]; sid=row["id"]
ec=q(f"select count(*) filter (where is_bot=false)||','||count(*) filter (where is_bot) from email_click_logs where send_log_id={sid}")
chk("B20 email/logs 줄 clickCount·botClickCount", f'{row.get("clickCount")},{row.get("botClickCount")}'==ec and "hasSiteAction" in row, {"api":[row.get("clickCount"),row.get("botClickCount"),row.get("hasSiteAction")],"sql":ec})
botonly=q(f"select s.id from email_send_logs s where s.org_id='{ORG}' and exists(select 1 from email_click_logs c where c.send_log_id=s.id) and not exists(select 1 from email_click_logs c where c.send_log_id=s.id and c.is_bot=false) limit 1")
u=get("/api/logs/unified?channel=email&pageSize=50&page=1")
ids=[r["id"] for r in u["data"]]
exp_ids=q(f"select string_agg(id::text, ',' order by sent_at desc) from (select id, sent_at from email_send_logs where org_id='{ORG}' order by sent_at desc limit 50) x").split(",")
chk("B20 unified 정렬·페이지 동일", [str(i) for i in ids]==exp_ids, {"first":ids[:3]})
tot=int(q(f"select count(*) from email_send_logs where org_id='{ORG}'"))
chk("B20 unified total", u.get("total")==tot, {"api":u.get("total"),"sql":tot})
bad=[]
for r in u["data"]:
    ex=q(f"select count(*) filter (where is_bot=false)||','||count(*) filter (where is_bot) from email_click_logs where send_log_id={r['id']}")
    if f'{r.get("clickCount")},{r.get("botClickCount")}'!=ex: bad.append((r["id"],r.get("clickCount"),r.get("botClickCount"),ex))
chk("B20 unified 50줄 클릭 수 일치", not bad, bad[:3])
out.append(f"INFO 봇만 있는 발송 예: {botonly}")
print("\n".join(out))
