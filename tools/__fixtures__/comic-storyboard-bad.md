# 分镜表（坏例 · A 批 fixture）

> 与 `comic-storyboard-sample.md` 同生共死的一份**故意写坏**的分镜表：它本身过 `storyboard@1` 契约
> （结构合法），但会让 `tools/img-plan.py` 在编排期撞出三类硬缺陷。用途是把「显式失败并点名旋钮」
> 这条纪律钉成可复跑的测试——本项目最贵的坑是静默降参后出一批错图（工单 §八），
> 所以坏例必须**永远失败得一样难看**，改动工具后若某类硬缺陷不再被点名，自测就该红。

三处坏（各自独立点名，互不遮蔽）：

1. 第 1 格引用不存在的背景资产 id → `ASSET_REF_DANGLING`。
2. 第 2 格挂两张参考图，而 `comfyui-qwen-ref-edit.json` 只有一个 `__REF_1__` 槽 → `REF_SLOT_OVERFLOW`
   （多出来那张会被静默丢掉：实图与指纹/收据对不上，正是「半接状态」）。
3. 第 3 格要 2048×1536 = 3.1MP，越画像 `budget.max_pixels`（1MP）→ `OVER_PIXEL_BUDGET`，
   并且必须点名旋钮，不许偷偷缩图。

```json
{
  "format": "storyboard@1",
  "bind": { "project": "p-fixture-comic-bad", "flow": "fixture", "node": "m1.storyboard", "episode": 1 },
  "style": { "color_intensity": "flat" },
  "layout_default": { "grid": "1x3", "per_panel": true },
  "characters": [
    { "id": "lin-wan", "name": "林晚", "anchor_asset": "漫画/anchors/k-char-linwan-front.png" }
  ],
  "pages": [
    {
      "page_no": 1,
      "title": "三处坏",
      "panels": [
        {
          "panel_no": 1,
          "description": "林晚站在隘口",
          "characters": ["lin-wan"],
          "background": "bg-not-exist"
        },
        {
          "panel_no": 2,
          "description": "她回头，构图接着上一格",
          "characters": ["lin-wan"],
          "refs": [
            { "source": "anchor", "ref": "lin-wan", "role": "identity" },
            { "source": "panel", "ref": "1-1", "role": "composition" }
          ]
        },
        {
          "panel_no": 3,
          "description": "特写：铜灯熄灭的一瞬",
          "props": ["prop-brass-lantern"],
          "size": { "w": 2048, "h": 1536 }
        }
      ]
    }
  ],
  "notes": "坏例 fixture：只用于自测点名，不是可用分镜表。"
}
```

- 第 3 格还顺手引了一个道具 id：不给 `--assets` 时它会额外报一条 `ASSET_REF_DANGLING`，
  自测不依赖它（断言只看三类必现码），别把它当第 4 类契约。
