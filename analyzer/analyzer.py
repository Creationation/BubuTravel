"""
Analyseur BuBuTravel.

Tourne sur le PC de la maison (plus tard sur un VPS) et traite les liens
colles dans l'app (table link_ideas, status = pending) :

  1. telecharge la video en 480p maximum (TikTok, Instagram, YouTube...),
  2. extrait une quinzaine d'images reparties sur toute la video,
  3. transcrit la voix avec Groq Whisper, recupere les sous-titres s'il y en a,
  4. demande a Claude (Claude Code, abonnement Claude, pas de cle API) de regarder les images, lire la legende et la
     transcription, puis de chercher sur le web (prix, horaires, reservation),
  5. ecrit une fiche structuree dans link_ideas.analysis (status = ready),
     avec l'etape du voyage ou l'activite s'integre et des dates possibles.

Lancement : start.bat (ou `python analyzer.py`).
Test sans base : `python analyzer.py --test <url>`.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

import requests
from dotenv import load_dotenv
from pydantic import BaseModel, Field

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")

try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:
    pass

VERSION = "2.1"
# Modele utilise par Claude Code (alias : opus, sonnet...). Compte sur l'abonnement Claude.
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "sonnet")
# Secours via Codex CLI connecte au compte ChatGPT (jamais via une cle API).
# Luna en effort faible suffit pour les fiches structurees et economise le quota.
CODEX_MODEL = os.environ.get("CODEX_MODEL", "gpt-6-luna")
CLAUDE_RETRY_SECONDS = max(60, int(os.environ.get("CLAUDE_RETRY_MINUTES", "15")) * 60)
CLAUDE_PAUSED_UNTIL = 0.0
CLAUDE_STATE_LOCK = threading.Lock()
CLAUDE_CALL_LOCK = threading.Lock()
CODEX_CALL_LOCK = threading.Lock()
SB_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SB_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
GROQ_KEY = os.environ.get("GROQ_API_KEY", "")
NAME = os.environ.get("ANALYZER_NAME") or socket.gethostname()
COOKIES_BROWSER = os.environ.get("YTDLP_COOKIES_BROWSER", "").strip()
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0 Safari/537.36"
)
MAX_FRAMES = 16
POLL_SECONDS = 8
STUCK_MINUTES = 20
DAY_PLAN_GAP = 15


def log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


# --------------------------------------------------------------------------
# Supabase (REST, cle service : l'analyseur traite les liens des deux comptes)
# --------------------------------------------------------------------------

def sb(method: str, path: str, *, params=None, body=None, prefer: str | None = None):
    headers = {
        "apikey": SB_KEY,
        "Authorization": f"Bearer {SB_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    res = requests.request(
        method, f"{SB_URL}/rest/v1/{path}", params=params, json=body, headers=headers, timeout=30
    )
    if res.status_code >= 400:
        raise RuntimeError(f"Supabase {method} {path} -> {res.status_code} {res.text[:300]}")
    return res.json() if res.text else None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def heartbeat() -> None:
    # Le champ version est deja lu par l'app et accepte une valeur libre. On y
    # expose l'etat du quota sans ajouter de migration Supabase.
    with CLAUDE_STATE_LOCK:
        paused_until = int(CLAUDE_PAUSED_UNTIL)
    sb(
        "POST",
        "analyzer_status",
        params={"on_conflict": "id"},
        body={"id": NAME, "last_seen": now_iso(), "version": f"{VERSION};claude_paused_until={paused_until}"},
        prefer="resolution=merge-duplicates,return=minimal",
    )


def requeue_stuck() -> None:
    """Un lien reste « en cours » si le PC s'est eteint pendant l'analyse."""
    limit = (datetime.now(timezone.utc) - timedelta(minutes=STUCK_MINUTES)).isoformat()
    sb(
        "PATCH",
        "link_ideas",
        params={"status": "eq.processing", "updated_at": f"lt.{limit}", "attempts": "lt.3"},
        body={"status": "pending", "updated_at": now_iso()},
        prefer="return=minimal",
    )
    sb(
        "PATCH",
        "ai_jobs",
        params={"status": "eq.processing", "updated_at": f"lt.{limit}", "attempts": "lt.3"},
        body={"status": "pending", "updated_at": now_iso()},
        prefer="return=minimal",
    )


def requeue_provider_limits() -> tuple[int, int]:
    """Reprend les demandes que l'ancienne version a arretees au quota Claude."""
    counts = []
    for table in ("link_ideas", "ai_jobs"):
        rows = sb(
            "GET", table,
            params={"status": "eq.error", "select": "id,error", "limit": "1000"},
        ) or []
        ids = [
            row["id"] for row in rows
            if (
                str(row.get("error") or "").lower().startswith("claude code")
                and is_claude_usage_limit(RuntimeError(str(row.get("error") or "")))
            ) or (
                "chatgpt" in str(row.get("error") or "").lower()
                and is_provider_busy(RuntimeError(str(row.get("error") or "")))
            )
        ]
        if ids:
            body = {"status": "pending", "error": None, "updated_at": now_iso()}
            if table == "ai_jobs":
                body.update({"progress": 0, "step": None})
            sb(
                "PATCH", table,
                params={"id": f"in.({','.join(ids)})"},
                body=body,
                prefer="return=minimal",
            )
        counts.append(len(ids))
    return counts[0], counts[1]


def heartbeat_forever() -> None:
    """Signe de vie toutes les 30 s, meme pendant une analyse de plusieurs minutes."""
    while True:
        try:
            heartbeat()
        except Exception:
            pass
        time.sleep(30)


def claim() -> dict | None:
    # Evite de prendre une nouvelle analyse si Claude et ChatGPT sont deja
    # occupes : elle resterait en erreur/en attente et serait reprise aussitot.
    with CLAUDE_STATE_LOCK:
        claude_paused = time.time() < CLAUDE_PAUSED_UNTIL
    if (claude_paused and CODEX_CALL_LOCK.locked()) or (CLAUDE_CALL_LOCK.locked() and CODEX_CALL_LOCK.locked()):
        return None
    rows = sb(
        "GET",
        "link_ideas",
        params={"status": "eq.pending", "order": "created_at.asc", "limit": "1", "select": "*"},
    )
    if not rows:
        return None
    job = rows[0]
    # Le filtre status=pending rend la prise atomique : si une autre machine
    # l'a deja prise, la mise a jour ne renvoie rien.
    taken = sb(
        "PATCH",
        "link_ideas",
        params={"id": f"eq.{job['id']}", "status": "eq.pending"},
        body={"status": "processing", "attempts": (job.get("attempts") or 0) + 1, "updated_at": now_iso()},
        prefer="return=representation",
    )
    return taken[0] if taken else None


def update_idea(idea_id: str, **fields) -> None:
    fields["updated_at"] = now_iso()
    sb("PATCH", "link_ideas", params={"id": f"eq.{idea_id}"}, body=fields, prefer="return=minimal")


def user_provider(user_id: str) -> str:
    """Moteur IA choisi dans les reglages : auto, claude ou chatgpt."""
    try:
        rows = sb("GET", "profiles", params={"id": f"eq.{user_id}", "select": "ai_provider"})
        value = (rows[0].get("ai_provider") if rows else None) or "auto"
        return value if value in ("auto", "claude", "chatgpt") else "auto"
    except Exception:
        return "auto"


def user_lang(user_id: str) -> str:
    try:
        rows = sb("GET", "profiles", params={"id": f"eq.{user_id}", "select": "lang"})
        return (rows[0].get("lang") if rows else None) or "fr"
    except Exception:
        return "fr"


def trip_context(idea: dict) -> str:
    """Les voyages et etapes ou l'idee pourrait s'inserer, en texte."""
    today = date.today().isoformat()
    trips: list[dict] = []
    if idea.get("trip_id"):
        trips = sb("GET", "trips", params={"id": f"eq.{idea['trip_id']}", "select": "*"}) or []
    else:
        uid = idea["user_id"]
        own = sb("GET", "trips", params={"user_id": f"eq.{uid}", "select": "*"}) or []
        member_ids = [m["trip_id"] for m in (sb("GET", "trip_members", params={"user_id": f"eq.{uid}", "select": "trip_id"}) or [])]
        shared = (
            sb("GET", "trips", params={"id": f"in.({','.join(member_ids)})", "select": "*"}) if member_ids else []
        ) or []
        trips = [t for t in own + shared if not t.get("end_date") or t["end_date"] >= today]

    if not trips:
        return "Aucun voyage prevu pour l'instant."

    lines = []
    for t in trips:
        lines.append(f"Voyage « {t['title']} » du {t.get('start_date') or '?'} au {t.get('end_date') or '?'}")
        stops = sb("GET", "trip_stops", params={"trip_id": f"eq.{t['id']}", "order": "position.asc", "select": "*"}) or []
        for s in stops:
            lines.append(
                f"  - etape {s['name']} ({s.get('country') or ''}) : arrivee {s.get('arrive_date') or '?'}, depart {s.get('leave_date') or '?'}"
            )
        if not stops:
            lines.append("  (pas encore d'etapes)")
    return "\n".join(lines)


# --------------------------------------------------------------------------
# Recuperation du contenu
# --------------------------------------------------------------------------

def resolve_url(url: str) -> str:
    """Suit les liens courts (vm.tiktok.com, maps.app.goo.gl, youtu.be...)."""
    try:
        res = requests.get(url, headers={"User-Agent": UA}, allow_redirects=True, timeout=20, stream=True)
        final = res.url
        res.close()
        return final or url
    except Exception:
        return url


def page_meta(url: str) -> dict:
    """Titre et description Open Graph, quand la video ne se telecharge pas."""
    try:
        html = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "fr,en;q=0.8"}, timeout=20).text
    except Exception:
        return {}
    meta = {}
    for key in ("og:title", "og:description", "og:image", "description", "twitter:description"):
        m = re.search(
            rf'<meta[^>]+(?:property|name)=["\']{re.escape(key)}["\'][^>]+content=["\']([^"\']+)', html, re.I
        )
        if m:
            meta[key] = m.group(1)
    t = re.search(r"<title>([^<]+)</title>", html, re.I)
    if t:
        meta["title"] = t.group(1).strip()
    return meta


def maps_info(url: str) -> str:
    """Nom et coordonnees lisibles dans une URL Google Maps."""
    parts = []
    m = re.search(r"/place/([^/@]+)", url)
    if m:
        parts.append("Lieu : " + requests.utils.unquote(m.group(1)).replace("+", " "))
    c = re.search(r"@(-?\d+\.\d+),(-?\d+\.\d+)", url) or re.search(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)", url)
    if c:
        parts.append(f"Coordonnees : {c.group(1)}, {c.group(2)}")
    q = re.search(r"[?&]q=([^&]+)", url)
    if q:
        parts.append("Recherche : " + requests.utils.unquote(q.group(1)).replace("+", " "))
    return "\n".join(parts)


def download(url: str, tmp: Path) -> tuple[dict, Path | None]:
    import yt_dlp

    opts = {
        "format": "bv*[height<=480]+ba/b[height<=480]/bv*[height<=720]+ba/b",
        "outtmpl": str(tmp / "video.%(ext)s"),
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "noprogress": True,
        "no_warnings": True,
        "socket_timeout": 30,
        "max_filesize": 400 * 1024 * 1024,
        "http_headers": {"User-Agent": UA},
    }
    if COOKIES_BROWSER:
        opts["cookiesfrombrowser"] = (COOKIES_BROWSER,)
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True) or {}
        videos = [p for p in tmp.glob("video.*") if p.suffix.lower() in (".mp4", ".webm", ".mkv", ".mov")]
        # Sous-titres a part, en bonus : un echec (quota YouTube, piste absente)
        # ne doit pas faire perdre la video deja telechargee. Seulement les
        # pistes d'origine : les traductions automatiques declenchent des 429.
        try:
            subs_opts = {
                **opts,
                "skip_download": True,
                "writesubtitles": True,
                "writeautomaticsub": True,
                "subtitleslangs": ["fr", "en", "fr-orig", "en-orig"],
                "subtitlesformat": "vtt",
                "outtmpl": str(tmp / "subs.%(ext)s"),
            }
            with yt_dlp.YoutubeDL(subs_opts) as ydl:
                ydl.extract_info(url, download=True)
        except Exception:
            pass
        return info, (videos[0] if videos else None)
    except Exception as err:
        log(f"  telechargement impossible : {str(err)[:200]}")
        try:
            with yt_dlp.YoutubeDL({**opts, "skip_download": True}) as ydl:
                return ydl.extract_info(url, download=False) or {}, None
        except Exception:
            return {}, None


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def video_duration(video: Path) -> float:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(video)],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        return float(out)
    except Exception:
        return 0.0


def extract_frames(video: Path, tmp: Path, duration: float) -> list[Path]:
    """Images reparties sur toute la duree : on voit chaque plan sans tout envoyer."""
    interval = max(1.0, (duration or 30.0) / (MAX_FRAMES - 1))
    run(
        [
            "ffmpeg", "-y", "-i", str(video),
            "-vf", f"fps=1/{interval:.3f},scale=768:-2",
            "-frames:v", str(MAX_FRAMES), "-q:v", "5",
            str(tmp / "frame_%03d.jpg"),
        ]
    )
    return sorted(tmp.glob("frame_*.jpg"))


def thumbnail_data_url(frame: Path, tmp: Path) -> str | None:
    """Petite vignette en data URL : elle ne peut pas expirer, contrairement aux URL TikTok."""
    out = tmp / "thumb.jpg"
    try:
        run(["ffmpeg", "-y", "-i", str(frame), "-vf", "scale=480:-2", "-q:v", "7", str(out)])
        return "data:image/jpeg;base64," + base64.b64encode(out.read_bytes()).decode()
    except Exception:
        return None


