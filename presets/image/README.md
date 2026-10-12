# presets/image · 生图后端的声明面（画像 / 图模板 / 加速件签名）

这一目录是「用户手里可以是任意 ComfyUI 版本 + 任意生图模型」的接口面。加一种后端 = 加一份画像 + （形状不同再）加一份图模板，**不改代码**。契约唯一事实源在 `contracts/`：`image-profile@1` / `image-job@1` / `image-receipt@1` / `engine-capability@1`，上游设计件是 `storyboard@1` / `asset-design@1`，产物账是 `asset-registry@1`。

## 目录

```
presets/image/
  profiles/                 后端画像（这台机器这套模型怎么出图）
    qwen-image-2-1-comfyui.json     实测形状（Qwen-Image 2.1 · int8 底座 + w4a8 文本编码器）
    generic-sdxl-comfyui.json       通形（CheckpointLoaderSimple 单件；能力位保守关着）
  graphs/                   ComfyUI API 格式图模板（节点级声明件）
    comfyui-qwen-t2i.json
    comfyui-qwen-ref-edit.json      带参考图的编辑链（跨格保身份母版）
    comfyui-sdxl-t2i.json
  acceleration.json         加速件签名表（「识别加速模型」的数据面）
```

## 画像的填写规矩

- `<必填:...>` 是占位串，**出厂画像里全是占位**：模型名、地址属用户环境值，写进仓库就等于把某个人的机器抄进 kit（发布口径禁止）。`tools/img-plan.py` 遇到未填的 `<必填` 会整包拒绝并点名旋钮（`unresolved: PROFILE_SLOT_UNFILLED`），不会拼出一张注定失败的图。
- 真实值放哪儿：用户侧画像或值放 `.external/`（不入库）；`secrets` 段只许写环境变量名或 `.external` 键路径，**任何画像文件都不许出现凭据值**。
- `engines.<档>` 是档位表不是分支代码。加速档靠 `accelerator` 引用 `acceleration.json` 的条目名，`node_patch` 覆写节点输入。
- **`node_patch` 只放「同一档位在不同模板都要成立」的覆写**。它按节点 id 打补丁，而节点 id 是模板局部的：`comfyui-qwen-ref-edit.json` 的 5 号是 `QwenImage21Cache`，t2i 模板里根本没有 5 号——在画像里补丁会对着另一张模板报 `NODE_PATCH_TARGET_ABSENT`（出厂画像曾因此白报 7 条）。缓存节点 `device: off` 这类**形状自带的纪律，写在模板里**（模板出厂即钉好），别在档位里重复一遍。
- `budget` 里的数是**护栏预检输入**，不是隐形闸：越界就显式失败并点名要人覆写的旋钮，绝不静默缩图、降步数、换模型。缺实测依据的数值留 `null`，别抄别人的数字当自己的默认。
- `provenance.receipts` 要指到真收据文件。像 `≈8.6×` 这种数字，出处是 16GB 单卡 + int8 底座的实测，换硬件不可比——所以它进签名表时 `measured` 与 `provenance` 必须成对出现。

## 图模板的槽位约定

槽位写成 `__UPPER_SNAKE__` 形式的字符串值。`img-plan` 的替换是**类型感知**的：

- 槽位独占整个值时按目标类型写入（`__STEPS__` → 数字 6，`__REF_1__` → 字符串，`images` 一类结构由模板自己写死，不靠字符串拼）；
- 槽位嵌在长字符串里时做文本替换（用于文件名前缀这类拼接）。

三个来自实测的坑，写在模板旁注里（模板改动了就得同步这里）：

1. **`TextEncodeQwenImage21.images` 必须是嵌套字典** `{"image_1": ["6", 0]}`。写成扁平键 `image_1` 能过 `/prompt` 校验，但执行期 TypeError——报错点离病因很远，白跑一轮冷加载（冷税 460–1500s）。
2. **该节点的第三个输出（slot 2）就是 latent**，编辑链要把 `KSampler.latent_image` 指到 `["4", 2]` 并**删掉** `EmptyLatentImage`。另挂空 latent 会丢参考图身份，表现为「人物像但换了个人」。
3. **`QwenImage21Cache.device` 出厂钉 `off`**（写在模板里，不靠档位补丁）。改成常驻会顶高基线显存，配合并发就进分页地狱；要开必须先按 `img-probe` 的 `guardrail_read` 看余量。
4. **参考图槽的数量就是这张模板能吃几张参考图**，`img-plan` 按**结构**扫 `__REF_1__..__REF_8__` 得出容量，两头都显式失败：槽位空着没人喂 → `REF_SLOT_EMPTY`；分镜表给的 refs 比槽多 → `REF_SLOT_OVERFLOW`。后者绝不能「只喂前 N 张」——实图与提示词/指纹/收据就对不上了，正是本仓最贵的半接状态。要喂 3 张就换一张有 3 个 `LoadImage` 的模板，别改代码。

## 模板可用性怎么判

`img-plan` 只按画像声明拼装，**不假设**引擎里真有这些节点。节点齐不齐由 `tools/img-probe.py`（B 批）实测出 `engine-capability@1`：`nodes_missing` 非空就意味着该模板不可用，plan/执行侧据此拒绝，而不是试试看。

## A 批两个确定性件怎么跑（零网络、零写盘）

```bash
# 分镜表 + 资产表 + 画像 → 任务包（--check 只算不落盘）
python tools/img-plan.py --storyboard <分镜表.md> --assets <资产表.md> --profile <画像.json> --check
python tools/img-plan.py --selftest     # 契约对齐 + 出厂画像逐个拼得出合法图 + 坏例必须点名

# 设计件 ↔ 任务 ↔ 产物文件 ↔ 收据 四方对账 → 资产台账
python tools/img-assets.py build --job <image-job@1.json> --receipts <收据目录> \
        --assets <资产表.md> --storyboard <分镜表.md> [--check]
python tools/img-assets.py --selftest
```

两件的退出码都只反映**账目完整性**（有 unresolved 就非零），不反映画面好坏；`--check` 全程不写盘，适合接在门后当预检。真值（模型名/地址）没填时 `img-plan` 直接拒绝整包并点名旋钮，不会产出「看着能跑」的包。

## 为什么不用一份「通用模板」

不同模型的图**不同形**：Qwen 线的文本编码节点自带 negative 与 latent 输出，SDXL 线是两个 `CLIPTextEncode` + 空 latent。在 TS 里硬拼必然漂移——现状 `storyharness/packs/deduce/engine/deduce-images.ts:35-46` 就是一份与实测脚本已经长得不一样的硬拼副本，本目录的存在理由就是把这类形状从代码里挪进声明件。
