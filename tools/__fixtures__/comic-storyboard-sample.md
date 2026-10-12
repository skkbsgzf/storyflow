# 分镜表（合成样例 · A 批 fixture）

> `tools/img-plan.py` / `tools/img-assets.py` 自测用的**合成**分镜表：人物、台词与情节全部编的，
> 不指向任何真实语料。正文给人读，机读是下面那个 ```json 围栏块（`storyboard@1`）。
> 口径演示：第 1 页第 1 格走「短句气泡」（实测每句 ≤8 字才稳），第 2 格故意放一条长台词，
> 让 `bubble_over_limit` 的证据位与留白轨被跑到——数值只进复核清单，不拦、不改稿。

## 第 1 页（逐格出图）

1. 林晚逆风提灯站在隘口，灯焰被压得极低。（特写偏中景，气泡短句；参考图＝角色锚）
2. 她低头看灯，油快见底；雪把声音盖住了。（近景，参考图＝前一格；含一条超长台词，用于跑复核清单）

> 每格只挂**一张**参考图：出厂 `comfyui-qwen-ref-edit.json` 只有一个 `__REF_1__` 槽（实测形状），
> 想同时喂锚图＋前格会被 `img-plan` 显式拒绝（`REF_SLOT_OVERFLOW`），不会静默丢一张——
> 那条路有专门的反例 fixture（`comic-storyboard-bad.md`）。

## 第 2 页（整页一次出，四宫格）

铺垫页，演示「一页一次出 = 格与格共享一次采样」这条最省钱也最不可控的路径，
台账与像素账都按每格 = 页像素/4 记账。

```json
{
  "format": "storyboard@1",
  "bind": {
    "project": "p-fixture-comic",
    "flow": "fixture",
    "node": "m1.storyboard",
    "episode": 1,
    "source_script": "内部/分镜剧本.md"
  },
  "style": { "name": "黑白少年漫加单色强调", "color_intensity": "standard" },
  "layout_default": { "grid": "2x2", "per_panel": true, "engine": "base" },
  "characters": [
    {
      "id": "lin-wan",
      "name": "林晚",
      "asset_ref": "char-linwan",
      "anchor_asset": "漫画/anchors/k-char-linwan-front.png"
    }
  ],
  "pages": [
    {
      "page_no": 1,
      "title": "隘口提灯",
      "panels": [
        {
          "panel_no": 1,
          "description": "林晚逆风提灯站在雪山隘口，灯焰被风压得极低，人很小天很沉",
          "shot": "中景偏俯",
          "characters": ["lin-wan"],
          "background": "bg-snowpass",
          "props": ["prop-brass-lantern"],
          "details": ["detail-rosette"],
          "refs": [{ "source": "anchor", "ref": "lin-wan", "role": "identity" }],
          "bubbles": [
            { "speaker": "lin-wan", "text": "风真硬。", "kind": "speech" },
            { "text": "呼——", "kind": "sfx" }
          ],
          "narration": ["她到得太晚。"]
        },
        {
          "panel_no": 2,
          "description": "近景：林晚低头看手里的铜灯，灯油见底，指节发白",
          "shot": "近景",
          "characters": ["lin-wan"],
          "props": ["prop-brass-lantern"],
          "refs": [
            { "source": "panel", "ref": "1-1", "role": "composition" }
          ],
          "bubbles": [
            { "speaker": "lin-wan", "text": "这点油，撑不到下一道梁。", "kind": "speech" }
          ]
        }
      ]
    },
    {
      "page_no": 2,
      "title": "下山（整页四宫格）",
      "per_panel": false,
      "grid": "2x2",
      "panels": [
        { "panel_no": 1, "description": "林晚侧身往下走，外套下摆被风掀起", "characters": ["lin-wan"] },
        { "panel_no": 2, "description": "隘口全景，人只剩一个黑点", "background": "bg-snowpass" },
        { "panel_no": 3, "description": "铜灯在她手里晃动，光在雪上拖出一道", "props": ["prop-brass-lantern"] },
        {
          "panel_no": 4,
          "description": "她停住，回头看山口，肩甲卷草纹占画面一角",
          "characters": ["lin-wan"],
          "details": ["detail-rosette"],
          "bubbles": [{ "speaker": "lin-wan", "text": "还有人在上面。", "kind": "thought" }]
        }
      ]
    }
  ],
  "notes": "合成 fixture：覆盖逐格/整页两条选路、anchor+panel 两类参考、气泡短句与超长句两种口径。"
}
```
