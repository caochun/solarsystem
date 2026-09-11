"""Build a deduplicated, searchable SQLite index from the complete archived CSVs."""
import csv
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import time

WEB = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("catalog_import", Path(__file__).with_name("sync-catalogs.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def build():
    target = WEB / "data/catalog.sqlite"
    target.parent.mkdir(exist_ok=True)
    staging = target.with_suffix(".incoming.sqlite")
    staging.unlink(missing_ok=True)
    db = sqlite3.connect(staging)
    db.executescript("""
      PRAGMA journal_mode=OFF;
      PRAGMA synchronous=OFF;
      CREATE TABLE objects (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
        number TEXT, orbit TEXT, epoch REAL, source_category TEXT NOT NULL);
      CREATE TABLE membership (object_id TEXT NOT NULL, category TEXT NOT NULL,
        PRIMARY KEY(object_id,category)) WITHOUT ROWID;
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """)
    summary = json.loads((WEB / "public/catalogs/summary.json").read_text())
    for category in summary["categories"]:
        with gzip.open(WEB / "public" / category["archive"], "rt", newline="") as stream:
            for raw in csv.DictReader(stream):
                name = raw["full_name"].strip()
                identity = hashlib.sha256(name.encode()).hexdigest()[:24]
                number = name.split()[0] if name.split()[0][0].isdigit() else None
                try:
                    orbit = module.elements(raw)
                except (ValueError, KeyError):
                    orbit = None
                db.execute("""INSERT INTO objects VALUES(?,?,?,?,?,?)
                  ON CONFLICT(id) DO UPDATE SET orbit=excluded.orbit,
                  epoch=excluded.epoch,source_category=excluded.source_category
                  WHERE excluded.epoch > coalesce(objects.epoch,-1)""",
                  (identity,name,number,json.dumps(orbit,separators=(",",":")) if orbit else None,
                   orbit["epoch"] if orbit else None,category["id"]))
                db.execute("INSERT OR IGNORE INTO membership VALUES(?,?)",(identity,category["id"]))
        db.commit()
        print("Indexed",category["id"],category["total"],flush=True)
    db.executescript("""
      CREATE INDEX object_number ON objects(number);
      CREATE INDEX category_objects ON membership(category,object_id);
      CREATE VIRTUAL TABLE names USING fts5(name,content='objects',content_rowid='rowid',tokenize='trigram');
      INSERT INTO names(names) VALUES('rebuild');
    """)
    stats = {"uniqueObjects":db.execute("SELECT count(*) FROM objects").fetchone()[0],
      "categoryRecords":sum(c["total"] for c in summary["categories"]),
      "unsupportedObjects":db.execute("SELECT count(*) FROM objects WHERE orbit IS NULL").fetchone()[0],
      "builtAt":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
      "categories":summary["categories"],
      "deduplication":"Exact full_name; newest supported orbit epoch retained; original category archives unchanged"}
    db.execute("INSERT INTO metadata VALUES('summary',?)",(json.dumps(stats),))
    db.commit()
    assert db.execute("PRAGMA quick_check").fetchone()[0] == "ok"
    db.close()
    staging.replace(target)
    print(json.dumps({k:v for k,v in stats.items() if k!='categories'}),flush=True)
    print("Index MiB",round(target.stat().st_size/1024**2,1),flush=True)

if __name__ == '__main__': build()
