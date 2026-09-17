import type { TaskPackage } from "./types.js";

/**
 * K2 派发头：任务包 → 规范 spawn 文本，宿主复制即用。
 * 解决派发质量分析 R1 的总根因：宿主手写「必读路径清单」绕过任务包，子代理被迫考古拼背景。
 * 宿主 SOP：spawn prompt = 本函数输出原样；交卷摘要首行四要素复述不符即弃稿。
 */
export function renderSpawnPrompt(pkg: TaskPackage): string {
  const parts: string[] = [];

  const prof = pkg.profile;
  if (prof) {
    parts.push(`【角色】${prof.title}（${prof.role}）${prof.mission ? `\n${prof.mission}` : ""}`);
    if (prof.journalReadPolicy) {
      parts.push(`【上下文隔离】${prof.journalReadPolicy}——违反即无效产出`);
    }
  }

  if (pkg.background) {
    parts.push(`【项目背景】\n${pkg.background}`);
  }

  parts.push(
    `【工具纪律】仅允许 Read / Write / WebSearch；禁止 git 操作、禁止创建定时任务或后台进程、禁止操作本工作集之外的任何路径。`,
  );

  parts.push(`【工作指令】\n${pkg.instruction.text}`);

  if (pkg.context.length) {
    const refs = pkg.context.map((c) => `- ${c.ref}（指纹 ${c.hash ?? "无"}${c.truncated ? "，摘录已截断，可按路径读全文" : ""}）`).join("\n");
    parts.push(`【上游依据】\n${refs}`);
  }

  if (pkg.knowledge?.length) {
    const kitLine = pkg.kitRef ? `（域：${pkg.kitRef.domain} / ${pkg.kitRef.kit}.${pkg.kitRef.op}）` : "";
    const cards = pkg.knowledge
      .map((c) => `- ${c.id}${c.truncated ? "（已截断）" : ""} → ${c.path}`)
      .join("\n");
    parts.push(
      `【判定标尺${kitLine}】以下硬条款已注入工作指令，交付前逐条对照并在摘要中回答「是否有违反」：\n${cards}`,
    );
  }

  parts.push(
    [
      `【交卷】`,
      `- 产物写入：${pkg.outputContract.file}（UTF-8 Markdown）`,
      `- 文件首部必须是 artifact@1 头部（缺头部 = 内核 block 拒收）。模板：`,
      "```yaml",
      ...(pkg.headerTemplate ?? "---\nartifact: 1\n...\n---").split("\n"),
      "```",
      `- 正文只放内容：头部之后 = 「# 标题」+ 一行「> 摘要（≤60 字，说结论）」，然后空行、正文。`,
      `- 正文禁止复述轮次/上游清单/审核背景（它们归头部）；禁止以「思考/让我/用户说」开头；禁止贴工具日志（>3 行须落 内部/收据/）。`,
      `- 交卷摘要首行必须复述四要素：项目 / 阶段 / 交付物 / 受众——不符即弃稿`,
      `- 不要在回话里贴产物全文，摘要 ≤10 行`,
    ].join("\n"),
  );

  parts.push(
    `【禁止】读取 projects/_archive*/ 与其他项目目录；读取上游依据之外的仓库文件前先确认必要；任何 git 命令。`,
  );

  return parts.join("\n\n");
}