def transcribe(video: Path, tmp: Path) -> str:
    if not GROQ_KEY:
        return ""
    audio = tmp / "audio.mp3"
    try:
        run(["ffmpeg", "-y", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", str(audio)])
    except Exception:
        return ""  # video sans piste son
    if not audio.exists() or audio.stat().st_size < 2000 or audio.stat().st_size > 24 * 1024 * 1024:
        return ""
    with audio.open("rb") as fh:
        res = requests.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {GROQ_KEY}"},
            files={"file": ("audio.mp3", fh, "audio/mpeg")},
            data={"model": "whisper-large-v3-turbo", "response_format": "text", "temperature": "0"},
            timeout=180,
        )
    if res.status_code >= 400:
        log(f"  transcription refusee : {res.status_code} {res.text[:160]}")
        return ""
    return res.text.strip()


def subtitles_text(tmp: Path) -> str:
    chunks = []
    for vtt in sorted(tmp.glob("*.vtt")):
        lines = []
        for line in vtt.read_text(encoding="utf-8", errors="ignore").splitlines():
            if "-->" in line or line.startswith(("WEBVTT", "Kind:", "Language:")) or not line.strip():
                continue
            clean = re.sub(r"<[^>]+>", "", line).strip()
            if clean and (not lines or lines[-1] != clean):
                lines.append(clean)
        if lines:
            chunks.append(f"[{vtt.stem}]\n" + " ".join(lines))
    return "\n\n".join(chunks)[:8000]


# --------------------------------------------------------------------------
# Claude, via Claude Code et l'abonnement Claude (pas de cle API)
# --------------------------------------------------------------------------

class Place(BaseModel):
    name: str = Field(description="Nom du lieu ou du point de depart")
    city: str
    country: str
    address: str = Field(description="Adresse ou zone, chaine vide si inconnue")
    lat: float | None = Field(description="Latitude si connue avec confiance, sinon null")
    lng: float | None = Field(description="Longitude si connue avec confiance, sinon null")


class Fit(BaseModel):
    stop_name: str = Field(description="Nom exact de l'etape du voyage ou cela s'integre, chaine vide si aucune")
    reason: str = Field(description="Pourquoi a ce moment-la, ou ce qu'il faudrait changer pour y aller")
    suggested_dates: list[str] = Field(description="1 a 4 dates AAAA-MM-JJ possibles pendant le voyage")


class Source(BaseModel):
    title: str
    url: str


class Analysis(BaseModel):
    name: str = Field(description="Nom COURT du lieu (40 caracteres max) : son vrai nom propre, ex. « Eagle Nest Bar », « Wat Pho ». Pas de description, pas de parentheses")
    kind: str = Field(description="Type : excursion en bateau, temple, restaurant, randonnee, marche...")
    summary: str = Field(description="Ce que c'est et pourquoi c'est bien, 2 a 3 phrases")
    place: Place
    price: str = Field(description="Prix indicatif par personne avec devise, chaine vide si inconnu")
    duration: str
    schedule: str = Field(description="Horaires ou departs, chaine vide si inconnus")
    booking: str = Field(description="Comment et ou reserver, delai conseille")
    booking_url: str = Field(description="Lien de reservation fiable, chaine vide sinon")
    best_time: str = Field(description="Meilleur moment : saison, heure, jour")
    tips: list[str] = Field(description="2 a 5 conseils pratiques")
    fit: Fit | None
    transcript_excerpt: str = Field(description="Passage utile de ce qui est dit dans la video, 600 caracteres max")
    sources: list[Source] = Field(description="Pages web consultees qui confirment les informations")
    relevant_frame_indexes: list[int] = Field(
        description="Indices 1-based des seules images de la video qui montrent clairement le lieu ou l'activite identifiee ; liste vide si aucune scene n'est reliee avec confiance",
    )


class Transport(BaseModel):
    mode: Literal["plane", "train", "bus", "boat", "car", "taxi", "motorbike", "other"]
    details: str = Field(description="Ligne, compagnie ou trajet concret")
    duration_hours: float
    price_estimate: float = Field(description="Prix indicatif par personne")
    currency: str
    how_to_book: str
    book_ahead_days: int = Field(description="Combien de jours a l'avance reserver, 0 si sur place")


class Stop(BaseModel):
    name: str = Field(description="Ville ou region ou l'on dort")
    country: str
    lat: float
    lng: float
    arrive_date: str = Field(description="AAAA-MM-JJ")
    leave_date: str = Field(description="AAAA-MM-JJ")
    why: str = Field(description="Pourquoi cette etape et cette duree, deux phrases maximum")
    highlights: list[str] = Field(description="3 a 6 choses a ne pas manquer, nommees")
    stay_tip: str = Field(description="Quartier ou type d'hebergement conseille")
    transport_to_next: Transport | None


class Todo(BaseModel):
    title: str
    kind: Literal["todo", "booking", "admin", "packing"]
    due_date: str = Field(description="AAAA-MM-JJ")
    notes: str


class AdminNote(BaseModel):
    title: str
    detail: str


class Itinerary(BaseModel):
    summary: str = Field(description="Vue d'ensemble, trois phrases maximum")
    stops: list[Stop]
    todos: list[Todo]
    admin: list[AdminNote]


class Currency(BaseModel):
    code: str = Field(description="Code ISO, ex. THB")
    name: str
    rate_hint: str = Field(description="Ordre de grandeur TRES court, 25 caracteres max, ex. « 1 EUR ≈ 37 THB »")


class Payments(BaseModel):
    summary: str = Field(description="En deux phrases : comment payer au quotidien dans ce pays")
    cards: str = Field(description="Ou la carte passe ou non, Visa/Mastercard, frais, sans contact")
    cash: str = Field(description="Place du liquide, petites coupures, ou changer")
    mobile: str = Field(description="Paiement mobile utilisable par un touriste etranger (apps, QR), ou pas")
    atm: str = Field(description="Distributeurs : frais fixes, banques conseillees, plafonds, astuces")
    tipping: str
    tips: list[str] = Field(description="3 a 6 bons reflexes argent (carte sans frais, refuser la conversion DCC...)")


class GuideItem(BaseModel):
    title: str = Field(description="Action courte et concrete")
    kind: Literal["todo", "booking", "admin", "packing"]
    when: Literal["before", "arrival", "during"]
    notes: str


class Guide(BaseModel):
    country: str
    currency: Currency
    payments: Payments
    entry: str = Field(description="Visa ou exemption pour CE passeport, duree, documents, e-visa, preuve de sortie")
    plugs: str = Field(description="Types de prises et tension, adaptateur necessaire ou non")
    sim: str = Field(description="eSIM / SIM locale, operateurs, prix, ou l'acheter")
    emergency: str = Field(description="Numeros d'urgence et police touristique")
    safety: list[str] = Field(description="Arnaques et precautions courantes, 3 a 6")
    etiquette: list[str] = Field(description="Usages importants, 3 a 6")
    checklist: list[GuideItem] = Field(description="8 a 15 choses a faire pour ce pays, du depart au sejour")


class MenuItem(BaseModel):
    name: str
    price: str = Field(description="Prix avec devise, chaine vide si inconnu")


class PlaceDetails(BaseModel):
    name: str = Field(description="Nom COURT du lieu (40 caracteres max) : son vrai nom propre, ex. « Eagle Nest Bar », « Wat Pho ». Pas de description, pas de parentheses")
    full_name: str = Field(description="Nom COMPLET et officiel du lieu, tel qu'affiche sur place ou sur Google Maps, ex. « Wat Phra Chetuphon Wimon Mangkhalaram (Wat Pho) »")
    family: Literal["culture", "nature", "food", "nightlife", "market", "activity", "wellness", "other"] = Field(
        description="Famille : culture (temples, musees, monuments), nature (plages, iles, parcs, points de vue), food (restaurants, cafes, street food), nightlife (bars, rooftops, festivals), market (marches, shopping), activity (excursions, cours, sports), wellness (spa, massage, sante), other"
    )
    kind: str = Field(description="restaurant, bar, cafe, temple, plage, atelier, spa, marche...")
    summary: str = Field(description="Ce que c'est et pourquoi y aller, 2 phrases maximum")
    address: str = Field(description="Adresse complete : numero, rue, quartier, ville")
    lat: float | None = Field(description="Latitude precise du lieu (5 decimales)")
    lng: float | None = Field(description="Longitude precise du lieu (5 decimales)")
    price: str = Field(description="COURT, 60 caracteres max : ex. « 250-400 THB / pers. » ou « 78 € les 2 nuits »")
    hours: str = Field(description="COURT, 60 caracteres max : ex. « 10 h-22 h, fermé lundi »")
    menu: list[MenuItem] = Field(description="Pour un lieu ou l'on mange/boit : 3 a 8 plats ou boissons phares avec prix ; sinon les formules / billets")
    booking: str = Field(description="Une phrase : faut-il reserver, ou, combien de temps avant")
    booking_url: str = Field(description="Lien de reservation ou site officiel, chaine vide sinon")
    best_time: str = Field(description="COURT, 70 caracteres max")
    duration: str = Field(description="COURT, 30 caracteres max : ex. « 2 h »")
    tips: list[str] = Field(description="3 a 5 conseils concrets, une phrase courte chacun")
    images: list[str] = Field(description="4 a 8 URL DIRECTES d'images (.jpg/.png/.webp) montrant CE lieu : site officiel, Wikimedia, Tripadvisor, Google... jamais une image d'un autre lieu")
    sources: list[Source]


def image_ok(url: str) -> bool:
    """L'image existe-t-elle vraiment (pas une page, pas un lien mort, pas une icone) ?"""
    try:
        r = requests.get(url, headers={"User-Agent": UA, "Range": "bytes=0-2048"}, timeout=12, stream=True, allow_redirects=True)
        ok = r.status_code < 400 and r.headers.get("content-type", "").startswith("image/")
        size = int(r.headers.get("content-range", "/0").split("/")[-1] or 0) or int(r.headers.get("content-length") or 0)
        r.close()
        return ok and (size == 0 or size > 15000)
    except Exception:
        return False


DETAILS_BRIEF = """Fais la fiche pratique complete de ce lieu pour deux voyageurs, en cherchant sur le web
(WebSearch, WebFetch : site officiel, Google Maps, Tripadvisor, Instagram, articles recents).
Identifie le lieu exact. L'ADRESSE COMPLETE (numero, rue, quartier, ville) et les coordonnees GPS
PRECISES du lieu lui-meme sont obligatoires : verifie-les sur Google Maps ou le site officiel.
Donne de VRAIES infos : prix, horaires, plats ou billets phares avec prix,
reservation, conseils. Ajoute des URL directes d'images de CE lieu (ouvre les pages pour trouver
les fichiers images). Pour les images : uniquement des PHOTOS du lieu lui-meme (facade, interieur, vue, plats), jamais une
miniature Instagram, un logo, une capture avec du texte, une carte ou un lieu voisin. Verifie que
chaque URL est bien un fichier image de CE lieu avant de la donner.
N'invente rien : laisse vide ce que tu ne trouves pas.
{lang}

Si le nom donne est vague ou generique (ex. « buffet », « bar sur le toit », « cours de cuisine »),
trouve le VRAI lieu grace aux notes et a la ville, et donne son vrai nom propre.

Lieu : {name}
Ville : {city}, {country}
Ce que les voyageurs en ont note : {notes}
"""


def details_from_analysis(a: dict) -> dict:
    """Une video analysee donne deja l'essentiel de la fiche."""
    pl = a.get("place") or {}
    return {
        "name": a.get("name", ""),
        "kind": a.get("kind", ""),
        "summary": a.get("summary", ""),
        "address": pl.get("address", ""),
        "price": a.get("price", ""),
        "hours": a.get("schedule", ""),
        "menu": [],
        "booking": a.get("booking", ""),
        "booking_url": a.get("booking_url", ""),
        "best_time": a.get("best_time", ""),
        "duration": a.get("duration", ""),
        "tips": a.get("tips", []),
        "images": [],
        "sources": a.get("sources", []),
    }


class Sight(BaseModel):
    name: str = Field(description="Nom COURT du lieu (40 caracteres max) : son vrai nom propre, ex. « Eagle Nest Bar », « Wat Pho ». Pas de description, pas de parentheses")
    kind: str = Field(description="temple, plage, marche, point de vue, restaurant, excursion...")
    why: str = Field(description="Pourquoi y aller, une ou deux phrases")
    city: str
    lat: float = Field(description="Latitude precise du lieu lui-meme (pas du centre-ville)")
    lng: float
    price_level: int | None = Field(description="1 (gratuit ou presque) a 4 (cher), null si inconnu")
    duration: str = Field(description="Temps a prevoir")
    best_time: str = Field(description="Meilleur moment de la journee ou de la semaine")


class Sights(BaseModel):
    places: list[Sight]


SIGHTS_BRIEF = """Propose les incontournables a voir et a faire pendant une etape de voyage.
Choisis 6 a 10 lieux reels, varies (culture, nature, marches, points de vue, une ou deux bonnes
tables, une excursion si elle vaut le coup), adaptes a la duree du sejour et a la saison.
Coordonnees PRECISES de chaque lieu (verifie sur le web si besoin) : elles servent a les placer
sur une carte. Evite les doublons avec ce qui est deja prevu.
{lang}

Etape : {stop} ({country})
Sejour : du {arrive} au {leave}
Deja prevu sur place : {existing}
Preferences : {prefs}
"""


def insert_sights(job: dict, req: dict, sights: list[dict]) -> int:
    """Place les incontournables dans le voyage, en « a visiter », sans doublon."""
    trip_id = job.get("trip_id")
    existing = sb("GET", "places", params={"trip_id": f"eq.{trip_id}", "select": "name"}) or []
    known = {e["name"].strip().lower() for e in existing}
    rows = []
    for s in sights:
        if s["name"].strip().lower() in known:
            continue
        known.add(s["name"].strip().lower())
        notes = "\n".join(
            x
            for x in [
                s.get("why", ""),
                f"Temps a prevoir : {s['duration']}" if s.get("duration") else "",
                f"Meilleur moment : {s['best_time']}" if s.get("best_time") else "",
                f"Etape : {req.get('stop', '')}",
            ]
            if x
        )
        rows.append(
            {
                "user_id": job["user_id"],
                "trip_id": trip_id,
                "name": s["name"],
                "country": req.get("country") or "",
                "city": s.get("city") or req.get("stop"),
                "lat": s["lat"],
                "lng": s["lng"],
                "notes": notes,
                "status": "wishlist",
                "price_level": s.get("price_level") if s.get("price_level") in (1, 2, 3, 4) else None,
            }
        )
    if rows:
        sb("POST", "places", body=rows, prefer="return=minimal")
    return len(rows)


COUNTRY_BRIEF = """Prepare une fiche pratique pour des voyageurs independants qui vont dans ce pays.
Verifie sur le web (WebSearch, WebFetch) tout ce qui change souvent : regles d'entree et visa pour leur
passeport, paiement mobile accessible aux etrangers, frais des distributeurs, taux de change.
Le moyen de payer est la partie la plus importante : sois precis et concret.
Sois factuel ; signale ce qui doit etre verifie au lieu de l'inventer.
{lang}

Pays : {country}
Passeport des voyageurs : {passport}
Voyage : du {start} au {end}
Etapes dans ce pays : {stops}
Date du jour : {today}
"""


def inline_schema(model: type[BaseModel]) -> dict:
    """Schema JSON sans $ref : plus sur pour --json-schema."""
    schema = model.model_json_schema()
    defs = schema.pop("$defs", {})

    def resolve(node):
        if isinstance(node, dict):
            if "$ref" in node:
                return resolve(defs[node["$ref"].split("/")[-1]])
            # Retirer le titre descriptif genere par Pydantic, mais conserver
            # une vraie propriete metier nommee « title » dans properties.
            out = {
                k: resolve(v) for k, v in node.items()
                if k != "default" and not (k == "title" and isinstance(v, str))
            }
            # Codex applique le mode JSON Schema strict : chaque objet doit
            # refuser explicitement les proprietes non declarees.
            if out.get("type") == "object":
                out["additionalProperties"] = False
            return out
        if isinstance(node, list):
            return [resolve(v) for v in node]
        return node

    return resolve(schema)


# Demande IA en cours sur ce fil : sa jauge avance avec les vraies etapes
CURRENT = threading.local()
EXPECTED_STEPS = {"place_info": 14, "schedule_place": 6, "arrange_trip": 10, "day_plan": 8, "chat": 6, "stop_places": 12, "country_guide": 14, "itinerary": 14, "receipt_scan": 3, "vaccines": 12, "emergency": 12, "gap_search": 12}


def progress(pct: int, step: str | None = None, *, force: bool = False) -> None:
    """Ecrit l'avancement reel de la demande (au plus toutes les 1,5 s)."""
    job_id = getattr(CURRENT, "job_id", None)
    if not job_id:
        return
    pct = max(getattr(CURRENT, "pct", 0), min(99, int(pct)))
    now = time.time()
    if not force and now - getattr(CURRENT, "at", 0) < 1.5 and step == getattr(CURRENT, "step", None):
        return
    CURRENT.pct, CURRENT.at, CURRENT.step = pct, now, step
    try:
        body = {"progress": pct, "updated_at": now_iso()}
        if step is not None:
            body["step"] = step[:160]
        sb("PATCH", "ai_jobs", params={"id": f"eq.{job_id}"}, body=body, prefer="return=minimal")
    except Exception:
        pass


def step_label(name: str, args: dict) -> str:
    """Etape lisible, en code traduit par l'app : « search:Wat Pho horaires »."""
    if name == "WebSearch":
        return f"search:{args.get('query', '')}"
    if name == "WebFetch":
        url = str(args.get("url", ""))
        return "read:" + re.sub(r"^https?://(www\.)?", "", url).split("/")[0]
    if name == "Read":
        return "photo:" + Path(str(args.get("file_path", ""))).name
    if name == "StructuredOutput":
        return "write:"
    return "think:"


def claude_only_json(prompt: str, model: type[BaseModel], *, cwd: Path, tools: list[str], timeout: int = 900, span: tuple[int, int] = (5, 80)) -> dict:
    """
    Appelle Claude Code en mode non interactif avec une sortie structuree, en
    flux : chaque outil utilise (recherche, page lue, photo regardee) fait
    avancer la jauge. ANTHROPIC_API_KEY est retiree de l'environnement : sans
    ca, Claude Code facturerait la cle API au lieu de l'abonnement Claude.
    """
    exe = shutil.which("claude")
    if not exe:
        raise RuntimeError("Claude Code introuvable sur cette machine (commande « claude »).")
    env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
    cmd = [
        exe, "-p",
        "--output-format", "stream-json", "--verbose",
        "--model", CLAUDE_MODEL,
        "--json-schema", json.dumps(inline_schema(model), ensure_ascii=False),
        "--max-turns", "40",
        "--allowedTools", *tools,
    ]
    lo, hi = span
    expected = EXPECTED_STEPS.get(getattr(CURRENT, "kind", ""), 10)
    progress(lo, "think:", force=True)
    proc = subprocess.Popen(
        cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", errors="replace", cwd=str(cwd), env=env,
    )
    killer = threading.Timer(timeout, proc.kill)
    killer.start()
    final: dict | None = None
    steps = 0
    try:
        assert proc.stdin and proc.stdout
        proc.stdin.write(prompt)
        proc.stdin.close()
        for line in proc.stdout:
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                ev = json.loads(line)
            except Exception:
                continue
            if ev.get("type") == "assistant":
                for c in (ev.get("message") or {}).get("content") or []:
                    if c.get("type") == "tool_use" and c.get("name") != "ToolSearch":
                        steps += 1
                        # Courbe qui ralentit sans jamais atteindre le bout tant
                        # que Claude n'a pas rendu sa fiche
                        frac = 1 - pow(0.5, steps / max(1.0, expected / 3))
                        progress(lo + (hi - lo) * frac, step_label(c.get("name", ""), c.get("input") or {}))
            elif ev.get("type") == "result":
                final = ev
        proc.wait(timeout=30)
    finally:
        killer.cancel()
    if final is None:
        err = (proc.stderr.read() if proc.stderr else "")[:300]
        raise RuntimeError(f"Claude Code n'a rien renvoye : {err or 'delai depasse'}")
    if final.get("is_error"):
        raise RuntimeError(f"Claude Code : {str(final.get('result'))[:300]}")
    result = final.get("structured_output")
    if result is None:
        raw = final.get("result") or ""
        i = raw.find("{")
        result = json.loads(raw[i:]) if i >= 0 else None
    if result is None:
        raise RuntimeError("Reponse de Claude sans fiche structuree.")
    progress(hi, "write:", force=True)
    return model.model_validate(result).model_dump()


def codex_json(
    prompt: str,
    model: type[BaseModel],
    *,
    cwd: Path,
    timeout: int = 900,
    span: tuple[int, int] = (5, 80),
    images: list[Path] | None = None,
    web_search: bool = False,
) -> dict:
    """Secours structure via Codex CLI et l'abonnement ChatGPT du PC."""
    exe = shutil.which("codex.cmd") or shutil.which("codex")
    if not exe:
        raise RuntimeError("Codex CLI introuvable : le relais ChatGPT ne peut pas demarrer.")
    schema_path = cwd / "codex-output-schema.json"
    output_path = cwd / "codex-result.json"
    schema_path.write_text(json.dumps(inline_schema(model), ensure_ascii=False), encoding="utf-8")
    env = {k: v for k, v in os.environ.items() if k not in ("OPENAI_API_KEY", "CODEX_API_KEY")}
    cmd = [
        exe, "exec", "--ephemeral", "--skip-git-repo-check",
        "--sandbox", "read-only", "--model", CODEX_MODEL,
        "-c", 'model_reasoning_effort="low"',
    ]
    if web_search:
        # Le CLI garde sa connexion au compte ChatGPT; aucune cle API n'est lue.
        cmd.extend(["--enable", "standalone_web_search"])
    for image in (images or []):
        if image.is_file():
            cmd.extend(["--image", str(image)])
    cmd.extend([
        "--output-schema", str(schema_path),
        "--output-last-message", str(output_path),
        "-",
    ])
    lo, hi = span
    progress(max(lo, getattr(CURRENT, "pct", lo)), "fallback:ChatGPT", force=True)
    completed = subprocess.run(
        cmd, input=prompt, capture_output=True, text=True, encoding="utf-8", errors="replace",
        cwd=str(cwd), env=env, timeout=timeout,
    )
    if completed.returncode != 0 or not output_path.exists():
        detail = (completed.stderr or completed.stdout or "aucune reponse")[-500:]
        raise RuntimeError(f"Codex/ChatGPT : {detail}")
    raw = output_path.read_text(encoding="utf-8", errors="replace").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.I)
    result = json.loads(raw)
    progress(hi, "write:", force=True)
    return model.model_validate(result).model_dump()


