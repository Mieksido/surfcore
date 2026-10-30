// Safe audit suite: fixtures and mocks only, never production QQ/DSH.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const tests = [
  'test-audit-bridge.mjs', 'test-audit-protocol.mjs', 'test-audit-protocol-helpers.mjs',
  'test-audit-security.mjs', 'test-audit-security-mcp.mjs',
  'test-audit-setup.mjs', 'test-audit-setup-guards.mjs',
  // DSH 会话队列（inbox 投影）解析：0.2.0 把队列从 control baseline 的
  // `value.queues[<id>]` 挪进了 `value.projections[<id>].values.inbox`。
  // 认错形状的后果不是"少清几条"，而是**每一次退役会话都抛错**、旧任务继续跑，
  // 且只留下一行日志 —— 必须有登记期断言钉住（活 DSH 侧的实测见
  // scripts/test-dsh-session-retire.mjs）。
  'test-dsh-inbox-projection.mjs',
  'test-md-to-plain.mjs', 'test-slang-learn.mjs', 'test-mux-reconnect.mjs',
  // DSH 端口漂移兜底：401/200+SERVER 才算 DSH、别的 Web 服务不算、回环之外不覆盖。
  'test-dsh-port.mjs',
  // 鱼群保护：QQ 的鱼名/密度/连续刷屏判定 + B站的鱼楼层/聚拢/点赞纯逻辑（不发真请求）。
  'test-fish-guard.mjs',
  // QQ 鱼群触发记录：social-v2 的 fishGuardLog/当前冷却/lastFishGuard → 设置页表格。
  'test-qq-fish-guard.mjs',
  // 人的黑名单（deny.users）：无论在哪个群/私聊都不响应；拦截点必须早于入库与唤醒，
  // 且旧控制台保存白名单时不得清空它（2026-10-23 用户要求）。
  'test-blacklist.mjs',
  // 跨平台自我识别 + 来源判断：转发聊天记录不能被说成 B站 内容；B站 侧要认得出
  // 自己的 QQ 资料卡（QQ 号打码）；桥接落的 self-identity.json 能被插件读到。
  'test-self-identity.mjs',
  // 早安问候：08:00 重启丢枪的补发/重试逻辑 + reserved2 必须真调发送工具的提示词。
  'test-greeting.mjs',
  // 出站身份闸：B站 评论/私信/动态/分享发送前拦主人/别人的账号标识（只许自己互认）。
  'test-identity-guard.mjs',
  // 观看历史：追加/去重/轮转/旧记忆回填/评分合并，以及 debrief·watch·角色迁移的接线契约。
  'test-watch-history.mjs',
  // 观看历史的「操作」：评论分类（主评论/鱼群聚拢/回复/搭话）、收藏、动态、挂到哪次观看。
  'test-watch-actions.mjs',
  // B站 选题器：偏好权重/配额/轮转搜索/去重（含观看历史）纯逻辑。
  'test-feed-core.mjs',
  // 「一键抓取偏好关键词」：抽词/停用词/标签直取/包含合并/已有偏好排除。
  'test-pref-scan.mjs',
  // B站 扫码登录：鱼号/主人号归属校验（不能互相覆盖、新用户可绑定）。
  'test-bili-qr-login.mjs',
  // B站 每日分享 → 自己的动态：和四类动态共用 daily-dynamic.json，至少隔 gapMin 分钟。
  'test-share-dynamic.mjs',
  // 生物钟 C：每窗至少 1、全天 ≤12、相邻最小间隔、skip 不结束全天、错过不补。
  'test-night-schedule.mjs',
  // Token 防爆破：每天唤醒上限、私聊更紧、最小间隔、单次发送条数、近 24h 花费。
  'test-token-guard.mjs',
  // QQ 空间说说（默认关闭）：开关/字数/敏感信息/图片协议/权限/每日上限/最小间隔，
  // 以及桥接端点、SnowLuma send_qzone_msg、MCP 工具与设置页字段的接线。
  'test-qzone-post.mjs',
  // 每日 token 额度：单位解析（¥8 / 8M / 2万）、双单位比例、80% 每天只提醒一次、
  // 额度文件损坏回落默认、当天/跨天文件语义（纯逻辑 + 插件 session/event 采集）。
  'test-token-budget.mjs', 'test-token-budget-service.mjs', 'test-token-budget-bridge.mjs',
  // 上线补历史消息（socialV2.history）：默认开、水位/去重/黑名单、桥接启动补看离线消息、
  // history 唤醒提示与快照标记（VM 夹具网关，不连真 QQ）。
  'test-history-catchup.mjs',
  // 目的机制（主动找主人）：从近期 QQ+B站 记忆提炼目的、安静时段/每日上限/重试/去重，
  // 以及真实 bridge.js 里的预览/投递/发送回执/回合回执接线（VM 夹具，不连真 QQ）。
  'test-purpose-engine.mjs', 'test-purpose-wiring.mjs',
  // 对话收尾判断：自己/对方继续意愿、话题闭环、未答提问先答、收尾≠潜水、
  // 冷却只压普通概率唤醒；以及真实 bridge.js 的 close 接口/提示词/重开接线
  // （VM 夹具，不连真 QQ）。
  'test-conversation-closure.mjs', 'test-closure-wiring.mjs',
  // 平台启动开关：QQ/B站 各自「是否启动」的唯一真相 + 旧 bridge.autoStart 迁移
  // （2026-10-24 用户要求；只碰临时 DSH_HOME，不启停真实桥接）。
  'test-platform-start.mjs',
  // B站 会话权限：workspace-write 在 C:\Users\Mieksido 起不了命令 → 自动切 danger-full-access。
  'test-scheduler-permission.mjs',
  'test-token-economy.mjs', 'test-qq-model-view.mjs', 'test-qq-preset-contract.mjs',
  'test-reply-wait.mjs', 'test-preset-prompt.mjs', 'test-role-card.mjs',
  // 管理员身份（QQ ⇄ B站 同一个人）+「对管理员温柔 / 绝不回嘴」提示词：
  // 号码规范化、旧字段推导、保存冲突、QQ/B站 两份提示词（B站 不得带 QQ 号）；
  // 以及真实 bridge.js 源码里的接线（唤醒 / 角色提示 / 消息标记）。
  'test-admin-identity.mjs', 'test-admin-prompt-wiring.mjs',
  // 记忆卡：重要度评分 / 主人锚点 / 每日模糊与遗忘 / 80·90·100% 容量 / 提示词裁剪 / 隐私 scope。
  'test-memory-card.mjs', 'test-memory-card-wiring.mjs',
  // 角色人格：多角色目录隔离 / 切换 epoch / 快照回档 / 旧数据迁移（含凭证不进角色包）。
  'test-character-store.mjs',
  // B站 工具链路径：有角色时行为账本进角色包，cookie/表情包仍在账号目录。
  'test-bili-state-paths.mjs',
  // 体检修复回归：无令牌智能体调用面、send-burst 失败回滚、唤醒限频重试、
  // 定时器类暂存唤醒补发、collector 生命周期、ownerQQ 覆盖语义、预设名校验、
  // wake triggers 白名单、memory-update 边界、wait 租约归一化、md/黑话/表情/账本；
  // 本轮新增：/api/send/* 失败路径的作用域错误（R15）、reserved2 落库丢表情识别字段（R16）。
  'test-audit-regressions.mjs',
  // 表情语义层：编号分配、情绪识别、本地注意力编码、语境匹配、注入文本；
  // 以及表情库/工具面接线（编号可当 stickerId、收藏时带 emotion/content）。
  'test-sticker-semantics.mjs', 'test-stickers.mjs',
  // 图片/表情链路（动图/表情包字段、CDN 优先与 emoji_id 兜底）+ 联网搜索
  // （DSH 同一路 DeepSeek 搜索、Bing RSS 兜底、凭据优先级与端点安全；
  //  本轮新增：空结果 note 必须在写缓存之前生成，否则缓存命中丢掉提示）。
  'test-media-search.mjs',
  // GitHub issue 回归：#22 模式 user 层优先 / #11/#19 回合判忙租约 / #29 机器人身份注入。
  'test-issue-regressions.mjs',
  // 二代「会话初始提示词」：只在首次唤醒注入、管理面隔离、损坏文件只读降级、
  // 以及控制台「立即唤醒」不得顶掉首次 bootstrap（否则初始提示词永远发不出去）。
  'test-v2-initial-prompt.mjs',
  // 令牌账本 / 价目表 与 体检修复回归（纯函数，无外部依赖）
  'test-token-usage.mjs', 'test-hardening.mjs',
  // 语音发送（纯函数 + 端点存在性；真发语音只在 --live 或 CLI 里做）
  'test-voice.mjs',
  // 音量：参数校验 + 真的调用 ffmpeg 调音量 + 自算 RMS 验证增益
  'test-voice-volume.mjs',
  // 边界：并发/异常输入/上传限额/越权（纯函数段 + 可选的 live 段）
  'test-voice-edge.mjs',
  // 语音图形界面（参数解析/鉴权/路径穿越/文件名净化；live 段需普通终端）
  'test-voice-gui.mjs',
  // 控制台静态契约（跑不了 Playwright 的环境下的替代回归）
  'test-console-static.mjs',
  // 语音系统整体结构检查（入口/依赖/端点/开关/文档一致性）
  'test-voice-system.mjs',
  // 本地 TTS 客户端（落盘复用 / 502 detail / 服务未启动 / wav 头算时长）
  'test-voice-tts.mjs',
  // 真实 bridge.js 的 text→TTS→record 链路（假网关 + 本地假 TTS，不发 QQ）
  'test-voice-route.mjs',
  // SnowLuma 账号/token 自发现（换 QQ 账号后 token 会变，写死的工具会 401）
  'test-snowluma-conn.mjs',
  // 启动器与编码（乱码根因：.cmd 里的非 ASCII 会被 cmd 按 ANSI 解码）
  'test-encoding.mjs',
  // 控制台乱码机制（UTF-8 字节被按 GBK 解码）+ chcp 修复
  'test-console-encoding.mjs',
  // 🔴 铁律 L7（仿真会话不得拥有本地执行能力）：注册期断言——
  //    preset 挂了守卫、守卫的 restrict 名单覆盖全部已知本地工具、且执行期一律拒绝。
  //    这是唯一挡住"绕过桥接直连 OneBot HTTP"的东西（见 QSH_PLAN.md §0.1/§5.2），
  //    所以必须在每次回归里跑，而不是一次性验收。
  'test-preset-local-tools.mjs',
  // qq-mode-console 的 settings 契约：0.2.0 删除了 ctx.settings.register()，
  // 命名空间改为由 loader entry id + 导出的 Config 推导。断言三点前提都在，
  // 并且那条已删除的 API 不会被照旧注释加回来。
  'test-qq-mode-plugin.mjs',
  // SnowLuma 上游健康（被误诊成「qq-bridge 注入失败」的那个失败形态）：
  //   · good 必须取自心跳 status.good / get_status —— 取自 get_login_info 会**静默失效**
  //     （SDK 不校验 data 载荷，good 会永远停在 null，整条权威信号变成死分支）；
  //   · 静默检测不得冒充 hook 检测（心跳是 SnowLuma 本地定时器无条件发的）；
  //   · 客户端库版本不得低于 bot_status 出现的版本。
  'test-snowluma-upstream-health.mjs',
  // B站分享卡片（PITFALLS #22）：B站小程序在 QQ 侧下架，默认必须是
  // com.tencent.structmsg 链接卡；旧 card:true 不能继续发下架的小程序卡。
  'test-bili-card-ark.mjs',
  // preset 装配防漂移（2026-10-26 审计补登）：bundle patch（plugins/surfcore/presets/*.patch.yml）
  // 必须与权威源 dsh/agent-presets/<preset>/ 逐字一致，且守卫行只用「profile 可解析」的裸说明符。
  // ⚠️ 这条以前**不在任何门禁里**（也没有 npm script），结果 qq-chat-v2.patch.yml 悄悄落后于源：
  // 工作树里的源已经有「对话收尾」段，装进 DSH 的那份没有。教训见 PITFALLS #71。
  'test-agent-preset-patches.mjs',
  // 插件 → 核心模块的引用一致性（PITFALLS #68）：`?rev=` 必须三处一致、不许裸引用，
  // 并把"改了热重载也不生效"的核心模块清单打出来（2026-10-26 新增）。
  'test-core-rev-sync.mjs',
  // 隐私扫描的判据本身（2026-10-26）：编译出的正则必须带 g —— 否则每条规则每个文件
  // 只看到第一个命中（fail-open），还会空转成"扫描不完整"。PITFALLS #74。
  'test-privacy-scan.mjs',
  // 语音包默认安装源（2026-10-26）：必须从仓库位置解析、不许硬编码盘符，
  // 且 8765/8767 两个端口与启停脚本名不能漂移（语音路由全靠它们）。
  'test-voice-packs-default.mjs',
  // 离线语音包导入：校验/复制/配置保留/pyvenv 改写/回滚边界（临时夹具，不碰真实包）。
  'test-voice-pack-import.mjs',
  // 云端语音包凭据边界（2026-10-29）：新装必须清空预置的火山 AppID/AccessKey，
  // 重装保留用户自己填的；没配好时 start() 要拒绝并指路（PITFALLS #79）。
  'test-voice-cloud-credentials.mjs',
  // 主人提问回答编码（2026-10-29）：DSH 单选不允许 selected+custom 并存 →
  // 单选走 custom-only、多选保留 selected；[仅主人] 只收窄谁能答，不是授权凭证。
  'test-question-answers.mjs',
  // 主人特权操作审计（2026-10-29）：1MB×5 轮转、跨文件读尾、写入失败可见、90 天清理。
  'test-owner-audit.mjs',
  // 检查更新三态（2026-10-29 事故）：无 git / 无安装记录时按版本号判断；
  // 取不到远端版本号必须是 unknown，不能显示"最新"。
  // 语音三闸门 + 配置双写（2026-10-29 复盘）：工具常注册、拒绝带 code/hint、保存带戳防覆盖。
  // 安装清单只能含 git 跟踪文件（2026-10-30：脏清单导致 zip 更新 100% 失败）。
  // 语音失败分类/换路/自检接线（2026-10-30 P0+P1）。
  'test-voice-diagnostics.mjs',
  'test-release-manifest.mjs',
  'test-voice-gates.mjs',
  'test-update-apply-result.mjs',
  'test-update-version-fallback.mjs',
  // 版本号单一真相：根/插件 package.json 一致、无硬编码、CHANGELOG 有当前版本。
  'test-version.mjs',
  // 插件冲突体检：已知第三方工具是否被 QQ 策略拒绝、压缩接管冲突、未知插件必须标 unknown。
  'test-plugin-compat.mjs',
  // 闸门事件中心 + 单轮止血：L0-L3 分级、去重/确认、步数/重复错误/预算熔断。
  'test-gate-events.mjs',
  // SnowLuma 断线/发送失败暂停：主动唤醒不得创建 DSH 会话（零 token）。
  'test-snowluma-channel-gate.mjs',
  // B站分享去重：新鲜池空时不得回退旧素材（2026-10-26 修复的"同一条反复发"）。
  'test-bili-share-dedup.mjs',
];
let failed = 0;
for (const test of tests) {
  console.log(`\nRunning ${test}`);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', test)], {
    cwd: root, stdio: 'inherit', timeout: 60000,
    env: { ...process.env, QQ_BRIDGE_TEST_LIVE: '0' },
  });
  if (result.status !== 0 || result.error) {
    failed++;
    console.error(`FAILED ${test}: ${result.error?.message || `exit ${result.status}`}`);
  }
}
console.log(`\nAudit suite: ${tests.length - failed}/${tests.length} scripts passed.`);
process.exitCode = failed ? 1 : 0;
