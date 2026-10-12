# 美术资产表（合成样例 · A 批 fixture）

> 本文件是 `tools/img-plan.py` / `tools/img-assets.py` 自测用的**合成**资产表：人物、场景与道具全是编的，
> 不指向任何真实语料或 IP。正文给人读，机读部分是下面那个 ```json 围栏块（`asset-design@1`）。
> 取块规则见 `contracts/asset-design.schema.json`：命中 0 块或 >1 块都是硬缺陷，工具会点名而不静默取第一块。

## 一套（雪山隘口 · 夜）

- **林晚**（人设）：脸要瘦、颧骨高，头发在脑后绾一个松髻；肩甲上的卷草纹是她的识别标志，纹样本体走
  `detail-rosette` 那件，不在人设里重复描述——两处各写一套外观是本项目反复被咬过的坑。
- **雪山隘口**（背景）：逆光、雪面反光强，年代气质往「说不清的旧时代」偏，别做成现代滑雪场。
- **铜灯**（物品）：剧情道具，要能被看清是「提着的」，形制别画成装饰摆件。
- **卷草纹**（细节图案）：密度中等——密纹在低像素下必糊，这是像素预算口径的输入。

```json
{
  "format": "asset-design@1",
  "bind": { "project": "p-fixture-comic", "flow": "fixture", "node": "m1.art", "episode": 1 },
  "style": { "name": "黑白少年漫加单色强调", "line_weight": "heavy" },
  "assets": [
    {
      "id": "char-linwan",
      "class": "character",
      "name": "林晚",
      "intent": "让读者一眼认出「她是外乡人」：衣着讲究但风尘仆仆",
      "maturity": "locked",
      "design": {
        "face": "瘦长脸，颧骨略高，眉眼偏淡，神情疲惫",
        "hair": "黑发在脑后绾一个松髻，几缕碎发散在额前",
        "outfit": "深色长外套，右肩覆一片窄甲，甲缘有卷草纹",
        "palette": "以黑灰为主，肩甲边缘留一道亮色",
        "build": "身量偏高，肩窄，站姿略微前倾",
        "marks": "左手虎口有一道旧茧",
        "age_range": "三十上下"
      },
      "variants": [
        { "name": "front", "note": "正面全身，五官与肩甲要看得清" },
        { "name": "side", "note": "侧面，交代松髻的体积与外套下摆长度" },
        { "name": "back", "note": "背面，肩甲接缝处要露出卷草纹" }
      ],
      "refs": [{ "asset": "detail-rosette", "role": "pattern" }],
      "notes": "三视图各是一条独立任务，台账按 asset_id+variant 记账"
    },
    {
      "id": "bg-snowpass",
      "class": "background",
      "name": "雪山隘口",
      "intent": "压迫感：人在山口很小，天很沉",
      "maturity": "locked",
      "design": {
        "space": "雪线以上的窄隘口，两侧岩壁夹出一条斜向通道",
        "light": "逆光，天光从山口上方压下来，雪面强反光",
        "weather": "细雪横飘，风从右侧来",
        "era": "无明确年代的边地气质",
        "mood": "冷、静、令人想退回去",
        "depth": "far"
      }
    },
    {
      "id": "prop-brass-lantern",
      "class": "prop",
      "name": "铜灯",
      "intent": "剧情关键道具：它灭了一次，故事就转向",
      "maturity": "reviewed",
      "design": {
        "form": "一手可提的矮胖灯笼，六棱，顶部有挂环",
        "material": "发暗的黄铜，铆接",
        "wear": "外壳有磕碰痕，一处铆钉换新过",
        "scale": "掌中到前臂之间",
        "function": "照明，也是「还剩多少油」的时间提示"
      }
    },
    {
      "id": "detail-rosette",
      "class": "detail",
      "name": "卷草纹",
      "intent": "识别标志：读者看到这条例卷就知道是她",
      "maturity": "locked",
      "design": {
        "motif": "单向卷草，三折一循环",
        "style": "几何化的硬边线",
        "density": "medium",
        "line_weight": "heavy",
        "palette": "单色，靠线宽分层",
        "use_on": "outfit"
      },
      "variants": [{ "name": "dense", "note": "密纹版只在大图用，低像素会糊成一团" }]
    }
  ],
  "notes": "合成 fixture：四类资产各一件，覆盖 variants / refs / maturity 三种状态。"
}
```

## 为什么这几件长成这样

- `char-linwan` 带三个 variants 且 `maturity: locked`：验「多变体各出一条任务」和「locked 才可当定稿母版复用」。
- `prop-brass-lantern` 是 `reviewed` 不是 `locked`：验 img-plan 会出警告（`ASSET_NOT_LOCKED`）但**不拦**——定稿推进是人的动作。
- `detail-rosette` 被 `char-linwan` 以 `refs` 引用：验描述唯一来源在被引资产，以及悬空引用会被点名（坏样例见 `comic-storyboard-bad.md`）。
