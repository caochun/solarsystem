"""Readable manifests with compact numeric vectors; no loss of precision."""
import json, re

def dumps(value):
    number = r'-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?'
    return re.sub(r'\[\s*'+number+r'(?:\s*,\s*'+number+r')*\s*\]',
        lambda match: json.dumps(json.loads(match[0]),separators=(',',':')),
        json.dumps(value,ensure_ascii=False,indent=2))+'\n'
