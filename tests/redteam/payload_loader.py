import json
from pathlib import Path

PAYLOADS_DIR = Path(__file__).resolve().parent / 'payloads'


def load_all_payloads() -> list:
    payloads = []
    for path in sorted(PAYLOADS_DIR.glob('*.json')):
        entries = json.loads(path.read_text(encoding='utf-8'))
        for entry in entries:
            entry.setdefault('history', [])
            entry.setdefault('msgs', [])
            payloads.append(entry)
    return payloads