def is_claude_usage_limit(err: Exception) -> bool:
    text = str(err).lower()
    return any(marker in text for marker in (
        "you've hit your", "usage limit", "rate limit", "limit reached",
        "quota", "resets at", "resets in",
    ))


def is_provider_busy(err: Exception) -> bool:
    text = str(err).lower()
    return any(marker in text for marker in (
        "busy", "already processing", "already occupied", "already in use", "occup", "concurrent", "overloaded", "temporarily unavailable",
        "too many requests", "429", "502", "503", "529", "connection reset", "timed out",
    ))


def claude_json(
    prompt: str,
    model: type[BaseModel],
    *,
    cwd: Path,
    tools: list[str],
    timeout: int = 900,
    span: tuple[int, int] = (5, 80),
    codex_images: list[Path] | None = None,
) -> dict:
    """
    Claude Sonnet est prioritaire. Si Claude est deja occupe, une autre demande
    compatible passe sur Codex/ChatGPT; au prochain travail disponible, Claude
    redevient prioritaire. En cas de quota Claude epuise, ChatGPT prend le relais
    jusqu'au retest automatique.
    """
    global CLAUDE_PAUSED_UNTIL
    # Choix de l'utilisateur (reglages de l'app) : un seul moteur, sans bascule
    mode = getattr(CURRENT, "provider", "auto")
    if mode == "claude":
        return claude_only_json(prompt, model, cwd=cwd, tools=tools, timeout=timeout, span=span)
    if mode == "chatgpt":
        with CODEX_CALL_LOCK:
            log(f"ChatGPT/{CODEX_MODEL} (choix de l'utilisateur).")
            return codex_json(
                prompt, model, cwd=cwd, timeout=timeout, span=span,
                images=codex_images, web_search="WebSearch" in tools,
            )
    with CLAUDE_STATE_LOCK:
        claude_paused = time.time() < CLAUDE_PAUSED_UNTIL
    claude_error: Exception | None = None

    def try_claude() -> tuple[dict | None, bool]:
        """Retourne (resultat, occupe). Le verrou non bloquant libere le relais."""
        global CLAUDE_PAUSED_UNTIL
        nonlocal claude_error
        if not CLAUDE_CALL_LOCK.acquire(blocking=False):
            return None, True
        try:
            result = claude_only_json(prompt, model, cwd=cwd, tools=tools, timeout=timeout, span=span)
            with CLAUDE_STATE_LOCK:
                was_paused = CLAUDE_PAUSED_UNTIL > 0
                CLAUDE_PAUSED_UNTIL = 0.0
            if was_paused:
                log("Quota Claude revenu : Sonnet redevient le modele prioritaire.")
            return result, False
        except Exception as err:
            claude_error = err
            if is_claude_usage_limit(err):
                with CLAUDE_STATE_LOCK:
                    CLAUDE_PAUSED_UNTIL = time.time() + CLAUDE_RETRY_SECONDS
                log(f"Limite Claude atteinte : nouvel essai dans {CLAUDE_RETRY_SECONDS // 60} min.")
            else:
                log(f"Claude indisponible pour cette demande : {str(err)[:180]}")
            return None, False
        finally:
            CLAUDE_CALL_LOCK.release()

    if not claude_paused:
        result, claude_busy = try_claude()
        if result is not None:
            return result
        if claude_busy:
            claude_error = RuntimeError("Claude Code est deja occupe par une autre demande.")
            log("Claude occupe : tentative parallele via ChatGPT.")
        with CLAUDE_STATE_LOCK:
            claude_paused = time.time() < CLAUDE_PAUSED_UNTIL

    if not getattr(CURRENT, "codex_allowed", False):
        raise ProviderPausedError("Claude est occupe ou en pause; cette recherche reprendra automatiquement.") from claude_error

    def try_codex() -> dict | None:
        if not CODEX_CALL_LOCK.acquire(blocking=False):
            return None
        try:
            log(f"Relais ChatGPT/{CODEX_MODEL} pour une demande immediate.")
            return codex_json(
                prompt, model, cwd=cwd, timeout=timeout, span=span,
                images=codex_images, web_search="WebSearch" in tools,
            )
        finally:
            CODEX_CALL_LOCK.release()

    try:
        result = try_codex()
        if result is not None:
            return result
        codex_error = RuntimeError("ChatGPT est deja occupe par une autre demande.")
    except Exception as err:
        codex_error = err
        log(f"ChatGPT indisponible pour cette demande : {str(err)[:180]}")

    # Si ChatGPT est occupe ou vient d'echouer, tenter Claude une fois de plus :
    # son verrou a pu se liberer entre-temps. On ne retente pas un Claude en quota.
    if not claude_paused:
        result, claude_busy = try_claude()
        if result is not None:
            log("Claude a repris la demande apres indisponibilite de ChatGPT.")
            return result
        if claude_busy or is_provider_busy(claude_error or RuntimeError("busy")):
            raise ProviderPausedError("Claude et ChatGPT sont occupes; la demande reste en file.") from codex_error
    if is_provider_busy(codex_error):
        raise ProviderPausedError("ChatGPT est temporairement occupe; la demande reste en file.") from codex_error
    raise codex_error


class ProviderPausedError(RuntimeError):
    """La tache reste en file : on economise ChatGPT jusqu'au retour de Claude."""


VIDEO_BRIEF = """Tu aides deux voyageurs a transformer une publication des reseaux sociaux en plan de voyage concret.

Dans ce dossier se trouvent les images d'une courte video, dans l'ordre ({frames}).
Regarde-les TOUTES avec l'outil Read : textes a l'ecran, panneaux, noms de bateaux, logos, paysages.

1. Determine exactement ce qui est montre : l'activite, le lieu, l'operateur s'il est visible.
   Les images sont numerotees dans l'ordre (1 = premiere image). La video peut contenir des scenes
   d'autres lieux : dans relevant_frame_indexes, ne retiens QUE les indices qui montrent clairement
   le lieu/activite finalement confirme, jamais une transition, une pub ou une scene sans rapport.
   Si aucune image ne peut etre reliee avec confiance au lieu, renvoie une liste vide.
2. Cherche sur le web (WebSearch, WebFetch) pour le confirmer et trouver les infos pratiques :
   vrai nom, emplacement, prix, duree, horaires ou departs, comment et ou reserver, combien de
   temps a l'avance, saison, et tout ce qui empecherait de le faire a leurs dates.
3. Dis ou cela s'integre dans leurs voyages : quelle etape, quelles dates conviennent. Si ce
   n'est pres d'aucune etape prevue, dis ce qu'il faudrait changer.
Sois factuel : si quelque chose ne peut pas etre confirme, dis-le au lieu de l'inventer.
{lang}

--- Informations sur la publication ---
{header}
"""


ITINERARY_BRIEF = """Tu es un organisateur de voyages experimente, specialiste des longs voyages independants
(Asie du Sud-Est notamment). Transforme les notes brutes des voyageurs en itineraire realiste et date.

Regles :
- Respecte tout ce qu'ils donnent comme fixe (arrivee, vols, dates, lieux). Comble les trous autour.
  Ne supprime jamais un lieu qu'ils ont cite ; s'il ne rentre pas, dis-le dans le resume.
- Les dates s'enchainent : le depart d'une etape est l'arrivee de la suivante (ou la veille pour un
  trajet de nuit). Couvre tout le voyage du debut a la fin, sans trou inexplique.
- Pas d'etape d'une seule nuit sauf transit. Trajets realistes (vol interieur, train de nuit, bus,
  ferry, passage de frontiere) avec duree et prix honnetes.
- Tiens compte de la saison et des evenements a ces dates (meteo de chaque cote, fetes, periodes
  qui affichent complet) et adapte l'itineraire si c'est important. Verifie sur le web ce qui
  change souvent (visas, e-visa Vietnam, regles d'entree, meteo).
- A faire : actions concretes avec une echeance sensee, au plus tot aujourd'hui.
- Formalites : visas et entree dans chaque pays, sante, argent, securite ; signale ce qui est a verifier.
- Vrais noms de lieux, coordonnees approximatives du centre-ville.
{lang}

--- Demande ---
{request}
"""


def lang_line(lang: str) -> str:
    return (
        "Ecris tous les textes de la fiche en francais, avec les accents. Dates au format AAAA-MM-JJ."
        if lang == "fr"
        else "Write every text field in English. Dates as YYYY-MM-DD."
    )


# --------------------------------------------------------------------------
# Traitement d'un lien
# --------------------------------------------------------------------------

FRAMES_BUCKET = "idea-frames"


def upload_frames(frames: list[Path], tmp: Path, key: str, count: int = 6) -> list[tuple[int, str]]:
    """Envoie quelques images de la video et conserve leur indice d'origine."""
    if not frames or not SB_KEY:
        return []
    step = max(1, len(frames) // count)
    picked = list(enumerate(frames))[::step][:count]
    urls = []
    for n, (frame_index, frame) in enumerate(picked):
        out = tmp / f"up_{n}.jpg"
        try:
            run(["ffmpeg", "-y", "-i", str(frame), "-vf", "scale=720:-2", "-q:v", "5", str(out)])
            path = f"{key}/{n}.jpg"
            res = requests.post(
                f"{SB_URL}/storage/v1/object/{FRAMES_BUCKET}/{path}",
                headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}", "Content-Type": "image/jpeg", "x-upsert": "true"},
                data=out.read_bytes(),
                timeout=60,
            )
            if res.status_code < 300:
                urls.append((frame_index + 1, f"{SB_URL}/storage/v1/object/public/{FRAMES_BUCKET}/{path}"))
        except Exception:
            continue
    return urls


