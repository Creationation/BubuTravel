"""
Analyseur BuBuTravel.

Tourne sur le PC de la maison (plus tard sur un VPS) et traite les liens
colles dans l'app (table link_ideas, status = pending) :

  1. telecharge la video en 480p maximum (TikTok, Instagram, YouTube...),
  2. extrait une quinzaine d'images reparties sur toute la video,
  3. transcrit la voix avec Groq Whisper, recupere les sous-titres s'il y en a,
  4. demande a Claude de regarder les images, lire la legende et la
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
import time
import traceback
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import anthropic
import requests
from dotenv import load_dotenv
from pydantic import BaseModel, Field

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")

try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:
    pass

VERSION = "1.0"
MODEL = "claude-opus-5-5"
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
    sb(
        "POST",
        "analyzer_status",
        params={"on_conflict": "id"},
        body={"id": NAME, "last_seen": now_iso(), "version": VERSION},
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


def claim() -> dict | None:
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
# Claude : regarder, rechercher, structurer
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
    name: str = Field(description="Nom court de l'activite ou du lieu")
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
    sources: list[Source]


SYSTEM = """You help two travellers turn social media posts into concrete travel plans.
You receive frames from a short video (in order), its caption, a transcript of the speech,
subtitles, and the travellers' current trips with their stops and dates.

1. Work out exactly what is shown: the activity, the place, the operator if visible
   (boat names, signs, logos, on-screen text, what the speaker says).
2. Search the web to confirm it and find practical facts: real name, location, price,
   duration, schedule or departure times, how and where to book, how far ahead, seasonality,
   and anything that would stop it from happening on their dates (weather, closures, festivals).
3. Decide where it fits in their trips: which stop it belongs to and which dates work. If it is
   not near any planned stop, say what would need to change.
