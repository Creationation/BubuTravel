"""
Rattrapage : pour les idees deja analysees sans images, re-telecharge la
video, en tire les images et met a jour le lieu lie (sans rappeler Claude).
Lancement : .venv\\Scripts\\python.exe backfill_frames.py
"""
import shutil
import tempfile
from pathlib import Path

import analyzer as a

ideas = a.sb("GET", "link_ideas", params={"status": "eq.ready", "select": "*"}) or []
todo = [i for i in ideas if not i.get("frames")]
a.log(f"{len(todo)} idees a completer")
for idea in todo:
    tmp = Path(tempfile.mkdtemp(prefix="bubu-bf-"))
    try:
        info, video = a.download(a.resolve_url(idea["url"]), tmp)
        frames = []
        if video:
            shots = a.extract_frames(video, tmp, float(info.get("duration") or a.video_duration(video) or 0))
            frames = a.upload_frames(shots, tmp, idea["id"])
        if frames:
            a.update_idea(idea["id"], frames=frames, thumbnail=frames[0])
        a.link_place({**idea, "frames": frames, "thumbnail": frames[0] if frames else idea.get("thumbnail")})
        a.log(f"  {len(frames)} images : {(idea.get('analysis') or {}).get('name', idea['url'])}")
    except Exception as err:
        a.log(f"  echec : {err}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