def analyse(url: str, note: str | None, context: str, lang: str, key: str | None = None) -> tuple[dict, str | None, str | None, list[str]]:
    final_url = resolve_url(url)
    tmp = Path(tempfile.mkdtemp(prefix="bubu-"))
    try:
        title = None
        thumb = None
        info: dict = {}
        transcript = ""
        subs = ""
        frames: list[Path] = []
        uploaded_frames: list[tuple[int, str]] = []
        frame_urls: list[str] = []
        maps = ""

        is_maps = ("google." in final_url and "/maps" in final_url) or "goo.gl/maps" in url or "maps.app.goo.gl" in url
        if is_maps:
            maps = maps_info(final_url)
        else:
            info, video = download(final_url, tmp)
            title = info.get("title") or None
            if video:
                duration = info.get("duration") or video_duration(video)
                frames = extract_frames(video, tmp, float(duration or 0))
                log(f"  video {video.stat().st_size // 1024} Ko, {duration or '?'} s, {len(frames)} images")
                transcript = transcribe(video, tmp)
                log(f"  transcription : {len(transcript)} caracteres")
                video.unlink(missing_ok=True)
            subs = subtitles_text(tmp)

        meta = page_meta(final_url) if not info else {}
        header = "\n".join(
            h
            for h in [
                f"Lien : {url}",
                f"Lien resolu : {final_url}" if final_url != url else "",
                f"Google Maps :\n{maps}" if maps else "",
                f"Plateforme : {info.get('extractor_key') or ''}",
                f"Titre : {info.get('title') or meta.get('og:title') or meta.get('title') or ''}",
                f"Auteur : {info.get('uploader') or info.get('channel') or ''}",
                "Legende / description : "
                + (info.get("description") or meta.get("og:description") or meta.get("description") or "")[:4000],
                f"Lieu indique par la plateforme : {info.get('location') or ''}",
                f"Precision des voyageurs : {note}" if note else "",
                f"Transcription de la voix :\n{transcript[:12000]}" if transcript else "Pas de transcription.",
                f"Sous-titres :\n{subs}" if subs else "",
                "",
                f"Date du jour : {date.today().isoformat()}",
                f"Voyages des voyageurs :\n{context}",
            ]
            if h
        )
        frame_list = ", ".join(f.name for f in frames) if frames else "aucune image : la video n'a pas pu etre telechargee"
        prompt = VIDEO_BRIEF.format(frames=frame_list, lang=lang_line(lang), header=header)
        if not thumb:
            thumb = info.get("thumbnail") or meta.get("og:image")

        data = claude_json(prompt, Analysis, cwd=tmp, tools=["Read", "WebSearch", "WebFetch"], codex_images=frames)
        if frames:
            relevant = {i for i in data.get("relevant_frame_indexes", []) if isinstance(i, int) and 1 <= i <= len(frames)}
            selected_indexes = sorted(relevant)
            selected_frames = [frames[i - 1] for i in selected_indexes]
            uploaded_frames = upload_frames(selected_frames, tmp, key or uuid.uuid4().hex) if selected_frames else []
            data["uploaded_frame_indexes"] = [selected_indexes[i - 1] for i, _ in uploaded_frames]
            frame_urls = [url for _, url in uploaded_frames]
            # La vignette du reseau social n'est pas une photo du lieu verifiee.
            # Elle ne devient couverture que si l'image correspondante a ete retenue.
            thumb = frame_urls[0] if frame_urls else None
        else:
            frame_urls = []
            if not thumb:
                thumb = info.get("thumbnail") or meta.get("og:image")
        log(f"  fiche prete, {len(data.get('sources') or [])} sources")
        if transcript and not data.get("transcript_excerpt"):
            data["transcript_excerpt"] = transcript[:600]
        return data, (title or data.get("name")), thumb, frame_urls
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def process(job: dict) -> None:
    log(f"Lien {job['id'][:8]} : {job['url']}")
    CURRENT.kind, CURRENT.codex_allowed = "link_idea", True
    try:
        lang = user_lang(job["user_id"])
        CURRENT.provider = user_provider(job["user_id"])
        context = trip_context(job)
        data, title, thumb, frames = analyse(job["url"], job.get("note"), context, lang, key=job["id"])
        update_idea(job["id"], status="ready", analysis=data, title=title, thumbnail=thumb, frames=frames, error=None)
        log(f"  pret : {data.get('name')}")
        link_place({**job, "analysis": data, "thumbnail": thumb, "frames": frames})
        auto_place_idea({**job, "analysis": data, "thumbnail": thumb, "frames": frames, "status": "ready"})
    except ProviderPausedError as err:
        update_idea(job["id"], status="pending", error=None)
        log(f"  en pause : {err}")
    except Exception as err:
        traceback.print_exc()
        update_idea(job["id"], status="error", error=str(err)[:300])


def shortcode(url: str) -> str:
    """Identifiant stable d'un lien (code Instagram, ou l'URL sans parametres)."""
    m = re.search(r"instagram\.com/(?:reel|p)/([^/?]+)", url)
    if m:
        return m.group(1)
    return url.split("?")[0].rstrip("/")


def geocode_osm(query: str) -> tuple[float, float] | None:
    try:
        time.sleep(1.1)
        r = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": query, "format": "jsonv2", "limit": 1},
            headers={"User-Agent": "BuBuTravel/1.0"},
            timeout=20,
        )
        d = r.json()
        return (float(d[0]["lat"]), float(d[0]["lon"])) if d else None
    except Exception:
        return None


def link_place(idea: dict) -> None:
    """
    Le lieu du voyage cree a partir de ce lien (meme URL dans ses notes)
    recoit les images de la video ; s'il etait place approximativement, il
    prend aussi le vrai nom et la vraie position trouves par l'analyse.
    """
    a = idea.get("analysis") or {}
    if not idea.get("trip_id") or not a:
        return
    code = shortcode(idea["url"])
    places = sb("GET", "places", params={"trip_id": f"eq.{idea['trip_id']}", "notes": f"ilike.*{code}*", "select": "*"}) or []
    for place in places:
        patch: dict = {}
        frames = idea.get("frames") or []
        if "relevant_frame_indexes" in a:
            matched = {i for i in a.get("relevant_frame_indexes", []) if isinstance(i, int)}
            uploaded_indexes = a.get("uploaded_frame_indexes") or list(range(1, len(frames) + 1))
            frames = [url for i, url in zip(uploaded_indexes, frames) if i in matched]
        verified = ((place.get("details") or {}).get("images")) or []
        if frames or verified:
            # Les photos verifiees du lieu restent devant les images de la video
            gallery = verified + [u for u in frames if u not in verified]
            patch["gallery"] = gallery[:10]
            patch["image_url"] = gallery[0]
        elif not ("relevant_frame_indexes" in a) and idea.get("thumbnail") and str(idea["thumbnail"]).startswith("http"):
            patch["image_url"] = idea["thumbnail"]
        if not place.get("details"):
            patch["details"] = details_from_analysis(a)
        notes = place.get("notes") or ""
        if "Position approximative" in notes:
            pl = a.get("place") or {}
            lat, lng = pl.get("lat"), pl.get("lng")
            if lat is None or lng is None:
                for q in [pl.get("address"), f"{pl.get('name', '')}, {pl.get('city', '')}", a.get("name")]:
                    if q and q.strip(", "):
                        hit = geocode_osm(f"{q}, {pl.get('country', '')}".strip(", "))
                        if hit:
                            lat, lng = hit
                            break
            if lat is not None and lng is not None:
                patch.update({"lat": lat, "lng": lng})
                if pl.get("city"):
                    patch["city"] = pl["city"]
                if a.get("name"):
                    patch["name"] = a["name"][:120]
                where = pl.get("address") or ", ".join(x for x in [pl.get("name"), pl.get("city")] if x)
                patch["notes"] = notes.replace(
                    "Position approximative (centre de la ville) : à préciser.",
                    f"Position corrigée d'après la vidéo : {where}.",
                )
        if patch:
            sb("PATCH", "places", params={"id": f"eq.{place['id']}"}, body=patch, prefer="return=minimal")
            log(f"  lieu mis a jour : {patch.get('name', place['name'])}")
        # Une video sans image clairement confirmee ne doit pas remplir la fiche
        # avec des scenes sans rapport : lancer plutot la recherche photo du lieu.
        details = place.get("details") or {}
        has_place_photo = bool(details.get("images") or place.get("gallery") or frames or (place.get("image_url") and not ("relevant_frame_indexes" in a)))
        if not has_place_photo and idea.get("user_id"):
            try:
                active = sb("GET", "ai_jobs", params={
                    "kind": "eq.place_info", "input->>place_id": f"eq.{place['id']}",
                    "status": "in.(pending,processing)", "select": "id", "limit": "1",
                }) or []
                if not active:
                    sb("POST", "ai_jobs", body={
                        "user_id": idea["user_id"], "trip_id": idea["trip_id"],
                        "kind": "place_info", "input": {"place_id": place["id"], "lang": user_lang(idea["user_id"])},
                    }, prefer="return=minimal")
                    log(f"  photos exactes a rechercher pour {place.get('name') or a.get('name')}")
            except Exception as err:
                log(f"  avertissement : recherche photo impossible pour {place.get('name') or a.get('name')} ({str(err)[:100]})")


# --------------------------------------------------------------------------
# Demandes a l'IA (assistant d'itineraire)
# --------------------------------------------------------------------------

def claim_ai_job() -> dict | None:
    # Ce que quelqu'un attend a l'ecran passe avant les traitements de fond :
    # apercus « Remplir les informations », assistant d'itineraire, fiches pays.
    with CLAUDE_STATE_LOCK:
        claude_paused = time.time() < CLAUDE_PAUSED_UNTIL
    if (claude_paused and CODEX_CALL_LOCK.locked()) or (CLAUDE_CALL_LOCK.locked() and CODEX_CALL_LOCK.locked()):
        return None
    immediate = (
        sb("GET", "ai_jobs", params={"status": "eq.pending", "kind": "in.(chat,schedule_place,day_plan,itinerary,country_guide,receipt_scan,vaccines,emergency,gap_search,place_info,arrange_trip,stop_places)", "order": "created_at.asc", "limit": "1", "select": "*"})
        or sb("GET", "ai_jobs", params={"status": "eq.pending", "input->>preview": "eq.true", "order": "created_at.asc", "limit": "1", "select": "*"})
    )
    rows = immediate if claude_paused else (
        immediate
        # Le reste : la demande la plus recente d'abord (ce qu'on vient de lancer
        # passe avant les longues files de fond)
        or sb("GET", "ai_jobs", params={"status": "eq.pending", "order": "created_at.desc", "limit": "1", "select": "*"})
    )
    if not rows:
        return None
    job = rows[0]
    taken = sb(
        "PATCH",
        "ai_jobs",
        params={"id": f"eq.{job['id']}", "status": "eq.pending"},
        body={"status": "processing", "attempts": (job.get("attempts") or 0) + 1, "updated_at": now_iso()},
        prefer="return=representation",
    )
    return taken[0] if taken else None


def update_ai_job(job_id: str, **fields) -> None:
    fields["updated_at"] = now_iso()
    if fields.get("status") == "ready":
        fields["progress"] = 100
        fields["step"] = "done:"
    sb("PATCH", "ai_jobs", params={"id": f"eq.{job_id}"}, body=fields, prefer="return=minimal")


def redact_receipt_image(job_id: str, req: dict) -> None:
    """Ne conserve jamais la photo de reçu dans l'historique des tâches IA."""
    if req.pop("image", None) is not None:
        try:
            sb("PATCH", "ai_jobs", params={"id": f"eq.{job_id}"}, body={"input": req, "updated_at": now_iso()}, prefer="return=minimal")
        except Exception as err:
            log(f"  avertissement : photo de reçu non effacée de la tâche {job_id[:8]} ({str(err)[:100]})")


