# push-mirror.py — 断链仓库的远端镜像器
#
# 背景：本仓历史底部两处断点（9fe8653a、d3bf007 随 2026-09-18 .git 误删永久丢失），
#       本地以 replace ref 桥接可浏览；但 git pack-objects 在无替换口径下打包，
#       replace ref 救不了 push（pack 必须物理自洽）。
#       另有 blob 187bb1eb（docs/规范-模块化flow与工具箱-R6.md 的 17:20 版）同批丢失，
#       被 1e7bcf7 的树引用，镜像行对该路径打「诚实占位符」（内容写明原 SHA 与去向）。
#
# 本工具：自底向上重写整条提交行——树 / author / committer / 提交信息逐字节保留
#         （缺失 blob 所在树除外：打占位补丁），使历史自洽；只推远端，本地 ref 一律不动
#         （并发写入者无感，旧 SHA 本地照常可用）。old→new 映射落 rescue 目录对账。
#
# 用法：python tools/push-mirror.py [--push]
import subprocess, sys, os

REPO = "D:/storymasterv4"
RESCUE = "D:/storymasterv4-rescue-20260921"
REMOTE_BRANCHES = ["main", "module-flow-v3"]
REMOTE_TAGS = ["v4.0.0", "v4.0.1", "day-20260918"]

def gitb(*args, input_bytes=None, env=None, cwd=REPO):
    r = subprocess.run(["git"] + list(args), capture_output=True, input=input_bytes, cwd=cwd, env=env)
    if r.returncode != 0:
        raise RuntimeError(f"git {args}: {r.stderr.decode('utf-8','replace').strip()}")
    return r.stdout

def out(b):
    return b.decode("ascii", "strict").strip()

# 1) replace 桥清单（诊断用）
replaces = []
for line in gitb("for-each-ref", "refs/replace", "--format=%(refname) %(objectname)").decode().splitlines():
    ref, tgt = line.split()
    replaces.append((ref.split("/")[-1], tgt))
print("replace 桥:", ", ".join(f"{s[:8]}→{t[:8]}" for s, t in replaces))

# 2) 替换口径下的全量提交节点（自底向上）
nodes = gitb("rev-list", "--topo-order", "--reverse", "main").decode().split()
print(f"节点数（替换口径提交行）: {len(nodes)}")
old_tip = out(gitb("rev-parse", "main"))

node_root_tree = {}
tree_cache = {}   # tree sha(bytes) -> list[(mode_b, type_b, sha_s, name_b)]
def read_tree(t):
    if t not in tree_cache:
        ents = []
        for rec in gitb("ls-tree", "-z", t).split(b"\0"):
            if not rec:
                continue
            meta, name = rec.split(b"\t", 1)
            mode_b, otype_b, osha_b = meta.split()
            ents.append((mode_b, otype_b, osha_b.decode(), name))
        tree_cache[t] = ents
    return tree_cache[t]

for sha in nodes:
    head, _, _ = gitb("cat-file", "-p", sha).partition(b"\n\n")
    node_root_tree[sha] = head.split(b"\n")[0].split()[1].decode()

# 3) 缺失对象探测：收集全部树条目里的 blob/tree sha，batch-check 一次点名
all_trees, all_blobs = set(), {}
seen_trees = set()
def collect(t):
    if t in seen_trees:
        return
    seen_trees.add(t)
    all_trees.add(t)
    for mode_b, otype_b, osha, name in read_tree(t):
        if otype_b == b"tree":
            collect(osha)
        else:
            all_blobs[osha] = name
for t in set(node_root_tree.values()):
    collect(t)
shas = sorted(all_trees | set(all_blobs))
batch_in = ("\n".join(shas) + "\n").encode()
missing = set()
for line in gitb("cat-file", "--batch-check", input_bytes=batch_in).decode().splitlines():
    parts = line.split()
    if len(parts) >= 2 and parts[1] == "missing":
        missing.add(parts[0])
print(f"树 {len(all_trees)} 棵 / blob {len(all_blobs)} 个，缺失 {len(missing)}：")
for m in sorted(missing):
    print("  ", m[:8], all_blobs.get(m, b"?").decode("utf-8", "replace"))

# 4) 占位补丁（只进镜像行；写明原 SHA 与去向，不冒充原内容）
stub_blob = {}
for bsha in missing:
    path = all_blobs.get(bsha, b"?").decode("utf-8", "replace")
    note = (
        "⚠️ 镜像占位符 · push-mirror.py\n"
        "\n"
        f"本路径（{path}）在 2026-09-18 的原版本（blob {bsha}）随同日 .git 误删事故永久丢失，\n"
        "无法逐字节恢复；本镜像行为使历史可打包推送，以此占位符替代。\n"
        "本机最近可考版本存于 backup-20260918-2333 快照同路径；现行版本见主干最新提交。\n"
        "复盘：docs/事故-2026-09-18-git目录误删与恢复.md §七。\n"
    ).encode("utf-8")
    stub_blob[bsha] = out(gitb("hash-object", "-w", "--stdin", input_bytes=note))

