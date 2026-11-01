"""Petit utilitaire d'administration (cle service, lue dans .env, jamais affichee)."""
import json, os, sys, urllib.request

ENV = {}
for line in open(os.path.join(os.path.dirname(__file__), '.env'), encoding='utf8'):
    if '=' in line and not line.strip().startswith('#'):
        k, v = line.strip().split('=', 1)
        ENV[k] = v.strip().strip('"')
URL = ENV['SUPABASE_URL'].rstrip('/')
KEY = ENV['SUPABASE_SERVICE_ROLE_KEY']
H = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}


def req(method, path, body=None, headers=None, raw=None):
    h = dict(H, **(headers or {}))
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    if body is not None and raw is None:
        h.setdefault('Content-Type', 'application/json')
    r = urllib.request.Request(URL + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as resp:
            txt = resp.read().decode()
            return json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{method} {path} -> {e.code} {e.read().decode()[:400]}')