def process_ai_job(job: dict) -> None:
    log(f"Demande IA {job['id'][:8]} : {job['kind']}")
    req = job.get("input") or {}
    CURRENT.job_id, CURRENT.kind, CURRENT.pct, CURRENT.at, CURRENT.step = job["id"], job["kind"], 0, 0, None
    CURRENT.provider = user_provider(job["user_id"])
    CURRENT.codex_allowed = job["kind"] in (
        "place_info", "schedule_place", "arrange_trip", "day_plan", "chat",
        "stop_places", "country_guide", "itinerary", "receipt_scan", "vaccines", "emergency", "gap_search",
    ) or bool(req.get("preview"))
    tmp = Path(tempfile.mkdtemp(prefix="bubu-ai-"))
    try:
        if job["kind"] == "place_info":
            place = (sb("GET", "places", params={"id": f"eq.{req.get('place_id')}", "select": "*"}) or [None])[0]
            if not place:
                raise RuntimeError("Lieu introuvable")
            prompt = DETAILS_BRIEF.format(
                lang=lang_line(req.get("lang", "fr")),
                name=place["name"],
                city=place.get("city") or "",
                country=place.get("country") or "",
                notes=(place.get("notes") or "")[:1500],
            )
            data = claude_json(prompt, PlaceDetails, cwd=tmp, tools=["WebSearch", "WebFetch"], timeout=1200)
            images = gather_images(
                data.get("images", []), data.get("name") or place["name"], place.get("city") or "", place["id"],
                commons=data.get("family") in ("culture", "nature", "market"),
            )
            data["images"] = images
            patch = {"details": data}
            # Photos verifiees du lieu d'abord ; les images de la video (souvent
            # du texte, des visages, une miniature) passent apres.
            frames = [u for u in (place.get("gallery") or []) if FRAMES_BUCKET in u]
            gallery = images + [u for u in frames if u not in images]
            patch["gallery"] = gallery[:10]
            if gallery:
                patch["image_url"] = gallery[0]
            lat, lng = data.get("lat"), data.get("lng")
            if (lat is None or lng is None) and data.get("address"):
                hit = geocode_osm(f"{data['address']}, {place.get('country') or ''}")
                if hit:
                    lat, lng = hit
                    data["lat"], data["lng"] = lat, lng
            if req.get("preview"):
                data["gps_exact"] = lat is not None and lng is not None
                update_ai_job(job["id"], status="ready", result=data, error=None)
                log(f"  apercu pret : {data['name']} ({len(images)} images)")
                return
            if lat is not None and lng is not None:
                patch.update({"lat": lat, "lng": lng})
                patch["details"] = {**data, "gps_exact": True}
            # Le vrai nom trouve remplace un nom vague ou approximatif
            if data.get("name") and data["name"].strip().lower() != place["name"].strip().lower():
                patch["name"] = data["name"][:120]
            if "Position approximative" in (place.get("notes") or "") and lat is not None:
                patch["notes"] = place["notes"].replace(
                    "Position approximative (centre de la ville) : à préciser.",
                    f"Position corrigée : {data.get('address') or data['name']}.",
                )
            progress(98, "save:", force=True)
            sb("PATCH", "places", params={"id": f"eq.{place['id']}"}, body=patch, prefer="return=minimal")
            update_ai_job(job["id"], status="ready", result={"ok": True, "name": patch.get("name") or place["name"], "images": len(images)}, error=None)
            log(f"  fiche du lieu prete : {data['name']} ({len(images)} images)")
            return
        if job["kind"] == "stop_places":
            prompt = SIGHTS_BRIEF.format(
                lang=lang_line(req.get("lang", "fr")),
                stop=req.get("stop", ""),
                country=req.get("country", ""),
                arrive=req.get("arrive_date") or "?",
                leave=req.get("leave_date") or "?",
                existing=", ".join(req.get("existing") or []) or "rien",
                prefs=req.get("prefs") or "aucune en particulier",
            )
            data = claude_json(prompt, Sights, cwd=tmp, tools=["WebSearch", "WebFetch"], timeout=1200)
            added = insert_sights(job, req, data["places"])
            update_ai_job(job["id"], status="ready", result={**data, "added": added}, error=None)
            log(f"  {added} choses a voir ajoutees pour {req.get('stop')}")
            return
        if job["kind"] == "country_guide":
            prompt = COUNTRY_BRIEF.format(
                lang=lang_line(req.get("lang", "fr")),
                country=req.get("country", ""),
                passport=req.get("passport") or "non precise (donne les cas UE, Suisse, Royaume-Uni)",
                start=req.get("start_date") or "?",
                end=req.get("end_date") or "?",
                stops=", ".join(req.get("stops") or []) or "aucune pour l'instant",
                today=req.get("today") or date.today().isoformat(),
            )
            data = claude_json(prompt, Guide, cwd=tmp, tools=["WebSearch", "WebFetch"], timeout=1200)
            update_ai_job(job["id"], status="ready", result=data, error=None)
            log(f"  fiche pays prete : {data['country']}")
            return
        if job["kind"] == "gap_search":
            data = job_gap_search(job, req, tmp)
            update_ai_job(job["id"], status="ready", result=data, error=None)
            log(f"  trou ({(req.get('gap') or {}).get('type')}) : {len(data['options'])} options")
            return
        if job["kind"] == "emergency":
            data = job_emergency(job, req, tmp)
            update_ai_job(job["id"], status="ready", result=data, error=None)
            log(f"  urgences et ambassades prets : {data['added']} pour {data['country']}")
            return
        if job["kind"] == "vaccines":
            data = job_vaccines(job, req, tmp)
            update_ai_job(job["id"], status="ready", result=data, error=None)
            log(f"  vaccins prets : {data['added']} pour {data['country']}")
            return
        if job["kind"] == "receipt_scan":
            data = job_receipt_scan(req, tmp)
            redact_receipt_image(job["id"], req)
            update_ai_job(job["id"], status="ready", result=data, error=None)
            log(f"  recu lu : {data.get('merchant') or '?'}")
            return
        extra = {"schedule_place": job_schedule_place, "arrange_trip": job_arrange_trip, "day_plan": job_day_plan, "chat": job_chat}
        if job["kind"] in extra:
            data = extra[job["kind"]](job, req, tmp)
            update_ai_job(job["id"], status="ready", result=data, error=None)
            log(f"  {job['kind']} pret")
            return
        if job["kind"] != "itinerary":
            raise RuntimeError(f"Type de demande inconnu : {job['kind']}")
        lines = [
            f"Date du jour : {req.get('today') or date.today().isoformat()}",
            f"Debut du voyage : {req.get('start_date') or 'non fixe'}",
            f"Fin du voyage : {req.get('end_date') or 'non fixee'}",
            f"Voyageurs : {req.get('travellers', 2)}",
            f"Budget : {req.get('budget', 'moyen')}",
            f"Rythme : {req.get('pace', 'equilibre')}",
        ]
        existing = req.get("existing") or []
        if existing:
            lines.append("Etapes deja enregistrees (a respecter, propose seulement ce qui manque autour) :")
            lines += [f"- {s['name']} : {s.get('arrive_date') or '?'} -> {s.get('leave_date') or '?'}" for s in existing]
        lines += ["", "Ce que les voyageurs ont ecrit :", '"""', req.get("raw", ""), '"""']
        prompt = ITINERARY_BRIEF.format(lang=lang_line(req.get("lang", "fr")), request="\n".join(lines))
        data = claude_json(prompt, Itinerary, cwd=tmp, tools=["WebSearch", "WebFetch"], timeout=1200)
        update_ai_job(job["id"], status="ready", result=data, error=None)
        log(f"  itineraire pret : {len(data['stops'])} etapes, {len(data['todos'])} a faire")
    except ProviderPausedError as err:
        update_ai_job(job["id"], status="pending", progress=0, step=None, error=None)
        log(f"  en pause : {err}")
    except Exception as err:
        traceback.print_exc()
        if job["kind"] == "receipt_scan":
            redact_receipt_image(job["id"], req)
        update_ai_job(job["id"], status="error", error=str(err)[:300])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# --------------------------------------------------------------------------
# Photos : copie chez nous (bucket public) pour qu'elles ne disparaissent
# jamais, et recherche de secours sur Wikimedia Commons.
# --------------------------------------------------------------------------

def rehost_image(url: str, key: str, n: int) -> str | None:
    """Telecharge une image, la reduit (1280 px) et la range dans idea-frames."""
    tmp = Path(tempfile.mkdtemp(prefix="bubu-img-"))
    try:
        # Wikimedia exige un identifiant d'application, les autres sites un navigateur
        ua = "BuBuTravel/1.0 (https://bubu-travel.vercel.app)" if "wikimedia.org" in url else UA
        r = requests.get(url, headers={"User-Agent": ua, "Referer": url}, timeout=25)
        if r.status_code >= 400 or not r.headers.get("content-type", "").startswith("image/") or len(r.content) < 15000:
            return None
        src = tmp / "in"
        src.write_bytes(r.content)
        out = tmp / "out.jpg"
        run(["ffmpeg", "-y", "-i", str(src), "-vf", "scale='min(1280,iw)':-2", "-frames:v", "1", "-q:v", "4", str(out)])
        if not out.exists() or out.stat().st_size < 8000:
            return None
        path = f"places/{key}/{n}-{uuid.uuid4().hex[:8]}.jpg"
        res = requests.post(
            f"{SB_URL}/storage/v1/object/{FRAMES_BUCKET}/{path}",
            headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}", "Content-Type": "image/jpeg", "x-upsert": "true"},
            data=out.read_bytes(),
            timeout=60,
        )
        return f"{SB_URL}/storage/v1/object/public/{FRAMES_BUCKET}/{path}" if res.status_code < 300 else None
    except Exception:
        return None
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def commons_images(query: str, limit: int = 6) -> list[str]:
    """Photos libres de droits du lieu sur Wikimedia Commons."""
    try:
        r = requests.get(
            "https://commons.wikimedia.org/w/api.php",
            params={
                "action": "query", "format": "json", "generator": "search", "gsrsearch": query,
                "gsrnamespace": 6, "gsrlimit": limit * 2, "prop": "imageinfo", "iiprop": "url|mime", "iiurlwidth": 1280,
            },
            headers={"User-Agent": "BuBuTravel/1.0 (https://bubu-travel.vercel.app)"},
            timeout=20,
        )
        pages = (r.json().get("query") or {}).get("pages") or {}
        out = []
        for p in sorted(pages.values(), key=lambda x: x.get("index", 99)):
            info = (p.get("imageinfo") or [{}])[0]
            if info.get("mime") in ("image/jpeg", "image/png", "image/webp"):
                out.append(info.get("thumburl") or info.get("url"))
        return [u for u in out if u][:limit]
    except Exception:
        return []


def gather_images(found: list[str], name: str, city: str, key: str, want: int = 5, commons: bool = True) -> list[str]:
    """Images verifiees et copiees chez nous ; complete par Commons s'il en manque."""
    urls = [u for u in found if isinstance(u, str) and u.startswith("http")]
    # Commons seulement pour les lieux connus (temples, nature, marches) : pour
    # un petit restaurant, la recherche ramenerait des photos d'autre chose
    if commons and len(urls) < want:
        for q in [f"{name} {city}".strip(), name]:
            urls += [u for u in commons_images(q) if u not in urls]
            if len(urls) >= want + 2:
                break
    kept: list[str] = []
    for i, u in enumerate(urls[:14]):
        if len(kept) >= 8:
            break
        progress(82 + 14 * i / max(1, min(len(urls), 14)), f"images:{len(kept)}")
        hosted = rehost_image(u, key, len(kept))
        if hosted:
            kept.append(hosted)
    return kept


# --------------------------------------------------------------------------
# Le voyage en texte, pour donner tout le contexte a Claude
# --------------------------------------------------------------------------

def trip_snapshot(trip_id: str, *, max_places: int = 220) -> tuple[str, dict, list[dict], list[dict]]:
    trip = (sb("GET", "trips", params={"id": f"eq.{trip_id}", "select": "*"}) or [{}])[0]
    stops = sb("GET", "trip_stops", params={"trip_id": f"eq.{trip_id}", "select": "*", "order": "arrive_date.asc.nullslast,position.asc"}) or []
    places = sb("GET", "places", params={"trip_id": f"eq.{trip_id}", "select": "*", "order": "created_at.asc"}) or []
    lines = [
        f"Voyage : {trip.get('title', '')} du {trip.get('start_date') or '?'} au {trip.get('end_date') or '?'}",
        "",
        "Etapes (ou l'on dort) :",
    ]
    for s in stops:
        stays = ", ".join(h.get("stay", "") for h in (s.get("hosts") or []) if h.get("stay")) or (s.get("stay_name") or "")
        lines.append(f"- {s['name']} ({s.get('country') or ''}) du {s.get('arrive_date') or '?'} au {s.get('leave_date') or '?'}" + (f", logement : {stays}" if stays else ""))
    lines += ["", "Lieux du voyage (id | nom | ville | latitude,longitude | statut | jour prevu | heure | duree min | type) :"]
    for p in places[:max_places]:
        d = p.get("details") or {}
        lines.append(
            " | ".join(
                str(x)
                for x in [
                    p["id"], p["name"], p.get("city") or "", f"{p['lat']:.4f},{p['lng']:.4f}", "fait" if p.get("status") == "visited" else "a faire",
                    p.get("visit_date") or "-", p.get("plan_time") or "-", p.get("plan_minutes") or "-",
                    (d.get("kind") or "")[:30],
                ]
            )
        )
    return "\n".join(lines), trip, stops, places


def is_stay_place(p: dict) -> bool:
    text = f"{p.get('name', '')} {(p.get('details') or {}).get('kind', '')}"
    return bool(re.search(r"h[oô]tel|h[ée]bergement|airbnb|resort|hostel", text, re.I)) and not re.search(r"buffet|brunch|bar|caf[ée]|restaurant", p.get("name", ""), re.I)


# --------------------------------------------------------------------------
# Nouvelles demandes : date proposee, tout mettre en place, plan du jour,
# assistant prive (conversation avec photos).
# --------------------------------------------------------------------------

class Slot(BaseModel):
    date: str = Field(description="AAAA-MM-JJ, un jour du voyage ou l'on est dans la bonne ville")
    time: str = Field(description="HH:MM, heure de debut conseillee")
    minutes: int = Field(description="Duree a prevoir en minutes")
    reason: str = Field(description="Pourquoi ce jour et cette heure, une phrase")


class ReceiptScan(BaseModel):
    merchant: str = Field(description="Nom du commerce, chaine vide si illisible")
    amount: float | None = Field(description="Total effectivement paye, null si illisible")
    currency: str = Field(description="Code ISO a trois lettres, EUR par defaut si inconnu")
    date: str = Field(description="Date AAAA-MM-JJ, chaine vide si illisible")
    category: str = Field(description="Categorie courte : restaurant, transport, logement, courses, activite ou autre")
    notes: str = Field(description="Une precision utile tres courte, chaine vide sinon")


def job_receipt_scan(req: dict, tmp: Path) -> dict:
    raw = str(req.get("image") or "")
    match = re.fullmatch(r"data:image/[a-zA-Z0-9.+-]+;base64,(.+)", raw, re.S)
    if not match:
        raise RuntimeError("Image du recu absente ou invalide")
    try:
        image = base64.b64decode(match.group(1), validate=True)
    except Exception as err:
        raise RuntimeError("Image du recu illisible") from err
    if len(image) > 5 * 1024 * 1024:
        raise RuntimeError("Image du recu trop volumineuse")
    path = tmp / "receipt.jpg"
    path.write_bytes(image)
    prompt = f"""Examine attentivement l'image du recu jointe (fichier local : {path}). Si elle n'est pas jointe, lis le fichier avec Read.
Extrais uniquement ce qui est visible. Le montant est le TOTAL effectivement paye, pas un sous-total.
N'invente rien si une information est illisible. {lang_line(req.get('lang', 'fr'))}
Pour category, utilise un mot court parmi restaurant, transport, logement, courses, activite, shopping, sante, autre.
"""
    return claude_json(prompt, ReceiptScan, cwd=tmp, tools=["Read"], timeout=300, span=(10, 90), codex_images=[path])


class Assignment(BaseModel):
    place_id: str
    date: str = Field(description="AAAA-MM-JJ")
    time: str = Field(description="HH:MM")
    minutes: int
    reason: str = Field(description="Une phrase courte")


class Skipped(BaseModel):
    place_id: str
    reason: str


class TripArrangement(BaseModel):
    summary: str = Field(description="Ce qui a ete organise, trois phrases maximum")
    assignments: list[Assignment]
    skipped: list[Skipped] = Field(description="Lieux non places (ville sans etape datee, ferme a ces dates...) et pourquoi")


class DayItem(BaseModel):
    place_id: str = Field(description="id d'un lieu existant, ou chaine vide pour une nouvelle activite")
    name: str = Field(description="Nom court de l'activite (40 caracteres max)")
    time: str = Field(description="HH:MM")
    minutes: int
    note: str = Field(description="Conseil ou precision courte, chaine vide sinon")
    lat: float | None = Field(description="Pour une nouvelle activite : latitude si connue, sinon null")
    lng: float | None


class DayPlan(BaseModel):
    summary: str = Field(description="La journee en deux phrases")
    items: list[DayItem] = Field(description="Toute la journee, dans l'ordre")


class ChatAction(BaseModel):
    type: Literal["add_place", "schedule", "add_todo", "add_stay", "add_stop"] = Field(
        description="add_place : ajouter un lieu a visiter ; schedule : placer un lieu existant un jour ; add_todo : ajouter une chose a faire"
    )
    label: str = Field(description="Texte du bouton, court, ex. « Ajouter le marché flottant le 15/12 »")
    place_id: str = Field(description="Pour schedule : id du lieu existant ; sinon chaine vide")
    name: str = Field(description="Pour add_place : nom court du lieu ; pour add_todo : la tache")
    city: str
    country: str
    lat: float | None
    lng: float | None
    date: str = Field(description="AAAA-MM-JJ ou chaine vide")
    time: str = Field(description="HH:MM ou chaine vide")
    minutes: int | None
    notes: str
    stay_address: str = Field(description="Pour add_stay : adresse de l'hebergement, sinon chaine vide")
    stay_url: str = Field(description="Pour add_stay : URL source de l'hebergement, sinon chaine vide")
    leave_date: str = Field(description="Pour add_stop : date de depart AAAA-MM-JJ, sinon chaine vide")


