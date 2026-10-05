// 项目 id 边界判定（包内自持版——原宿主 panels.ts/safe-project.ts 同款实现，两宿主逐字等价，
// 2026-10-04 收编入包以消除双宿主 import 漂移：部署=纯拷贝，不再按宿主改 import）。
// project id 只许单段目录名——kernel.projectDir 是纯 join 不设防，../ 形态在这里堵下。
export function safeProject(project: string): string | null {
  return project && !/[/\\]/.test(project) && !project.includes("..") ? project : null;
}
