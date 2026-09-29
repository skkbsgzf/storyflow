# -*- coding: utf-8 -*-
"""authors_probe · 四作者/来源具名分类的冻结 encoder 可分性探针（廉价先导实验）。

复用 encoder_probe 的 softmax_reg；在 v03-authors 数据集全体文本块上
（冻结 mmBERT 均值池化嵌入）跑 5 折线性探针，对照多数类基线 25%。
运行（仓库根）: laya-venv python tools/laya-ft/authors_probe.py --student dataset-style/v02-choice/student-v03-choice-e15
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

ROOT = HERE.resolve().parents[1]
DATA = ROOT / "dataset-style" / "v03-authors"
QID = "style.author.v1.choice"


def fit_predict(Xtr, ytr, Xte, n_class, epochs=300, l2=1e-4, seed=0):
    """LBFGS softmax 回归：train 拟合 → test 出预测（与 encoder_probe 同款正则）。"""
    torch.manual_seed(seed)
    d = Xtr.shape[1]
    W = torch.zeros(d, n_class, requires_grad=True)
    b = torch.zeros(n_class, requires_grad=True)
    Xt = torch.tensor(Xtr, dtype=torch.float32)
    yt = torch.tensor(ytr, dtype=torch.long)
    Xs = torch.tensor(Xte, dtype=torch.float32)
    opt = torch.optim.LBFGS([W, b], max_iter=epochs, line_search_fn="strong_wolfe")

    def closure():
        opt.zero_grad()
        loss = torch.nn.functional.cross_entropy(Xt @ W + b, yt) + l2 * (W ** 2).sum()
        loss.backward()
        return loss
    opt.step(closure)
    with torch.no_grad():
        return (Xs @ W + b).argmax(-1).numpy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--student", default=str(ROOT / "dataset-style/v02-choice/student-v03-choice-e15"))
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--out", default=str(DATA / "authors-probe.json"))
    a = ap.parse_args()

    texts, labels = [], []
    for split in ("train", "held", "test"):
        for l in (DATA / f"{split}.jsonl").read_text(encoding="utf-8").splitlines():
            if not l.strip():
                continue
            r = json.loads(l)
            state = json.loads(r["state"])
            gold = json.loads(r["gold"])
            texts.append(state["场景文本"])
            labels.append(max(gold[QID]["probabilities"], key=gold[QID]["probabilities"].get))
    classes = sorted(set(labels))
    y = np.array([classes.index(l) for l in labels])
    print(f"[probe] 唯一块 {len(texts)}, 类别 {classes}, 分布 {np.bincount(y).tolist()}", file=sys.stderr)

    import laya
    agent = laya.load(a.student, device=a.device)
    tok, enc = agent.tok, agent.model.encoder
    enc.eval()
    embs = []
    B = 16
    with torch.no_grad():
        for i in range(0, len(texts), B):
            batch = texts[i:i + B]
            enc_in = tok(batch, padding=True, truncation=True, max_length=512, return_tensors="pt").to(a.device)
            h = enc(input_ids=enc_in["input_ids"], attention_mask=enc_in["attention_mask"]).last_hidden_state
            m = enc_in["attention_mask"].unsqueeze(-1).float()
            emb = (h * m).sum(1) / m.sum(1).clamp(min=1)
            embs.append(torch.nn.functional.normalize(emb, dim=-1).float().cpu().numpy())
            if (i // B) % 10 == 0:
                print(f"[probe] embed {i + len(batch)}/{len(texts)}", file=sys.stderr, flush=True)
    X = np.concatenate(embs)

    n = len(texts)
    idx = np.arange(n)
    rng = np.random.default_rng(0)
    rng.shuffle(idx)
    folds = np.array_split(idx, a.folds)
    accs = []
    for k, fold in enumerate(folds):
        test_i = fold
        train_i = np.concatenate([f for j, f in enumerate(folds) if j != k])
        pred = fit_predict(X[train_i], y[train_i], X[test_i], len(classes), seed=k)
        acc = float((pred == y[test_i]).mean())
        accs.append(acc)
        print(f"[probe] fold{k + 1}: {acc:.3f}", file=sys.stderr, flush=True)

    report = {
        "gate": "authors-probe", "classes": classes, "n": n,
        "folds": a.folds, "accuracy_mean": round(float(np.mean(accs)), 4),
        "accuracy_folds": [round(x, 4) for x in accs],
        "majority_baseline": round(float(max(np.bincount(y)) / n), 4),
        "random_baseline": round(1.0 / len(classes), 4),
        "device": a.device,
    }
    Path(a.out).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