class ChatReply(BaseModel):
    reply: str = Field(description="La reponse, naturelle et chaleureuse, comme dans une vraie conversation. Pas de pave : paragraphes courts")
    questions: list[str] = Field(description="Questions a poser s'il manque une information pour bien faire, sinon liste vide")
    actions: list[ChatAction] = Field(description="Propositions concretes a appliquer d'un toucher (0 a 6)")


SLOT_BRIEF = """Propose LE meilleur moment du voyage pour faire cette activite.
Regles : un jour ou les voyageurs sont dans la bonne ville (voir les etapes), en evitant les journees
deja chargees et les chevauchements avec ce qui est deja prevu ; tiens compte des horaires d'ouverture,
du meilleur moment de la journee (lumiere, chaleur, affluence) et du jour de la semaine.
{lang}

Activite : {name} ({city}) id {place_id}
Infos connues : {info}

{snapshot}
"""

ARRANGE_BRIEF = """Organise tout le voyage : place chaque lieu « a faire » NON date dans un jour et a une heure.
Regles :
- Un lieu ne peut etre place que pendant les jours ou les voyageurs dorment dans cette ville
  (voir les etapes). Une ville sans etape datee : laisse le lieu dans « skipped » avec la raison.
- Journees equilibrees : 4 a 7 h d'activites, pas plus de 9 h, regroupe ce qui est proche,
  temples et visites le matin, couchers de soleil et bars le soir, repas aux heures des repas.
- Ne touche jamais aux lieux deja dates ; evite les chevauchements avec eux.
- Ignore les hebergements (hotels, Airbnb) : ce ne sont pas des activites.
- Heures au format HH:MM, duree realiste en minutes.
{lang}

{snapshot}
"""

DAY_BRIEF = """Refais proprement le plan de cette journee selon la demande des voyageurs.
Garde les lieux existants (meme id) sauf si la demande dit de les enlever ; tu peux en ajouter
(place_id vide) si la demande le suggere ou si la journee a un vrai trou.
DISTANCES : calcule-les avec les coordonnees. Enchaine les activites de proche en proche (le
suivant est dans le meme quartier ou a moins de 3 km du precedent, sinon prevois un vrai trajet
dans l'horaire), sans aller-retour. Toute activite ajoutee doit etre un VRAI lieu precis et
nomme (pas « boire un cafe »), situe dans la ville de l'etape et PROCHE de l'activite qui la
precede ou la suit, avec ses coordonnees exactes verifiees sur le web. Horaires realistes avec
trajets, pauses et repas ; respecte les horaires d'ouverture.
Plage horaire autorisee : {start_time} a {end_time}. Chaque activite doit commencer a partir de
{start_time} et se terminer au plus tard a {end_time}. Ne propose aucun horaire hors de cette plage.
Les lieux enregistres ne sont pas un catalogue ferme : utilise-les en priorite, mais cherche aussi
sur le web des activites interessantes dans cette ville qui ne sont pas encore dans les envies.
Ajoute au plus 2 nouvelles activites pertinentes (place_id vide) quand le temps disponible le permet;
ne force pas de remplissage inutile. Ne duplique ni une activite existante ni un lieu du voyage.
{lang}

Jour : {day} a {city}
Demande des voyageurs : {instruction}

Plan actuel de la journee :
{current}

{snapshot}
"""

CHAT_BRIEF = """Tu es l'assistant prive de voyage de {who}, pendant la preparation et le voyage lui-meme.
Reponds comme dans une vraie conversation, en tutoyant, avec chaleur et precision. Tu connais tout le
voyage (ci-dessous). Si des photos sont jointes (fichiers image dans ce dossier : {images}), regarde-les
TOUTES avec l'outil Read avant de repondre : elles montrent ce dont on parle (lieu, menu, billet, panneau...).
Cherche sur le web (WebSearch, WebFetch) quand il faut des infos fiables et a jour. Pour les dates du voyage,
verifie jours feries, horaires et jours d'ouverture, fermetures saisonnieres et periodes de forte/faible affluence ;
cite des sources et explicite les incertitudes. Les disponibilites d'hebergement ne sont jamais garanties.
S'il manque une information pour bien repondre (quel jour, quelle ville, budget...), pose la question
dans « questions ». Propose des actions concretes (ajouter un lieu, le placer un jour, une chose a faire)
seulement quand c'est utile ; les id de lieux viennent de la liste ci-dessous. Tu peux aussi proposer add_stay
pour renseigner un etablissement identifie sur le web sur une etape existante, ou add_stop pour ajouter une ville
souhaitee au parcours avec des dates qui ne chevauchent aucune etape existante ; donne ville, pays, date d'arrivee
et de depart. N'ajoute une ville que si les dates restent dans le voyage et sont coherentes avec les etapes.
Pour add_stay, donne son adresse et URL,
mais ne reserve et ne paie jamais : les dates, prix et disponibilites doivent etre verifies par le voyageur.
{lang}

{snapshot}

--- Conversation jusqu'ici ---
{history}

--- Nouveau message ---
{message}
"""


def place_info_text(p: dict) -> str:
    d = p.get("details") or {}
    bits = [d.get("summary"), d.get("hours") and f"Horaires : {d['hours']}", d.get("best_time") and f"Meilleur moment : {d['best_time']}",
            d.get("duration") and f"Duree : {d['duration']}", (p.get("notes") or "")[:400]]
    return " / ".join(b for b in bits if b) or "rien de plus"


def job_schedule_place(job: dict, req: dict, tmp: Path) -> dict:
    place = (sb("GET", "places", params={"id": f"eq.{req.get('place_id')}", "select": "*"}) or [None])[0]
    if not place:
        raise RuntimeError("Lieu introuvable")
    snapshot, *_ = trip_snapshot(place["trip_id"])
    prompt = SLOT_BRIEF.format(lang=lang_line(req.get("lang", "fr")), name=place["name"], city=place.get("city") or "",
                               place_id=place["id"], info=place_info_text(place), snapshot=snapshot)
    return claude_json(prompt, Slot, cwd=tmp, tools=["WebSearch", "WebFetch"], timeout=900)


def job_arrange_trip(job: dict, req: dict, tmp: Path) -> dict:
    trip_id = job["trip_id"]
    snapshot, _, stops, places = trip_snapshot(trip_id)
    prompt = ARRANGE_BRIEF.format(lang=lang_line(req.get("lang", "fr")), snapshot=snapshot)
    data = claude_json(prompt, TripArrangement, cwd=tmp, tools=["WebSearch", "WebFetch"], timeout=1800)
    by_id = {p["id"]: p for p in places}
    undo, applied = [], 0
    for a in data["assignments"]:
        p = by_id.get(a["place_id"])
        if not p or p.get("visit_date") or p.get("status") == "visited" or is_stay_place(p):
            continue
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", a["date"]) or not re.match(r"^\d{2}:\d{2}$", a["time"]):
            continue
        undo.append({"id": p["id"], "visit_date": p.get("visit_date"), "plan_time": p.get("plan_time"), "plan_minutes": p.get("plan_minutes")})
        sb("PATCH", "places", params={"id": f"eq.{p['id']}"},
           body={"visit_date": a["date"], "plan_time": a["time"], "plan_minutes": max(15, min(720, int(a["minutes"])))},
           prefer="return=minimal")
        applied += 1
    return {**data, "applied": applied, "undo": undo}


def job_day_plan(job: dict, req: dict, tmp: Path) -> dict:
    trip_id, day = job["trip_id"], req.get("day")
    start_time = req.get("start_time") if re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", str(req.get("start_time", ""))) else "09:00"
    end_time = req.get("end_time") if re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", str(req.get("end_time", ""))) else "20:00"
    start_minute = int(start_time[:2]) * 60 + int(start_time[3:])
    end_minute = int(end_time[:2]) * 60 + int(end_time[3:])
    if end_minute <= start_minute:
        raise RuntimeError("L'heure de fin doit etre apres l'heure de debut.")
    snapshot, _, stops, places = trip_snapshot(trip_id)
    today = [p for p in places if p.get("visit_date") == day and not is_stay_place(p)]
    today.sort(key=lambda p: p.get("plan_time") or "99")
    current = "\n".join(f"- {p.get('plan_time') or '?'} {p['name']} (id {p['id']}, {p.get('plan_minutes') or '?'} min)" for p in today) or "(vide)"
    stop = next((s for s in stops if s.get("arrive_date") and s["arrive_date"] <= day <= (s.get("leave_date") or s["arrive_date"])), None)
    prompt = DAY_BRIEF.format(lang=lang_line(req.get("lang", "fr")), day=day, city=(stop or {}).get("name", "?"),
                              start_time=start_time, end_time=end_time,
                              instruction=req.get("instruction") or "Optimise la journee", current=current, snapshot=snapshot)
    data = claude_json(prompt, DayPlan, cwd=tmp, tools=["WebSearch", "WebFetch"], timeout=1200)
    by_id = {p["id"]: p for p in places}
    undo_by_id = {p["id"]: {"id": p["id"], "visit_date": p.get("visit_date"), "plan_time": p.get("plan_time"), "plan_minutes": p.get("plan_minutes")} for p in today}
    kept, created = set(), []
    known_names = {str(p.get("name") or "").strip().casefold() for p in places}
    selected_names = set()
    planned = []
    for it in sorted(data["items"], key=lambda item: item.get("time") or "99:99"):
        if not re.match(r"^\d{2}:\d{2}$", it["time"] or ""):
            continue
        minutes = max(15, min(720, int(it["minutes"] or 60)))
        hour, minute = map(int, it["time"].split(":"))
        start = hour * 60 + minute
        if hour > 23 or minute > 59 or start < start_minute or start + minutes > end_minute:
            continue
        if planned and start < planned[-1][0] + planned[-1][1] + DAY_PLAN_GAP:
            continue
        if it["place_id"] and it["place_id"] in by_id:
            place = by_id[it["place_id"]]
            normalized_name = str(place.get("name") or "").strip().casefold()
            if (it["place_id"] in kept or normalized_name in selected_names
                    or place.get("status") == "visited"
                    or (place.get("visit_date") and place.get("visit_date") != day)):
                continue
            undo_by_id.setdefault(it["place_id"], {"id": it["place_id"], "visit_date": place.get("visit_date"), "plan_time": place.get("plan_time"), "plan_minutes": place.get("plan_minutes")})
            kept.add(it["place_id"])
            selected_names.add(normalized_name)
            planned.append((start, minutes))
            sb("PATCH", "places", params={"id": f"eq.{it['place_id']}"},
               body={"visit_date": day, "plan_time": it["time"], "plan_minutes": minutes}, prefer="return=minimal")
        elif it["name"]:
            normalized_name = it["name"].strip().casefold()
            if not normalized_name or normalized_name in known_names or normalized_name in selected_names:
                continue
            lat, lng = it.get("lat"), it.get("lng")
            if lat is None or lng is None:
                lat, lng = (stop or {}).get("lat"), (stop or {}).get("lng")
            if lat is None or lng is None:
                continue
            row = sb("POST", "places", body={
                "user_id": job["user_id"], "trip_id": trip_id, "name": it["name"][:120], "country": (stop or {}).get("country") or "",
                "city": (stop or {}).get("name"), "lat": lat, "lng": lng, "status": "wishlist", "notes": it.get("note") or None,
                "visit_date": day, "plan_time": it["time"], "plan_minutes": minutes,
            }, prefer="return=representation")
            if row:
                created.append(row[0]["id"])
                try:
                    sb("POST", "ai_jobs", body={
                        "user_id": job["user_id"], "trip_id": trip_id, "kind": "place_info",
                        "input": {"place_id": row[0]["id"], "lang": req.get("lang", "fr")},
                    }, prefer="return=minimal")
                except Exception:
                    pass
                selected_names.add(normalized_name)
                planned.append((start, minutes))
    for p in today:
        if p["id"] not in kept:
            sb("PATCH", "places", params={"id": f"eq.{p['id']}"}, body={"visit_date": None, "plan_time": None}, prefer="return=minimal")
    return {"summary": data["summary"], "undo": list(undo_by_id.values()), "created": created}


ASSISTANT_BUCKET = "assistant"


