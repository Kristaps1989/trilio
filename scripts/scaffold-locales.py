#!/usr/bin/env python3
"""Creates/refreshes lt.json and et.json from lv.json for translation.

Every key is copied with the Latvian text and the file carries
"__status": "pending_translation". The app serves Latvian for any key a
locale file lacks, so a partially translated file is safe to ship. Run
after adding keys to lv.json; existing translations are preserved.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "src" / "i18n" / "messages"
lv = json.loads((ROOT / "lv.json").read_text(encoding="utf-8"))


def merge(src, existing):
    if isinstance(src, dict):
        out = {}
        for k, v in src.items():
            out[k] = merge(v, existing.get(k) if isinstance(existing, dict) else None)
        return out
    return existing if isinstance(existing, str) else src


for locale in ("lt", "et"):
    path = ROOT / f"{locale}.json"
    existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    merged = merge(lv, existing)
    merged = {"__status": "pending_translation", **{k: v for k, v in merged.items() if k != "__status"}}
    path.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(locale, "written")
