"""Audit/import idempotent des liens de la conversation Gemini de Vesna."""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import analyzer as A

URL_RE = re.compile(r"https?://[^\s<>\"']+", re.I)
DROP_QUERY = {
    "stkn", "mdxt", "psln", "cplk", "vrfl", "g_st", "fbclid", "obrf",
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "visitor-id", "locale_autoredirect_optout", "dd_referrer",
}
ASSISTANT_NOTE_MARKERS = (
    "alles ist sicher", "was packen wir", "was möchtest du", "was möchten wir",
    "welchen link", "welchen spot", "welcher spot", "hast du den nächsten",
    "schick mir", "schick einfach", "sobald du", "sag bescheid",
    "möchtest du dazu", "möchtest du noch", "nehmen wir als nächstes",
    "fügen wir als nächstes", "packen wir als nächstes", "ich halte alle infos",
    "das gibt eurer", "die ausrüstung nimmt", "passt geografisch perfekt",
    "bietet sich dafür perfekt", "datenbank hinzufügen", "master-liste gespeichert",
)


def clean_url(raw: str) -> str:
    return raw.rstrip(".,;:!?)]}»")


def key_of(url: str) -> str:
    """Cle stable : retire le pistage mais garde les parametres utiles."""
    part = urlsplit(url)
    host = part.netloc.lower().removeprefix("www.")
    path = part.path.rstrip("/")
    if host == "instagram.com":
        match = re.match(r"/(reel|p)/([^/]+)", path, re.I)
        if match:
            return f"instagram.com/{match.group(1).lower()}/{match.group(2)}"
        return f"instagram.com/{path.strip('/').lower()}"
    query = [(k, v) for k, v in parse_qsl(part.query) if k.lower() not in DROP_QUERY]
    if host in {"maps.app.goo.gl", "goo.gl"}:
        query = []
    return urlunsplit(("https", host, path, urlencode(query), "")).lower()


def nearby_note(lines: list[str], index: int) -> str | None:
    bits: list[str] = []
    for raw in reversed(lines[max(0, index - 5):index]):
        line = raw.strip()
        if not line or URL_RE.search(line):
            if bits:
                break
            continue
        if line.lower() in {"du:", "ich:", "gemini", "du", "ich", "you", "me"}:
            continue
        if len(line) > 240:
            continue
        bits.append(line)
        if len(bits) == 2:
            break
    note = " — ".join(reversed(bits)).strip()
    if any(marker in note.lower() for marker in ASSISTANT_NOTE_MARKERS):
        return None
    return note[:480] or None


def platform(url: str) -> str:
    low = url.lower()
    if "instagram.com" in low:
        return "instagram"
    if "tiktok.com" in low:
        return "tiktok"
    if "youtube.com" in low or "youtu.be" in low:
        return "youtube"
    if "maps.app.goo.gl" in low or "goo.gl/maps" in low or ("google." in low and "/maps" in low):
        return "maps"
    return "web"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("file", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    lines = args.file.read_text(encoding="utf-8", errors="replace").splitlines()
    found: dict[str, tuple[str, str | None]] = {}
    for index, line in enumerate(lines):
        for match in URL_RE.finditer(line):
            url = clean_url(match.group(0))
            if "share.gemini.google" in url or "policies.google" in url:
                continue
            found.setdefault(key_of(url), (url, nearby_note(lines, index)))

    existing_rows = A.sb("GET", "link_ideas", params={"select": "url", "limit": "5000"}) or []
    places = A.sb("GET", "places", params={"select": "notes", "limit": "5000"}) or []
    existing = {key_of(row["url"]) for row in existing_rows if row.get("url")}
    for place in places:
        for match in URL_RE.finditer(place.get("notes") or ""):
            existing.add(key_of(clean_url(match.group(0))))

    missing = [(url, note) for key, (url, note) in found.items() if key not in existing]
    profiles = A.sb("GET", "profiles", params={"select": "id,display_name"}) or []
    vesna = next((p for p in profiles if (p.get("display_name") or "").lower().startswith("ves")), None)
    trips = A.sb("GET", "trips", params={"select": "id,title,start_date,end_date", "order": "start_date.desc"}) or []
    trip = next((t for t in trips if "vietnam" in (t.get("title") or "").lower()), trips[0] if trips else None)
    if not vesna or not trip:
        raise SystemExit("Profil de Vesna ou voyage Asie introuvable.")

    print(f"{len(found)} liens uniques dans le fichier ; {len(existing)} deja connus ; {len(missing)} manquants.")
    for url, note in missing:
        print(f"- {note or '(sans note)'}\n  {url}")

    if args.apply and missing:
        rows = [
            {
                "user_id": vesna["id"],
                "trip_id": trip["id"],
                "url": url,
                "platform": platform(url),
                "note": note,
                "status": "pending",
            }
            for url, note in missing
        ]
        A.sb("POST", "link_ideas", body=rows, prefer="return=minimal")
        print(f"Ajoute : {len(rows)} liens, attribues a {vesna['display_name']} / {trip['title']}.")


if __name__ == "__main__":
    main()
