"""Read-only SQLite worker. JSON lines over stdio; no third-party dependencies."""
import json
from pathlib import Path
import re
import sqlite3
import sys
import time

def connect(filename):
    db = sqlite3.connect(Path(filename).resolve().as_uri()+"?mode=ro",uri=True)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA query_only=ON")
    return db

def record(db, row):
    return {"id":row["id"],"name":row["name"],
      "orbit":json.loads(row["orbit"]) if row["orbit"] else None,
      "sourceCategory":row["source_category"],
      "categories":[r[0] for r in db.execute("SELECT category FROM membership WHERE object_id=? ORDER BY category",(row["id"],))]}

def query(db, request):
    if request.get("kind") == "summary":
        return json.loads(db.execute("SELECT value FROM metadata WHERE key='summary'").fetchone()[0])
    if request.get("kind") == "object":
        identity = request.get("id","")
        if not re.fullmatch(r"[a-f0-9]{24}",identity): raise ValueError("无效天体标识")
        row = db.execute("SELECT * FROM objects WHERE id=?",(identity,)).fetchone()
        return record(db,row) if row else None
    keyword = request.get("q","").strip()
    if not 1 <= len(keyword) <= 100: raise ValueError("请输入 1–100 个字符")
    offset = int(request.get("offset",0))
    if not 0 <= offset <= 10000: raise ValueError("请缩小搜索范围后重试")
    limit = 40
    category = request.get("category","")
    values = []
    clauses = []
    if keyword.isdigit():
        clauses.append("o.number=?")
        values.append(keyword)
        source = "objects o"
    else:
        if len(keyword) < 3: raise ValueError("名称至少输入 3 个字符；编号可直接输入")
        source = "names JOIN objects o ON o.rowid=names.rowid"
        clauses.append("names MATCH ?")
        values.append('"'+keyword.replace('"','""')+'"')
    if category:
        clauses.append("EXISTS(SELECT 1 FROM membership m WHERE m.object_id=o.id AND m.category=?)")
        values.append(category)
    where = " AND ".join(clauses)
    total = db.execute(f"SELECT count(*) FROM {source} WHERE {where}",values).fetchone()[0]
    rows = db.execute(f"SELECT o.* FROM {source} WHERE {where} ORDER BY length(o.name),o.name LIMIT ? OFFSET ?",[*values,limit,offset]).fetchall()
    return {"total":total,"offset":offset,"limit":limit,"rows":[record(db,row) for row in rows]}

def main():
    db = connect(sys.argv[1])
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            deadline = time.monotonic()+8
            db.set_progress_handler(lambda: int(time.monotonic()>deadline),10000)
            result = {"requestId":request["requestId"],"result":query(db,request)}
        except Exception as error:
            result = {"requestId":request.get("requestId"),"error":str(error),"status":400 if isinstance(error,ValueError) else 503}
        print(json.dumps(result,ensure_ascii=False),flush=True)

if __name__ == '__main__': main()
