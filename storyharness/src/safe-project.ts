// 项目 id 边界判定（前端切割后自 panels.ts 迁入的唯一幸存件）。
// project id 只许单段目录名——kernel.projectDir 是纯 join 不设防，../ 形态在这里堵下。
// serve.ts 的会话 API、packgate.ts、auth 判定共用同一把钥匙（禁止多处各写一份越界规则）。
export function safeProject(project: string): string | null {
  return project && !/[/\\]/.test(project) && !project.includes("..") ? project : null;
}
