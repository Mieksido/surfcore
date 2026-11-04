import path from 'node:path';

export const BILI_WORKSPACE_TITLE = 'B站生物钟';

/** B站生物钟专用工作区：不再用用户主目录，缩小 cwd/文件工具的爆炸半径。 */
export function biliWorkspacePath(dshHome) {
  return path.join(String(dshHome ?? ''), 'surfcore', 'state', 'bili-agents');
}

/**
 * DSH 的 session.create 里 workspaceId 与 cwd 互斥：
 * - 有 workspaceId：会话归属工作区，侧边栏正常分组；
 * - 没有工作区服务时：退回专用 cwd，至少不落回用户主目录。
 */
export function biliSessionCreateParams({ workspaceId, cwd, agentPreset } = {}) {
  const preset = String(agentPreset ?? '').trim();
  if (workspaceId) return { workspaceId, ...(preset ? { agentPreset: preset } : {}) };
  return { cwd, ...(preset ? { agentPreset: preset } : {}) };
}