Be factual. When something cannot be confirmed, say so instead of inventing it."""


def research(client: anthropic.Anthropic, content: list, lang: str) -> tuple[str, list[dict]]:
    messages = [{"role": "user", "content": content}]
    tools = [{"type": "web_search_20260209", "name": "web_search", "max_uses": 6}]
    sources: list[dict] = []
    text_parts: list[str] = []
    for _ in range(4):
        response = client.messages.create(
            model=MODEL,
            max_tokens=16000,
            thinking={"type": "adaptive"},
            output_config={"effort": "high"},
            system=SYSTEM + ("\n\nWrite your notes in French." if lang == "fr" else ""),
            tools=tools,
            messages=messages,
        )
        for block in response.content:
            if block.type == "text":
                text_parts.append(block.text)
            elif block.type == "web_search_tool_result" and isinstance(block.content, list):
                for r in block.content:
                    url = getattr(r, "url", None)
                    if url and all(s["url"] != url for s in sources):
                        sources.append({"title": getattr(r, "title", "") or "", "url": url})
        if response.stop_reason == "pause_turn":
            messages.append({"role": "assistant", "content": response.content})
            continue
        if response.stop_reason == "refusal":
            raise RuntimeError("Claude a refuse d'analyser ce contenu.")
        break
    return "\n".join(text_parts).strip(), sources


def structure(client: anthropic.Anthropic, notes: str, context: str, sources: list[dict], lang: str) -> Analysis:
    instruction = (
        "Ecris tous les textes en francais avec les accents. Dates au format AAAA-MM-JJ."
        if lang == "fr"
        else "Write every text in English. Dates as YYYY-MM-DD."
    )
    response = client.messages.parse(
        model=MODEL,
        max_tokens=8000,
        thinking={"type": "adaptive"},
        output_config={"effort": "medium"},
        messages=[
            {
                "role": "user",
                "content": (
                    "Turn these research notes into the structured card for the app.\n"
                    f"{instruction}\n\n"
                    f"Trips and stops:\n{context}\n\n"
                    f"Web sources found:\n{json.dumps(sources[:12], ensure_ascii=False)}\n\n"
                    f"Research notes:\n{notes}"
                ),
            }
        ],
        output_format=Analysis,
    )
    if not response.parsed_output:
        raise RuntimeError("Fiche structuree introuvable dans la reponse.")
    return response.parsed_output


# --------------------------------------------------------------------------
# Traitement d'un lien
# --------------------------------------------------------------------------

def analyse(url: str, note: str | None, context: str, lang: str) -> tuple[dict, str | None, str | None]:
    client = anthropic.Anthropic()
    final_url = resolve_url(url)
    tmp = Path(tempfile.mkdtemp(prefix="bubu-"))
    try:
        content: list = []
        title = None
        thumb = None
        info: dict = {}
        transcript = ""
        subs = ""

        is_maps = "google." in final_url and "/maps" in final_url or "goo.gl/maps" in url or "maps.app.goo.gl" in url
        if is_maps:
            content.append({"type": "text", "text": f"Lien Google Maps.\n{maps_info(final_url)}"})
        else:
            info, video = download(final_url, tmp)
            title = info.get("title") or None
            if video:
                duration = info.get("duration") or video_duration(video)
                frames = extract_frames(video, tmp, float(duration or 0))
                log(f"  video {video.stat().st_size // 1024} Ko, {duration or '?'} s, {len(frames)} images")
                if frames:
                    thumb = thumbnail_data_url(frames[min(len(frames) - 1, 2)], tmp)
                for i, frame in enumerate(frames):
                    content.append({"type": "text", "text": f"Image {i + 1}/{len(frames)}"})
                    content.append(
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": base64.b64encode(frame.read_bytes()).decode(),
                            },
                        }
                    )
                transcript = transcribe(video, tmp)
                log(f"  transcription : {len(transcript)} caracteres")
            subs = subtitles_text(tmp)

        meta = page_meta(final_url) if not info else {}
        header = [
            f"Lien : {url}",
            f"Lien resolu : {final_url}" if final_url != url else "",
            f"Plateforme : {info.get('extractor_key') or ''}",
            f"Titre : {info.get('title') or meta.get('og:title') or meta.get('title') or ''}",
            f"Auteur : {info.get('uploader') or info.get('channel') or ''}",
            f"Legende / description : {(info.get('description') or meta.get('og:description') or meta.get('description') or '')[:4000]}",
            f"Lieu indique par la plateforme : {info.get('location') or ''}",
            f"Precision des voyageurs : {note}" if note else "",
            f"Transcription de la voix :\n{transcript[:12000]}" if transcript else "Pas de transcription.",
            f"Sous-titres :\n{subs}" if subs else "",
            "",
            f"Date du jour : {date.today().isoformat()}",
            f"Voyages des voyageurs :\n{context}",
        ]
        content.insert(0, {"type": "text", "text": "\n".join(h for h in header if h)})
        if not thumb:
            thumb = info.get("thumbnail") or meta.get("og:image")

        notes, sources = research(client, content, lang)
        log(f"  recherche terminee, {len(sources)} sources")
        result = structure(client, notes, context, sources, lang)
        data = result.model_dump()
        if transcript and not data.get("transcript_excerpt"):
            data["transcript_excerpt"] = transcript[:600]
        return data, (title or data.get("name")), thumb
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def process(job: dict) -> None:
    log(f"Lien {job['id'][:8]} : {job['url']}")
    try:
        lang = user_lang(job["user_id"])
        context = trip_context(job)
        data, title, thumb = analyse(job["url"], job.get("note"), context, lang)
        update_idea(job["id"], status="ready", analysis=data, title=title, thumbnail=thumb, error=None)
        log(f"  pret : {data.get('name')}")
    except anthropic.AuthenticationError:
        update_idea(job["id"], status="error", error="Cle Anthropic invalide sur l'analyseur.")
        log("  cle Anthropic invalide")
    except Exception as err:
        traceback.print_exc()
        update_idea(job["id"], status="error", error=str(err)[:300])


def check_env() -> None:
    missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY") if not os.environ.get(k)]
    if missing:
        log("Variables manquantes dans analyzer/.env : " + ", ".join(missing))
        sys.exit(1)
    if not GROQ_KEY:
        log("Attention : GROQ_API_KEY absente, pas de transcription de la voix.")
    if not shutil.which("ffmpeg"):
        log("Attention : ffmpeg introuvable, les videos ne pourront pas etre decoupees.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", help="Analyse une URL et affiche la fiche, sans toucher a la base")
    parser.add_argument("--once", action="store_true", help="Traite un seul lien puis s'arrete")
    args = parser.parse_args()

    if args.test:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            log("ANTHROPIC_API_KEY manquante")
            sys.exit(1)
        data, title, _ = analyse(args.test, None, "Aucun voyage communique (test).", "fr")
        print(json.dumps({"title": title, **data}, ensure_ascii=False, indent=2))
        return

    check_env()
    log(f"Analyseur BuBuTravel {VERSION} en ligne sous le nom « {NAME} ». Ctrl+C pour arreter.")
    last_beat = 0.0
    while True:
        try:
            if time.time() - last_beat > 30:
                heartbeat()
                requeue_stuck()
                last_beat = time.time()
            job = claim()
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
