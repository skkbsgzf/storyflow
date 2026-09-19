# 创作者工具箱（kit）

本目录是**你项目的工具链副本**——改坏了就删掉重 vendor，改顺手了就是你自己的版本。

## 常用命令（在项目根运行）

    python kit/check-purity.py <project>        # 产物正文纯净度检查
    python kit/worldbook.py tree <project>      # 世界书结构树
    python kit/worldbook.py check <project>     # 世界书一致性
    python kit/export-doc.py <src.md> <out.docx> --plain   # md → docx（需 pip install python-docx）
    python kit/snapshot.py capture <flow> <project> <node> --files <f>   # 快照留档
    python kit/serve.py 8426                    # 本地预览（项目根）

## 版本自治

- `kit.json` 记录每个文件拷贝时的上游指纹；
- `python tools/kit.py status <project>` 看哪些改过、哪些上游有更新；
- `python tools/kit.py diff <project> <file>` 看差异；**更新与否由你决定，上游不自动覆盖**。
