"""
Raccourcit les noms de lieux trop longs (phrases) en leur vrai nom propre.
Un seul appel a Claude (abonnement) pour tous les noms. Le nom complet
d'origine est garde en tete des notes, rien n'est perdu.
Lancement : .venv\\Scripts\\python.exe shorten_names.py
"""
import tempfile
from pathlib import Path

from pydantic import BaseModel

import analyzer as a


class Item(BaseModel):
    id: str
    short: str


class Result(BaseModel):
    items: list[Item]


places = [p for p in a.sb("GET", "places", params={"select": "id,name,city,notes"}) if len(p["name"]) > 34]
a.log(f"{len(places)} noms longs")
if places:
    listing = "\n".join(f'{p["id"]} | {p["name"]} | {p.get("city") or ""}' for p in places)
    prompt = (
        "Pour chaque lieu, donne un nom COURT (40 caracteres max), le vrai nom propre du lieu tel qu'on le "
        "chercherait sur Google Maps (ex. « Eagle Nest Bar », « Kodtalay Seafood Buffet », « Wat Pho »). "
        "Si le lieu n'a pas de nom propre, un intitule court et clair en francais (ex. « Buffet de rue a 50 bahts »). "
        "Pas de parentheses, pas de description. Garde l'id tel quel.\n\nid | nom actuel | ville\n" + listing
    )
    res = a.claude_json(prompt, Result, cwd=Path(tempfile.mkdtemp()), tools=["WebSearch"], timeout=600)
    by_id = {p["id"]: p for p in places}
    n = 0
    for it in res["items"]:
        p = by_id.get(it["id"])
        short = it["short"].strip()[:60]
        if not p or not short or short == p["name"]:
            continue
        notes = p.get("notes") or ""
        if not notes.startswith("Nom complet"):
            notes = f"Nom complet : {p['name']}\n{notes}"
        a.sb("PATCH", "places", params={"id": f"eq.{p['id']}"}, body={"name": short, "notes": notes}, prefer="return=minimal")
        a.log(f"  {p['name'][:50]} -> {short}")
        n += 1
    a.log(f"{n} noms raccourcis")