def job_chat(job: dict, req: dict, tmp: Path) -> dict:
    msg = (sb("GET", "assistant_messages", params={"id": f"eq.{req.get('message_id')}", "select": "*"}) or [None])[0]
    if not msg:
        raise RuntimeError("Message introuvable")
    trip_id, user_id = msg["trip_id"], msg["user_id"]
    history_rows = sb("GET", "assistant_messages", params={
        "trip_id": f"eq.{trip_id}", "user_id": f"eq.{user_id}", "created_at": f"lt.{msg['created_at']}",
        "order": "created_at.desc", "limit": "24", "select": "role,content",
    }) or []
    history = "\n".join(f"{'Moi' if h['role'] == 'user' else 'Assistant'} : {h['content']}" for h in reversed(history_rows)) or "(debut de la conversation)"
    names = []
    for i, path in enumerate((msg.get("images") or [])[:20]):
        r = requests.get(f"{SB_URL}/storage/v1/object/{ASSISTANT_BUCKET}/{path}",
                         headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"}, timeout=60)
        if r.status_code < 300:
            ext = path.rsplit(".", 1)[-1].lower() if "." in path else "jpg"
            name = f"photo_{i + 1:02d}.{ext}"
            (tmp / name).write_bytes(r.content)
            names.append(name)
    prof = (sb("GET", "profiles", params={"id": f"eq.{user_id}", "select": "display_name,lang"}) or [{}])[0]
    snapshot, *_ = trip_snapshot(trip_id)
    prompt = CHAT_BRIEF.format(
        who=prof.get("display_name") or "ce voyageur", images=", ".join(names) or "aucune",
        lang=lang_line(req.get("lang") or prof.get("lang") or "fr"), snapshot=snapshot, history=history,
        message=msg.get("content") or "(photos sans texte)",
    )
    tools = ["WebSearch", "WebFetch"] + (["Read"] if names else [])
    data = claude_json(prompt, ChatReply, cwd=tmp, tools=tools, timeout=1200, codex_images=[tmp / name for name in names])
    text = data["reply"].strip()
    if data.get("questions"):
        text += "\n\n" + "\n".join(f"❓ {q}" for q in data["questions"])
    row = sb("POST", "assistant_messages", body={
        "trip_id": trip_id, "user_id": user_id, "role": "assistant", "content": text, "actions": data.get("actions") or [],
    }, prefer="return=representation")
    sb("PATCH", "assistant_messages", params={"id": f"eq.{msg['id']}"}, body={"status": "done"}, prefer="return=minimal")
    return {"message_id": row[0]["id"] if row else None}


def keep_alive(job_id: str, stop: threading.Event) -> None:
    """Une demande longue reste « en cours » : elle n'est pas reprise par un autre poste."""
    while not stop.wait(60):
        try:
            sb("PATCH", "ai_jobs", params={"id": f"eq.{job_id}", "status": "eq.processing"}, body={"updated_at": now_iso()}, prefer="return=minimal")
        except Exception:
            pass


AI_WORKERS = max(2, int(os.environ.get("AI_WORKERS", "2")))


# --------------------------------------------------------------------------
# Traduction des fiches : chaque lieu rempli recoit sa version dans l'autre
# langue (details.alt), pour que Diego (FR) et Vesna (EN) lisent chacun la leur.
# --------------------------------------------------------------------------

class PlaceTr(BaseModel):
    id: str
    name: str = Field(description="Nom traduit : on traduit la partie descriptive, JAMAIS le nom propre (enseigne, temple, lieu)")
    kind: str
    summary: str
    booking: str
    best_time: str
    hours: str
    duration: str
    price: str
    tips: list[str]


class TrBatch(BaseModel):
    items: list[PlaceTr]


def guess_lang(text: str) -> str:
    words = re.findall(r"[a-zA-Z']+", text.lower())
    en = sum(1 for w in words if w in ("the", "and", "with", "for", "of", "is", "to", "you", "in", "on", "at", "your"))
    fr = sum(1 for w in words if w in ("le", "la", "les", "des", "du", "et", "pour", "avec", "est", "une", "un", "dans", "sur", "de", "au", "aux"))
    return "en" if en > fr else "fr"


def backfill_translations(limit: int = 8) -> int:
    """Traduit un lot de fiches qui n'ont pas encore leur version dans l'autre langue."""
    CURRENT.provider = "auto"
    rows = sb("GET", "places", params={"details": "not.is.null", "select": "id,name,details", "order": "created_at.asc", "limit": "400"}) or []
    todo = [r for r in rows if isinstance(r.get("details"), dict) and not r["details"].get("alt") and (r["details"].get("summary") or r["name"])][:limit]
    if not todo:
        return 0
    src = {
        r["id"]: (r["details"].get("lang") or guess_lang(" ".join([r["name"], r["details"].get("summary", ""), " ".join(r["details"].get("tips", []))])))
        for r in todo
    }
    out = 0
    for lang_src in ("fr", "en"):
        batch = [r for r in todo if src[r["id"]] == lang_src]
        if not batch:
            continue
        dst = "en" if lang_src == "fr" else "fr"
        items = [
            {
                "id": r["id"], "name": r["name"], "kind": r["details"].get("kind", ""), "summary": r["details"].get("summary", ""),
                "booking": r["details"].get("booking", ""), "best_time": r["details"].get("best_time", ""), "hours": r["details"].get("hours", ""),
                "duration": r["details"].get("duration", ""), "price": r["details"].get("price", ""), "tips": r["details"].get("tips", []),
            }
            for r in batch
        ]
        prompt = (
            f"Traduis ces fiches de lieux de voyage du {'francais' if lang_src == 'fr' else 'anglais'} vers "
            f"{'le francais' if dst == 'fr' else 'anglais'}. Garde les noms propres (enseignes, temples, rues, plats) tels quels ; "
            "traduis le reste naturellement. Laisse vide ce qui est vide. Renvoie chaque fiche avec le meme id.\n\n"
            + json.dumps(items, ensure_ascii=False)
        )
        tmp = Path(tempfile.mkdtemp(prefix="bubu-tr-"))
        try:
            data = claude_json(prompt, TrBatch, cwd=tmp, tools=["Read"], timeout=600)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        by_id = {x["id"]: x for x in data["items"]}
        for r in batch:
            tr = by_id.get(r["id"])
            if not tr:
                continue
            alt = {k: v for k, v in tr.items() if k != "id"}
            alt["lang"] = dst
            details = {**r["details"], "lang": lang_src, "alt": alt}
            sb("PATCH", "places", params={"id": f"eq.{r['id']}"}, body={"details": details}, prefer="return=minimal")
            out += 1
    if out:
        log(f"  {out} fiche(s) traduite(s)")
    return out


def ai_worker(n: int) -> None:
    """Plusieurs demandes IA en parallele : on peut lancer plusieurs recherches a la fois."""
    while True:
        try:
            job = claim_ai_job()
            if job:
                stop = threading.Event()
                threading.Thread(target=keep_alive, args=(job["id"], stop), daemon=True).start()
                try:
                    process_ai_job(job)
                finally:
                    stop.set()
                continue
            # Rien a faire : on traduit les fiches en retard (un seul travailleur)
            if n == 1 and time.time() - getattr(ai_worker, "last_tr", 0) > 90:
                ai_worker.last_tr = time.time()
                backfill_translations()
        except Exception as err:
            log(f"Erreur (assistant {n}) : {str(err)[:200]}")
        time.sleep(POLL_SECONDS)




# --------------------------------------------------------------------------
# Vaccins : propositions par pays, a partir de sources officielles, puis
# mise dans les choses a faire (urgent si le delai est court).
# --------------------------------------------------------------------------

class VaccineItem(BaseModel):
    name: str = Field(description="Nom COURT du vaccin ou de la protection, ex. « Hépatite A », « Typhoïde », « Rage », « Encéphalite japonaise », « Dengue »")
    level: Literal["required", "recommended", "consider"] = Field(
        description="required : exigé a l'entree ; recommended : recommandé pour ce voyage ; consider : a discuter avec le médecin selon le profil et les activités"
    )
    why: str = Field(description="Pourquoi pour CE pays et CE voyage, une phrase")
    timing: str = Field(description="Quand le faire, ex. « 2 à 4 semaines avant le départ »")
    weeks_before: int = Field(description="Délai conseillé en semaines avant le départ, 0 si aucun")
    doses: str = Field(description="Nombre de doses et rappels, ex. « 2 doses espacées de 6 mois », chaine vide si inconnu")
    advice: str = Field(description="Conseil pratique court (déjà fait dans l'enfance ? rappel ?), chaine vide sinon")
    est_price: float = Field(description="Prix indicatif PAR PERSONNE en euros en Autriche, 0 si inconnu")
    sources: list[Source]


class VaccineList(BaseModel):
    summary: str = Field(description="Deux phrases : ce qu'il faut retenir pour ce pays")
    vaccines: list[VaccineItem]


VACCINES_BRIEF = """Prépare la liste des vaccins et protections de santé à envisager pour deux voyageurs adultes
qui vivent en Autriche et vont dans ce pays. Cherche sur le web (WebSearch, WebFetch) des sources
OFFICIELLES et récentes : CDC, OMS, ministère autrichien de la santé, centres de médecine des voyages,
Institut Pasteur. Indique pour chacun s'il est exigé, recommandé ou à discuter, le bon moment, le nombre
de doses et un prix indicatif en Autriche. Ajoute la prévention du paludisme et la dengue si pertinents
(niveau « consider »). Les vaccins de routine (tétanos-diphtérie-coqueluche-polio, rougeole) comptent
comme « recommended » s'ils sont à jour. Ne propose RIEN d'inventé : seulement ce que les sources disent.
Ce sont des informations générales, pas un avis médical : le médecin décide.
{lang}

Pays : {country}
Étapes dans ce pays : {stops}
Voyage : du {start} au {end}
Date du jour : {today}
"""


def job_vaccines(job: dict, req: dict, tmp: Path) -> dict:
    trip_id = job["trip_id"]
    country = (req.get("country") or "").strip()
    if not trip_id or not country:
        raise RuntimeError("Voyage ou pays manquant")
    trip = (sb("GET", "trips", params={"id": f"eq.{trip_id}", "select": "start_date,end_date"}) or [{}])[0]
    stops = sb("GET", "trip_stops", params={"trip_id": f"eq.{trip_id}", "select": "name,country,arrive_date,leave_date", "order": "arrive_date.asc"}) or []
    here = [x for x in stops if (x.get("country") or "").lower() == country.lower()]
    prompt = VACCINES_BRIEF.format(
        lang=lang_line(req.get("lang", "fr")), country=country,
        stops=", ".join(f"{x['name']} ({x.get('arrive_date') or '?'} -> {x.get('leave_date') or '?'})" for x in here) or "non précisées",
        start=trip.get("start_date") or "?", end=trip.get("end_date") or "?", today=date.today().isoformat(),
    )
    data = claude_json(prompt, VaccineList, cwd=tmp, tools=["WebSearch", "WebFetch"], timeout=1500)
    existing = sb("GET", "trip_vaccines", params={"trip_id": f"eq.{trip_id}", "country": f"eq.{country}", "select": "name"}) or []
    known = {e["name"].strip().lower() for e in existing}
    today = date.today()
    depart = None
    try:
        depart = date.fromisoformat(trip["start_date"]) if trip.get("start_date") else None
    except Exception:
        depart = None
    added = 0
    for v in data["vaccines"]:
        name = v["name"].strip()
        if not name or name.lower() in known:
            continue
        known.add(name.lower())
        todo_id = None
        if v["level"] in ("required", "recommended"):
            due = (depart - timedelta(weeks=max(0, int(v["weeks_before"])))) if depart else today + timedelta(days=14)
            if due < today:
                due = today
            urgent = v["level"] == "required" or (due - today).days <= 14
            notes = " ".join(x for x in [v["why"], v["timing"], v["doses"], "Pris en compte dans l'onglet Vaccins."] if x)
            todo = sb("POST", "trip_todos", body={
                "trip_id": trip_id, "title": f"{'⚠️ ' if urgent else ''}Vaccin : {name} ({country})",
                "notes": notes[:600], "kind": "todo", "due_at": f"{due.isoformat()}T09:00:00", "has_time": False, "country": country,
            }, prefer="return=representation")
            todo_id = todo[0]["id"] if todo else None
        sb("POST", "trip_vaccines", body={
            "trip_id": trip_id, "country": country, "name": name[:80], "level": v["level"], "why": v["why"], "timing": v["timing"],
            "doses": v["doses"], "advice": v["advice"], "est_price": v["est_price"] or None, "currency": "EUR",
            "sources": v["sources"][:4], "todo_id": todo_id,
        }, prefer="return=minimal")
        added += 1
    return {"summary": data["summary"], "added": added, "country": country}



# --------------------------------------------------------------------------
# Urgences et ambassades : numeros du pays visite et du pays de residence,
# ambassade de la nationalite de chacun dans le pays visite. Tout est range
# dans le coffre (contacts), partage entre les deux voyageurs.
# --------------------------------------------------------------------------

class CountryEmergency(BaseModel):
    country: str
    general: str = Field(description="Numéro d'urgence unique si le pays en a un (ex. 112), chaine vide sinon")
    police: str = Field(description="Numéro de la police, chiffres seuls ou avec indicatif")
    ambulance: str = Field(description="Numéro des urgences médicales / ambulance")
    fire: str = Field(description="Numéro des pompiers")
    tourist_police: str = Field(description="Numéro de la police touristique si elle existe, chaine vide sinon")
    notes: str = Field(description="Une phrase utile (langue parlée au téléphone, numéro gratuit depuis un portable...), chaine vide sinon")
    sources: list[Source]


class Embassy(BaseModel):
    name: str = Field(description="Nom exact, ex. « Ambassade de Belgique à Bangkok »")
    city: str
    address: str = Field(description="Adresse postale complète de la chancellerie")
    phone: str = Field(description="Téléphone principal avec indicatif international, ex. +66 2 ...")
    emergency_phone: str = Field(description="Numéro d'urgence consulaire 24 h si il existe, chaine vide sinon")
    email: str
    website: str
    hours: str = Field(description="Horaires d'ouverture au public, chaine vide si inconnus")
    notes: str = Field(description="Une phrase utile : rendez-vous obligatoire, consulat honoraire plus proche, etc.")
    sources: list[Source]


EMERGENCY_BRIEF = """Donne les numéros d'urgence OFFICIELS de ce pays, vérifiés sur le web (WebSearch, WebFetch :
site du gouvernement, ministère des affaires étrangères, OMS). Numéros à composer depuis un téléphone
portable local ou étranger. N'invente rien : laisse vide ce qui n'existe pas.
{lang}

Pays : {country}
"""

EMBASSY_BRIEF = """Trouve l'ambassade (ou à défaut le consulat) de {nationality} dans ce pays : {country}.
Adresse complète, téléphone avec indicatif international, numéro d'urgence consulaire 24 h, email,
site officiel et horaires. Vérifie sur le site officiel du ministère des affaires étrangères de {nationality}
(WebSearch, WebFetch). Si plusieurs villes ont une représentation, donne celle de la capitale et signale
les autres dans les notes. N'invente rien.
{lang}
"""


def vault_put(user_id: str, title: str, **fields) -> bool:
    """Ajoute un element de coffre (partage) s'il n'existe pas deja. Renvoie True si cree."""
    found = sb("GET", "vault_items", params={"user_id": f"eq.{user_id}", "title": f"eq.{title}", "select": "id"}) or []
    if found:
        return False
    row = {"user_id": user_id, "kind": "contact", "title": title[:120], "shared": True, "files": [], "position": -10}
    row.update({k: v for k, v in fields.items() if v})
    sb("POST", "vault_items", body=row, prefer="return=minimal")
    return True


def emergency_rows(user_id: str, country: str, e: dict, holder: str) -> int:
    n = 0
    items = [
        ("Urgences", e["general"], ""), ("Police", e["police"], ""), ("Ambulance", e["ambulance"], ""),
        ("Pompiers", e["fire"], ""), ("Police touristique", e["tourist_police"], ""),
    ]
    for label, number, _ in items:
        digits = re.sub(r"[^\d+]", "", number or "")
        if not digits:
            continue
        if vault_put(user_id, f"🚨 {label} · {country}", holder=holder, phone=digits, number=number.strip()[:40], notes=e.get("notes") or None):
            n += 1
    return n


def job_emergency(job: dict, req: dict, tmp: Path) -> dict:
    trip_id = job["trip_id"]
    country = (req.get("country") or "").strip()
    if not trip_id or not country:
        raise RuntimeError("Voyage ou pays manquant")
    lang = req.get("lang", "fr")
    trip = (sb("GET", "trips", params={"id": f"eq.{trip_id}", "select": "user_id"}) or [{}])[0]
    ids = [trip.get("user_id")] + [m["user_id"] for m in (sb("GET", "trip_members", params={"trip_id": f"eq.{trip_id}", "select": "user_id"}) or [])]
    people = sb("GET", "profiles", params={"id": f"in.({','.join(i for i in ids if i)})", "select": "id,display_name,nationality,residence_country"}) or []
    added = 0

    # 1. Urgences du pays visite
    dest = claude_json(EMERGENCY_BRIEF.format(lang=lang_line(lang), country=country), CountryEmergency, cwd=tmp, tools=["WebSearch", "WebFetch"], timeout=900, span=(5, 40))
    added += emergency_rows(job["user_id"], country, dest, "Pays du voyage")

    # 2. Urgences du pays de residence (une fois par pays)
    for res in sorted({(p.get("residence_country") or "").strip() for p in people if p.get("residence_country")}):
        if res.lower() == country.lower():
            continue
        done = sb("GET", "vault_items", params={"user_id": f"eq.{job['user_id']}", "title": f"like.*· {res}", "select": "id", "limit": "1"}) or []
        if done:
            continue
        info = claude_json(EMERGENCY_BRIEF.format(lang=lang_line(lang), country=res), CountryEmergency, cwd=tmp, tools=["WebSearch", "WebFetch"], timeout=900, span=(40, 60))
        added += emergency_rows(job["user_id"], res, info, "Pays de résidence")

    # 3. Ambassade de la nationalite de chacun, dans le pays visite
    for nat in sorted({(p.get("nationality") or "").strip() for p in people if p.get("nationality")}):
        if nat.lower() == country.lower():
            continue
        owners = [p for p in people if (p.get("nationality") or "").strip() == nat]
        particle = "d'" if nat[:1].lower() in "aeiouyéèêâîôûh" else "de "
        title = f"🏛️ Ambassade {particle}{nat} · {country}"
        if all(sb("GET", "vault_items", params={"user_id": f"eq.{o['id']}", "title": f"eq.{title}", "select": "id"}) for o in owners):
            continue
        emb = claude_json(EMBASSY_BRIEF.format(lang=lang_line(lang), nationality=nat, country=country), Embassy, cwd=tmp, tools=["WebSearch", "WebFetch"], timeout=900, span=(60, 92))
        notes = "\n".join(x for x in [
            f"📍 {emb['address']}" if emb["address"] else "", f"🕘 {emb['hours']}" if emb["hours"] else "",
            f"🆘 Urgence consulaire 24 h : {emb['emergency_phone']}" if emb["emergency_phone"] else "", emb["notes"],
        ] if x)
        for o in owners:
            if vault_put(o["id"], title, holder=o.get("display_name") or nat, phone=re.sub(r"[^\d+]", "", emb["phone"] or ""), number=(emb["phone"] or "")[:40],
                         email=emb["email"] or None, url=emb["website"] or None, notes=notes or None):
                added += 1
    return {"country": country, "added": added}



# --------------------------------------------------------------------------
# Idees -> carte : une idee analysee devient un lieu du voyage sur la carte
# puis disparait de la liste des idees (archivee).
# --------------------------------------------------------------------------

IDEA_SKIPPED: set[str] = set()


def auto_place_idea(idea: dict) -> str:
    """Pose l'idee sur la carte, puis l'archive. Renvoie placed, no-coords ou skip."""
    a = idea.get("analysis") or {}
    if not a or idea.get("status") != "ready":
        return "skip"
    trip_id = idea.get("trip_id")
    code = shortcode(idea["url"])
    params = {"notes": f"ilike.*{code}*", "select": "id", "limit": "1"}
    params["trip_id" if trip_id else "user_id"] = f"eq.{trip_id or idea['user_id']}"
    found = sb("GET", "places", params=params) or []
    place_id = found[0]["id"] if found else idea.get("place_id")

    pl = a.get("place") or {}
    name = (a.get("name") or pl.get("name") or "").strip()[:120]
    city = (pl.get("city") or "").strip()
    if not place_id and name:
        # Meme nom et meme ville dans le voyage : c'est le meme lieu
        same = sb("GET", "places", params={
            "name": f"ilike.{name}", "select": "id,city", **({"trip_id": f"eq.{trip_id}"} if trip_id else {"user_id": f"eq.{idea['user_id']}"}),
        }) or []
        for x in same:
            if (x.get("city") or "").strip().lower() == city.lower():
                place_id = x["id"]
                break
    if not place_id:
        if not name:
            return "no-coords"
        lat, lng = pl.get("lat"), pl.get("lng")
        if lat is None or lng is None:
            for q in [pl.get("address"), f"{name}, {city}", city]:
                if q and q.strip(", "):
                    hit = geocode_osm(f"{q}, {pl.get('country', '')}".strip(", "))
                    if hit:
                        lat, lng = hit
                        break
        if lat is None or lng is None:
            return "no-coords"
        frames = [u for u in (idea.get("frames") or []) if isinstance(u, str)]
        row = {
            "user_id": idea["user_id"], "trip_id": trip_id, "name": name, "country": pl.get("country") or "", "city": city or None,
            "lat": lat, "lng": lng, "status": "wishlist",
            "notes": "\n\n".join(x for x in [a.get("summary"), f"Réserver : {a['booking']}" if a.get("booking") else "", a.get("booking_url"), idea["url"]] if x),
            "details": details_from_analysis(a),
        }
        if frames:
            row["gallery"] = frames[:10]
            row["image_url"] = frames[0]
        created = sb("POST", "places", body=row, prefer="return=representation")
        place_id = created[0]["id"] if created else None
        if not place_id:
            return "no-coords"
    sb("PATCH", "link_ideas", params={"id": f"eq.{idea['id']}"}, body={"place_id": place_id, "status": "archived", "updated_at": now_iso()}, prefer="return=minimal")
    return "placed"


def backfill_ideas(limit: int = 25) -> int:
    """Pose sur la carte les idees deja analysees, par lots. Renvoie le nombre traite."""
    rows = sb("GET", "link_ideas", params={"status": "eq.ready", "select": "*", "order": "created_at.asc", "limit": "300"}) or []
    todo = [r for r in rows if r["id"] not in IDEA_SKIPPED][:limit]
    placed = 0
    for idea in todo:
        try:
            res = auto_place_idea(idea)
        except Exception as err:
            log(f"  idee {idea['id'][:8]} ignoree : {str(err)[:120]}")
            res = "skip"
        if res == "placed":
            placed += 1
        else:
            IDEA_SKIPPED.add(idea["id"])
    if todo:
        log(f"  idees : {placed} posees sur la carte, {len(todo) - placed} laissees dans la liste")
    return len(todo)


def ideas_loop() -> None:
    while True:
        try:
            n = backfill_ideas()
            time.sleep(2 if n else 180)
        except Exception as err:
            log(f"Erreur (idees) : {str(err)[:150]}")
            time.sleep(60)



# --------------------------------------------------------------------------
# Trous du voyage : hebergement, transport, journee libre, jours sans etape.
# L'IA cherche de VRAIES options pertinentes ; l'app applique celle choisie.
# --------------------------------------------------------------------------

class GapOption(BaseModel):
    title: str = Field(description="Nom exact : de l'hébergement, de la compagnie + trajet, de l'activité ou de la ville-étape")
    kind: Literal["stay", "transport", "activity", "stop"]
    area: str = Field(description="Quartier ou ville pour un lieu ; « A → B » pour un trajet")
    why: str = Field(description="POURQUOI cette option correspond au budget, aux besoins et au voyage (proximité des lieux déjà prévus, horaires...), une ou deux phrases concretes")
    price_text: str = Field(description="Prix lisible avec devise et unité, ex. « ~45 €/nuit », « ~60 €/pers. »")
    price_eur: float = Field(description="Prix indicatif en euros (par nuit pour un hébergement, par personne sinon), 0 si inconnu")
    detail: str = Field(description="Horaires, durée, compagnie, équipements, note des voyageurs... en une ligne")
    url: str = Field(description="Lien REEL de réservation ou de la page officielle, chaine vide si tu n'en as pas de sûr")
    address: str = Field(description="Adresse complète pour un lieu, chaine vide sinon")
    lat: float = Field(description="Latitude précise si connue, 0 sinon")
    lng: float = Field(description="Longitude précise si connue, 0 sinon")
    mode: Literal["plane", "train", "bus", "boat", "car", "taxi", "motorbike", "other"] = Field(description="Pour un transport : le mode ; sinon other")
    depart_time: str = Field(description="Heure de départ conseillée HH:MM pour un transport ou une activité, chaine vide sinon")
    pros: list[str] = Field(description="1 à 3 points forts")
    cons: list[str] = Field(description="0 à 2 points faibles ou précautions")
    sources: list[Source]


class GapResult(BaseModel):
    summary: str = Field(description="Deux phrases : ce que tu as trouvé et ce qu'il faut vérifier avant de réserver")
    options: list[GapOption]


GAP_BRIEFS = {
    "nostay": """Trouve 4 à 6 HÉBERGEMENTS réels à {city} ({country}) pour {travelers} adultes, du {from_} au {to} ({days} nuits).
Budget : {budget}. Besoins et envies : {needs}.
PERTINENCE : privilégie les quartiers proches des lieux déjà prévus sur place (ci-dessous) et bien reliés ; respecte le budget
(une seule option un peu au-dessus est permise si elle est nettement meilleure, dis-le dans « why »). Cherche sur le web
(WebSearch, WebFetch) de vraies fiches (Booking, Airbnb, Agoda, site officiel) avec note et prix ACTUELS. Ne fabrique AUCUN lien.""",
    "notransport": """Trouve les meilleures options réelles pour aller de {city} à {tocity} ({tocountry}) autour du {from_}
(arrivée au plus tard le {to}), pour {travelers} adultes. Budget : {budget}. Besoins : {needs}.
Compare vol, train, bus, ferry ou transfert selon ce qui existe : compagnie ou opérateur, horaires habituels, durée porte à porte
réaliste, prix indicatif par personne, lien de réservation fiable (compagnie, 12go.asia, Skyscanner, Google Flights...).
Indique pour chaque option si il faut réserver à l'avance. Cherche sur le web ; ne fabrique AUCUN lien.""",
    "empty": """Propose 4 à 6 ACTIVITÉS réelles à faire à {city} ({country}) entre le {from_} et le {to} ({days} jour(s) libres),
pour {travelers} adultes. Budget : {budget}. Besoins et envies : {needs}.
PERTINENCE : proches des lieux déjà prévus sur place et des hébergements (ci-dessous), sans doublon avec eux, adaptées à la saison
et à la météo, avec horaires d'ouverture vérifiés sur le web (WebSearch, WebFetch). Donne un horaire de départ conseillé.""",
    "nostop": """Les jours du {from_} au {to} ({days} jour(s)) n'ont pas de destination dans ce voyage. Étape précédente : {city} ({country}).
Étape suivante : {tocity} ({tocountry}). Propose 3 à 4 ÉTAPES réalistes (ville ou région) entre les deux ou à côté, faisables
pour {travelers} adultes. Budget : {budget}. Besoins et envies : {needs}.
Tiens compte du temps de trajet depuis l'étape précédente et vers la suivante, de la saison et du budget. Cherche sur le web.""",
}


def job_gap_search(job: dict, req: dict, tmp: Path) -> dict:
    gap = req.get("gap") or {}
    kind = gap.get("type")
    if kind not in GAP_BRIEFS:
        raise RuntimeError("Type de trou inconnu")
    trip_id = job["trip_id"]
    city = gap.get("city") or ""
    # Contexte : lieux deja prevus dans cette ville (pour juger la proximite)
    ctx = []
    if city:
        for p in sb("GET", "places", params={"trip_id": f"eq.{trip_id}", "city": f"ilike.{city}", "select": "name,lat,lng,visit_date,details", "limit": "60"}) or []:
            if (p.get("details") or {}).get("kind", "") and re.search(r"h[oô]tel|airbnb|resort|hostel", p["name"], re.I):
                continue
            ctx.append(f"- {p['name']} ({p['lat']:.4f},{p['lng']:.4f})" + (f" le {p['visit_date']}" if p.get("visit_date") else ""))
    budget = req.get("budget")
    cur = req.get("currency") or "EUR"
    budget_txt = (f"{budget} {cur} {'par nuit' if kind == 'nostay' else 'par personne' if kind != 'nostop' else 'au total par jour'} maximum"
                  if budget else "pas de limite précisée : propose un bon rapport qualité-prix")
    brief = GAP_BRIEFS[kind].format(
        city=city, country=gap.get("country") or "", tocity=gap.get("toCity") or "", tocountry=gap.get("toCountry") or "",
        from_=gap.get("from"), to=gap.get("to"), days=gap.get("days") or 1, travelers=req.get("travelers") or 2,
        budget=budget_txt, needs=(req.get("needs") or "aucune précision, sois pertinent").strip(),
    )
    prompt = (
        f"{brief}\n\nLieux déjà prévus sur place :\n" + ("\n".join(ctx[:40]) or "(rien pour l'instant)")
        + f"\n\nDate du jour : {date.today().isoformat()}\nN'invente rien : si tu n'es pas sûr d'un prix ou d'un lien, laisse-le vide.\n"
        + lang_line(req.get("lang", "fr"))
    )
    data = claude_json(prompt, GapResult, cwd=tmp, tools=["WebSearch", "WebFetch"], timeout=1500)
    for o in data["options"]:
        if abs(o["lat"]) < 0.0001 and abs(o["lng"]) < 0.0001:
            o["lat"] = o["lng"] = None
        if o["lat"] is None and o["address"] and kind in ("nostay", "activity", "empty"):
            hit = geocode_osm(f"{o['address']}, {gap.get('country') or ''}")
            if hit:
                o["lat"], o["lng"] = hit
    return data


def check_env() -> None:
    missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") if not os.environ.get(k)]
    if missing:
        log("Variables manquantes dans analyzer/.env : " + ", ".join(missing))
        sys.exit(1)
    if not shutil.which("claude"):
        log("Claude Code introuvable : installez-le et connectez-vous avec votre compte Claude.")
        sys.exit(1)
    if not GROQ_KEY:
        log("Attention : GROQ_API_KEY absente, pas de transcription de la voix.")
    if not shutil.which("ffmpeg"):
        log("Attention : ffmpeg introuvable, les videos ne pourront pas etre decoupees.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", help="Analyse une URL et affiche la fiche, sans toucher a la base")
    parser.add_argument("--once", action="store_true", help="Traite une seule demande puis s'arrete")
    args = parser.parse_args()

    if args.test:
        data, title, _, _ = analyse(args.test, None, "Aucun voyage communique (test).", "fr")
        print(json.dumps({"title": title, **data}, ensure_ascii=False, indent=2))
        return

    check_env()
    threading.Thread(target=heartbeat_forever, daemon=True).start()
    # Au demarrage, rien ne peut etre « en cours » : ce qui l'etait a ete coupe
    # (PC eteint, analyseur relance). On le remet en file tout de suite.
    try:
        sb("PATCH", "ai_jobs", params={"status": "eq.processing"},
           body={"status": "pending", "progress": 0, "step": None, "updated_at": now_iso()}, prefer="return=minimal")
        sb("PATCH", "link_ideas", params={"status": "eq.processing"}, body={"status": "pending", "updated_at": now_iso()}, prefer="return=minimal")
        resumed_ideas, resumed_jobs = requeue_provider_limits()
        if resumed_ideas or resumed_jobs:
            log(f"Reprise apres quota : {resumed_ideas} liens et {resumed_jobs} recherches remis en file.")
    except Exception:
        pass
    if not args.once:
        threading.Thread(target=ideas_loop, daemon=True).start()
        for n in range(AI_WORKERS):
            threading.Thread(target=ai_worker, args=(n + 1,), daemon=True).start()
    log(f"Analyseur BuBuTravel {VERSION} en ligne sous le nom « {NAME} » (Claude via l'abonnement). Ctrl+C pour arreter.")
    last_beat = 0.0
    while True:
        try:
            if time.time() - last_beat > 30:
                heartbeat()
                requeue_stuck()
                last_beat = time.time()
            # Les demandes IA tournent dans leurs propres travailleurs (en parallele)
            ai_job = claim_ai_job() if args.once else None
            if ai_job:
                process_ai_job(ai_job)
                heartbeat()
                if args.once:
                    return
                continue
            with CLAUDE_STATE_LOCK:
                can_claim_background = time.time() >= CLAUDE_PAUSED_UNTIL
            job = claim() if can_claim_background else None
            if job:
                process(job)
                heartbeat()
                if args.once:
                    return
                continue
        except KeyboardInterrupt:
            log("Arret.")
            return
        except Exception as err:
            log(f"Erreur de boucle : {str(err)[:200]}")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