tree_patch = {}
def patch_tree(t):
    if t in tree_patch:
        return tree_patch[t]
    ents = read_tree(t)
    new_ents, changed = [], False
    for mode_b, otype_b, osha, name in ents:
        if otype_b == b"blob" and osha in stub_blob:
            new_ents.append((mode_b, otype_b, stub_blob[osha], name)); changed = True
        elif otype_b == b"tree":
            pt = patch_tree(osha)
            if pt != osha:
                changed = True
            new_ents.append((mode_b, otype_b, pt, name))
        else:
            new_ents.append((mode_b, otype_b, osha, name))
    if not changed:
        tree_patch[t] = t
    else:
        def key(e):
            return e[3] + (b"/" if e[0] == b"40000" else b"")
        lines = [m + b" " + (b"tree" if typ == b"tree" else b"blob") + b" " + s.encode() + b"\t" + n
                 for m, typ, s, n in sorted(new_ents, key=key)]
        tree_patch[t] = out(gitb("mktree", input_bytes=b"\n".join(lines) + b"\n"))
    return tree_patch[t]

for t in set(node_root_tree.values()):
    patch_tree(t)

# 5) 自底向上重写提交行
newmap = {}
for sha in nodes:
    raw = gitb("cat-file", "-p", sha)          # 有 replace 桥的节点自动给出替换后内容
    head, _, msg = raw.partition(b"\n\n")
    lines = head.split(b"\n")
    tree = None; parents = []; rest = []
    for ln in lines:
        if ln.startswith(b"tree "):
            tree = ln.split()[1].decode()
        elif ln.startswith(b"parent "):
            parents.append(ln.split()[1].decode())
        else:
            rest.append(ln)
    if tree is None:
        raise RuntimeError(f"{sha}: 无 tree 行")
    new_tree = tree_patch.get(tree, tree)
    new_parents = []
    for p in parents:
        if p not in newmap:
            raise RuntimeError(f"{sha}: 父 {p} 尚未重写（顺序错误或断链未桥接）")
        new_parents.append(newmap[p].encode())
    body = b"\n".join([b"tree " + new_tree.encode()] + [b"parent " + np for np in new_parents] + rest) + b"\n\n" + msg
    newmap[sha] = out(gitb("hash-object", "-t", "commit", "-w", "--stdin", input_bytes=body))
new_tip = newmap[old_tip]
print(f"tip: {old_tip[:10]} → {new_tip[:10]}")

# 6) tag 重写
new_tags = {}
for ref in REMOTE_TAGS:
    o = out(gitb("rev-parse", ref))
    t = out(gitb("cat-file", "-t", o))
    if t == "tag":
        raw = gitb("cat-file", "-p", o)
        head, _, msg = raw.partition(b"\n\n")
        new_lines = []
        for ln in head.split(b"\n"):
            if ln.startswith(b"object "):
                old_target = ln.split()[1].decode()
                if old_target not in newmap:
                    raise RuntimeError(f"tag {ref} 指向 {old_target} 不在重写行内")
                new_lines.append(b"object " + newmap[old_target].encode())
            else:
                new_lines.append(ln)
        new_tags[ref] = out(gitb("mktag", input_bytes=b"\n".join(new_lines) + b"\n\n" + msg))
    elif o in newmap:
        new_tags[ref] = newmap[o]
    else:
        print(f"WARN: tag {ref} 指向 {o[:8]} 不在重写行内，跳过")
        continue
    print(f"tag {ref}: {o[:10]} → {new_tags[ref][:10]}")

# 7) 硬校验（显式退出码，不吃管道）：①无替换口径全遍历 ②pack-objects 真打包
env_norep = dict(os.environ, GIT_NO_REPLACE_OBJECTS="1")
r1 = subprocess.run(["git", "rev-list", "--objects", new_tip], capture_output=True, cwd=REPO, env=env_norep)
if r1.returncode != 0:
    raise RuntimeError("新行仍有缺失对象：" + r1.stderr.decode("utf-8", "replace")[:300])
n_objs = len(r1.stdout.decode().splitlines())
p = subprocess.run(["git", "pack-objects", "--revs", "--stdout"], input=(new_tip + "\n").encode(),
                   capture_output=True, cwd=REPO, env=env_norep)
if p.returncode != 0:
    raise RuntimeError("pack-objects 失败：" + p.stderr.decode("utf-8", "replace")[:300])
print(f"硬校验通过：新行自洽，{n_objs} 个对象，可打包 {len(p.stdout)} 字节")

# 8) 映射表落 rescue 目录
os.makedirs(RESCUE, exist_ok=True)
with open(os.path.join(RESCUE, "sha-map.txt"), "w", encoding="utf-8") as f:
    f.write("# push-mirror SHA 映射（old → new）· 生成于 push-mirror.py\n")
    f.write(f"# tip {old_tip} → {new_tip}\n")
    for bsha, s in stub_blob.items():
        f.write(f"stub:{bsha} {s}  # {all_blobs.get(bsha, b'?').decode('utf-8','replace')}\n")
    for sha in nodes:
        f.write(f"{sha} {newmap[sha]}\n")
    for ref, nt in new_tags.items():
        f.write(f"tag:{ref} {nt}\n")
print(f"映射表 → {RESCUE}/sha-map.txt（{len(nodes)} 条提交）")

# 9) 推送（--push 时）
if "--push" not in sys.argv:
    print("dry-run 完成；加 --push 推送远端")
    sys.exit(0)

spec = [f"{new_tip}:refs/heads/{b}" for b in REMOTE_BRANCHES]
spec += [f"{new_tags[r]}:refs/tags/{r}" for r in REMOTE_TAGS if r in new_tags]
r = subprocess.run(["git", "push", "origin"] + spec, capture_output=True, cwd=REPO)
sys.stdout.write(r.stdout.decode("utf-8", "replace"))
sys.stderr.write(r.stderr.decode("utf-8", "replace"))
sys.exit(r.returncode)
