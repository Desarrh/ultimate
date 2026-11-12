"""Audit de la bibliothèque en cache : doublons, extras comptés comme jeux, données manquantes.
Usage : python tests/audit.py [chemin library.json]   (code de sortie 1 s'il y a des problèmes)"""
import json, os, re, sys, collections

path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ["APPDATA"], "dev.local.launcher", "library.json")
lib = json.load(open(path, encoding="utf-8"))
norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
EXTRA = re.compile(r"\b(hd|4k|high[- ]?res(olution)?|texture|soundtrack|ost|artbook|art book|dlc|season pass|expansion|pack|bonus|wallpaper|dedicated server|server|sdk|editor|tool(s|kit)?|benchmark|playtest|test branch|beta|pts|redistributable|upgrade|costume|skin)\b", re.I)
problems = 0

def section(t):
    print(f"\n== {t}")

section(f"{len(lib)} entrées")
ids = collections.Counter(g["id"] for g in lib)
dup_ids = [i for i, n in ids.items() if n > 1]
section(f"ID en double : {len(dup_ids)}")
for i in dup_ids: print("  ", i)
problems += len(dup_ids)

by_src_name = collections.defaultdict(list)
for g in lib:
    by_src_name[(g["source"], norm(g["name"]))].append(g)
same = {k: v for k, v in by_src_name.items() if len(v) > 1 and k[1]}
section(f"Même nom, même plateforme : {len(same)}")
for (src, _), v in same.items():
    print("  ", src, "|", " / ".join(f'{g["name"]} ({g["id"]})' for g in v))
problems += len(same)

cross = collections.defaultdict(set)
for g in lib:
    cross[norm(g["name"])].add(g["source"])
multi = sorted(n for n, s in cross.items() if len(s) > 1)
section(f"Possédé sur plusieurs plateformes (normal, info) : {len(multi)}")
print("  ", ", ".join(multi[:40]))

suspects = [g for g in lib if EXTRA.search(g["name"]) and "Logiciel" not in g.get("tags", []) and "Démo" not in g.get("tags", [])]
section(f"Noms qui ressemblent à des extras (pack, HD, OST, serveur…) : {len(suspects)}")
for g in suspects: print(f'   {g["source"]:5} | {g["name"]} | {g["id"]} | {g.get("playtimeMin",0)//60} h')
problems += len(suspects)

for label, cond in [("sans nom réel", lambda g: g["name"].startswith("Jeu Steam ") or not g["name"].strip()),
                    ("sans jaquette", lambda g: not g.get("cover")),
                    ("sans couleur", lambda g: not g.get("accent")),
                    ("sans catégorie", lambda g: not g.get("tags"))]:
    l = [g for g in lib if cond(g)]
    section(f"Entrées {label} : {len(l)}")
    for g in l[:15]: print(f'   {g["source"]:5} | {g["name"]} | {g["id"]}')

print(f"\nProblèmes à corriger : {problems}")
sys.exit(1 if problems else 0)
