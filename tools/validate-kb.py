import json, re, glob, os

report = {"pass": [], "warn": [], "fail": []}
R = report["pass"].append

idx = json.load(open("knowledge/index.json", encoding="utf-8"))
idx_ids = {e["id"] for e in idx["entries"]}

md_ids, bad_fm = set(), []
for f in glob.glob("knowledge/**/*.md", recursive=True):
    m = re.match(r"^---\n(.*?)\n---", open(f, encoding="utf-8").read(), re.S)
    if m:
        try:
            fm = json.loads(m.group(1))
            md_ids.add(fm["id"])
        except Exception as e:
            bad_fm.append((f, str(e)[:50]))
if bad_fm:
    report["fail"].append(f"broken frontmatter: {bad_fm}")
if md_ids - idx_ids:
    report["fail"].append(f"index missing entries: {md_ids - idx_ids}")
else:
    R(f"index covers all {len(md_ids)} md entries")

a = json.load(open("knowledge/aesthetic/assertions.json", encoding="utf-8"))
assert_ids = {x["id"] for x in a["asserts"]}
if "kb/aesthetic/assertions" not in idx_ids:
    report["fail"].append("assertions not in index")

dangling = set()
for f in glob.glob("knowledge/**/*.md", recursive=True):
    m = re.match(r"^---\n(.*?)\n---", open(f, encoding="utf-8").read(), re.S)
    if m:
        fm = json.loads(m.group(1))
        for aid in fm.get("asserts", []):
            if aid not in assert_ids:
                dangling.add((f, aid))
if dangling:
    report["fail"].append(f"dangling assert refs: {dangling}")
else:
    R(f"no dangling assert refs ({len(assert_ids)} asserts)")

kb_all = idx_ids | md_ids  # index includes generated json entries (snapshot) that have no md frontmatter
bad_refs = []
ref_re = re.compile(r"kb/[a-z-]+/[a-zA-Z0-9_\-*/]+")
for f in (
    glob.glob("skills/*.md")
    + glob.glob("flows/**/*.json", recursive=True)
    + glob.glob("agents/*.json")
    + glob.glob("knowledge/**/*.md", recursive=True)
):
    txt = open(f, encoding="utf-8").read()
    for ref in set(ref_re.findall(txt)):
        if ref.endswith("/*"):
            prefix = ref[:-2]
            ok = any(i.startswith(prefix + "/") for i in kb_all)
        else:
            ok = ref in kb_all
        if not ok:
            bad_refs.append((f, ref))
if bad_refs:
    report["fail"].append(f"unresolved kb refs: {sorted(set(bad_refs))[:8]}")
else:
    R("all kb refs in skills/flows/agents/knowledge resolve")

flow_files = glob.glob("flows/*/flow.json")
skills = {os.path.basename(f)[:-3] for f in glob.glob("skills/*.md")}
missing_skills = set()
flow_count = 0
for ff in flow_files:
    fl = json.load(open(ff, encoding="utf-8"))
    flow_count += 1
    for n in fl["graph"]["nodes"].values():
        for s in [n.get("skill", "")] + n.get("assist", []):
            if s and s not in skills:
                missing_skills.add((fl["id"], s))
if missing_skills:
    report["fail"].append(f"flow references missing skills: {missing_skills}")
else:
    R(f"all skills referenced by {flow_count} flows exist in skills/")

# agent profile binding checks
try:
    prof = json.load(open("agents/plot-redline.profile.json", encoding="utf-8"))
    kb = prof["three_layer_binding"]["knowledge"]
    sk = prof["three_layer_binding"]["skill"]
    ok_kb = all(
        (r[:-2] and any(i.startswith(r[:-2] + "/") for i in kb_all)) if r.endswith("/*") else r in kb_all
        for r in kb
    )
    ok_sk = os.path.exists(sk)
    if ok_kb and ok_sk:
        R("plot-redline profile three-layer binding resolves")
    else:
        report["fail"].append(f"profile binding broken: kb_ok={ok_kb} skill_ok={ok_sk}")
except Exception as e:
    report["warn"].append(f"profile check skipped: {e}")

try:
    snap = json.load(open("knowledge/market/snapshot.json", encoding="utf-8"))
    d = snap.get("date", snap.get("version", (snap.get("source") or {}).get("capturedAt", "?")))
    db = json.load(open("flows/topic-selection/flow.json", encoding="utf-8")).get("dataBase")
    R(f"market snapshot date: {d} | flow dataBase: {db}")
    if db and db != d:
        report["warn"].append(f"flow dataBase ({db}) != snapshot date ({d})")
except Exception as e:
    report["warn"].append(f"snapshot check failed: {e}")

tr = len(glob.glob("knowledge/trope/*.md"))
bm = len(glob.glob("knowledge/benchmark/*.md"))
R(f"generated: {tr} tropes, {bm} benchmarks")

mts = set()
for f in glob.glob("skills/*.md"):
    m = re.search(r"bind:.*", open(f, encoding="utf-8").read())
    if m:
        mts |= set(re.findall(r'"([a-z_]+)"', m.group(0)))
R(f"minitools bound in skills: {sorted(mts)}")

for k in ("fail", "warn", "pass"):
    for item in report[k]:
        print(f"[{k.upper()}] {item}")
print()
print("KB md entries:", len(md_ids), "| asserts:", len(assert_ids), "| index entries:", len(idx_ids))
