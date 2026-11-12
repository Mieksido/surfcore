# 0.8.9-dev 发布交接：新架构硬切 + 旧 SurfCore 只做备份

> 收件人：发布会话  
> 目标：**硬切**到新架构，0.8.9 新 dev 只包含新内核 + 新大适配器 + 新宿主/新扩展。  
> 旧 bridge、旧宿主、旧 UI、旧兼容层**不进入新版本**，只作为备份和回滚材料。
> 执行原则：**先备份；然后删旧入口、上新宿主；不保留旧 bridge 兼容。**

---

## 0. 先说结论

```text
旧 SurfCore
  D:\deepseekwork\surfcore
  branch dev
  version 0.8.9-dev.1
  src/bridge.js + plugins/surfcore
  → 只备份，不再作为新版本入口

新架构
  D:\deepseekwork\surfcore-persona-core
  branch feat/persona-core-design
  kernel/ + runtime/ + packs/ + tools/
  → 0.8.9 新 dev 的唯一核心

新宿主
  core 之外重新写
  → 不是旧 bridge 的兼容层
  → 不 import 内核内部
  → 只做 kernel / runtime / packs 的接线
```

这次不是“新旧并存”，是：

```text
删掉旧入口
新宿主从零接管
旧 bridge 不发布、不启动、不 fallback
```

如果新宿主还没写完：

```text
测试机可以更新后不可用
这是硬切 canary 的预期风险
但不能把旧 bridge 留在包里当后路
```

---

## 1. 当前事实

### 1.1 新架构

```text
仓库：D:\deepseekwork\surfcore-persona-core
分支：feat/persona-core-design
提交：f7731ed
内核：61 文件 / 7,675 行
大适配器：8 文件 / 1,003 行
大适配器版本：0.3.0
大适配器哈希：d607d26dd5e27bd366dfeb36d56be1b66fac3a26
测试：93 个文件全绿
能力：27 模块 / 236 条（✅230 / 🟡3 / ⬜3）
```

验证命令：

```bash
cd D:\deepseekwork\surfcore-persona-core
npm run test:arch
node tools/platform-word-gate.mjs
node tools/core-check.mjs
```

当前结果：

```text
✅ 核心词面门禁：kernel/runtime 无平台/旧实现词
✅ core-check：核心 127 文件 / 14,340 行 / 平台包 0
✅ 93 个测试文件全绿
```

### 1.2 旧 SurfCore

```text
仓库：D:\deepseekwork\surfcore
分支：dev
版本：0.8.9-dev.1
DSH 入口：plugins/surfcore/lib/index.js
旧运行时：src/bridge.js
```

当前 `dev` 有未提交改动：

```text
M plugins/surfcore/lib/client.js      ← 本轮记忆页 UI 调整
M plugins/surfcore/docs/ui-*.png      ← 截图产物
```

发布会话必须先备份，再决定哪些 UI 截图要提交；**不要把无关截图混进发布 commit**。

---

## 2. 备份旧 SurfCore（先做，不可跳过）

### 2.1 停止写入

先停旧桥接，避免备份时状态还在写：

```powershell
cd D:\deepseekwork\surfcore
.\停止QQ机器人-全部.bat
```

如果 DSH 仍在运行，最好也停止对应插件实例，避免 `~/.dsh/surfcore` 继续写。

### 2.2 建备份目录

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "D:\deepseekwork\_backups\surfcore-pre-0.8.9-$stamp"
New-Item -ItemType Directory -Path $backup -Force | Out-Null
```

### 2.3 备份代码（含所有分支）

```powershell
git -C D:\deepseekwork\surfcore tag backup/pre-0.8.9-$stamp
git -C D:\deepseekwork\surfcore bundle create "$backup\surfcore-all.bundle" --all
git -C D:\deepseekwork\surfcore bundle verify "$backup\surfcore-all.bundle"
```

`--all` 会包含旧 `dev`、新架构分支、Codex 的 MC 分支等所有 refs。  
这是最重要的代码备份。

再复制两个工作区：

```powershell
robocopy D:\deepseekwork\surfcore "$backup\surfcore-worktree" /E /XD node_modules .git
robocopy D:\deepseekwork\surfcore-persona-core "$backup\persona-core-worktree" /E /XD node_modules .git
```

### 2.4 备份状态与配置

```powershell
robocopy C:\Users\Mieksido\.dsh\surfcore "$backup\dsh-surfcore" /E
```

同时备份：

```text
C:\Users\Mieksido\.dsh\profiles\web\cordis.patch.yml
C:\Users\Mieksido\.dsh\profiles\web\package.json
D:\deepseekwork\surfcore-ui
```

注意：

- 备份里有 token / API Key / 私钥，**不要提交到 git，不要发到公开仓库**。
- 备份目录 ACL 只给当前用户。
- 不要把备份放进 `release/` 或发布 zip。

### 2.5 校验备份

```powershell
Get-FileHash "$backup\surfcore-all.bundle" -Algorithm SHA256
(Get-ChildItem "$backup\surfcore-worktree" -Recurse -File).Count
```

恢复测试：

```powershell
$restore = "D:\deepseekwork\_backups\_restore-test-$stamp"
git clone "$backup\surfcore-all.bundle" $restore
git -C $restore log --oneline -3
```

恢复测试通过后，才能继续。

---

## 3. 硬切：删旧入口，换新宿主

### 3.1 旧入口不进入新版本

旧版本入口：

```text
plugins/surfcore/lib/index.js
  → src/bridge.js
  → 旧平台/记忆/语音
```

新版本入口：

```text
index.js              ← 根包宿主入口
client.js             ← 根包 UI（由 ui/client.js 构建复制）
ui/                   ← UI 源与构建脚本
  → createKernel
  → runtime.composeSystem
  → packs/<name>
```

处理规则：

```text
src/bridge.js                   只备份，不打包、不启动、不 fallback
plugins/surfcore/lib/index.js   旧入口，不打包
旧 UI / 旧兼容层                不打包
新宿主                          index.js（根包入口，不是第五层）
UI                              client.js + ui/
```

宿主不是第五层。它是组合根/外壳，只做接线，不写人格、不写平台业务。

### 3.2 新宿主职责

新宿主必须：

1. `createKernel(...)` 创建内核；
2. 发现并加载 `packs/` 中启用的包；
3. `composeSystem({ kernel, packs, allowlist })`；
4. 把平台事件送入 adapter；
5. 把内核意图交给小适配器 `send()`；
6. 提供 DSH 启动入口、设置/状态读取、日志和退出。

新宿主不许：

```text
import 内核内部文件
复制 runtime 内部实现
调用旧 src/bridge.js
保留旧入口 fallback
把旧 UI 挂回来
```

**不要改 `runtime/`。**  
宿主只能依赖 runtime 暴露的 `createAdapter/composeSystem/host`。

### 3.3 发布包必须删掉旧入口

发布前检查：

```text
src/bridge.js 不存在，或明确不在包内
plugins/surfcore/lib/index.js 不是入口
package.json main 指向 ./index.js
index.js 存在且能启动
client.js + ui/ 存在
kernel/ runtime/ packs/ 存在
```

验收命令建议：

```powershell
# 包里不应该有旧入口
Test-Path .\src\bridge.js
Test-Path .\plugins\surfcore\lib\index.js

# 包入口必须是新宿主
node -e "console.log(require('./package.json').main)"
```

如果旧 bridge 还在包里：

```text
删掉再打包。
不要用“先留着当后路”这种方案。
```

### 3.4 测试机硬切 canary

这次允许测试机直接覆盖，不等新宿主完整：

```text
只发测试机 / 手动包
不发稳定通道
不叫正式替换完成
必须保留外部备份
```

步骤：

1. 测试机先做完整备份（§2）；
2. 版本必须是 `0.8.9-dev.2`；
3. 构建后拆包确认：

   ```text
   kernel/
   runtime/
   packs/
   index.js
   client.js
   ui/
   没有 src/bridge.js
   没有旧 plugins/surfcore/lib/index.js
   ```

4. 测试机更新；
5. 更新后检查：

   ```text
   package.json 版本 = 0.8.9-dev.2
   kernel/ runtime/ packs/ index.js client.js ui/ 已落盘
   旧入口不存在
   新宿主是否启动
   DSH 是否加载新插件
   更新器有没有报“版本不变 / 清单不符”
   ```

6. 结果分两种，不要混：

   ```text
   覆盖更新成功 = 文件替换成功 + 更新器没报错
   架构接管成功 = 新宿主启动 + 旧入口不存在 + 真实事件走通
   ```

   新宿主没写完时，只允许报第一种。  
   测试机不可用是硬切 canary 的预期风险，不是回退到旧 bridge 的理由。

7. 出问题按 §5 用外部备份恢复测试机；发布包本身不提供旧 bridge 后路。


---

## 4. 发布分支与版本

### 4.1 不要直接改 dev

建议：

```powershell
cd D:\deepseekwork\surfcore
git switch dev
git tag backup/pre-0.8.9-$stamp
git switch -c release/0.8.9-dev.2 dev
```

### 4.2 合并新架构

```powershell
git merge --no-ff feat/persona-core-design
```

预期：

- `kernel/`、`runtime/`、`packs/`、`docs/persona-core/` 进入 release 分支；
- 旧 `src/`、`plugins/` 暂时保留作为宿主壳；
- 冲突只允许在文档/清单层解决；
- **不允许在冲突中改 `runtime/`**。

如果合并出现 `runtime/` 冲突：

```text
停手。
这说明有人改过冻结树。
先查 git log，不要强行解决。
```

### 4.2.1 旧宿主 UI 改动

旧 `dev` 工作区有未提交的记忆页 UI 改动：

```text
M plugins/surfcore/lib/client.js
M plugins/surfcore/docs/ui-*.png
```

发布前只提交明确的文件：

```powershell
git add plugins/surfcore/lib/client.js
git commit -m "feat(记忆 UI): 向量记忆前置；使用说明双 tab；叙事记忆下线提示"
```

截图产物是否入库由发布会话判断；不要把无关截图混进发布 commit。  
提交前看：

```powershell
git diff --cached --stat
```

### 4.3 版本号

当前旧版本：

```text
0.8.9-dev.1
```

新 dev 建议：

```text
0.8.9-dev.2
```

不要发 `0.8.9` 稳定版。  
不要重置成 `0.8.9-dev.1` 覆盖已发 dev。

发布前由用户在发布会话里确认版本号；编辑会话不 bump。

注意：

```text
package.json 的 0.8.9-dev.2 是应用版本
runtime/index.js 的 RUNTIME_VERSION=0.3.0 是适配器契约版本
不要把两者混在一起改
```

### 4.4 发布前必须通过

```powershell
cd D:\deepseekwork\surfcore
npm run test:audit
npm run test:regressions
npm run test:plugin
```

以及新架构：

```powershell
cd D:\deepseekwork\surfcore-persona-core
npm run test:arch
```

UI（已收进根包 `ui/`）：

```powershell
cd D:\deepseekwork\surfcore-persona-core
npm run build:ui
node --check client.js
```

单包清单：

```powershell
npm run pack:check
# 或
npm pack --pack-destination dist
```

DSH 真机：

```text
DSH 启动
插件加载
QQ 收一条 / 发一条
B站 tick / 发一条
记忆页能打开
语音试合成能出声
设置能保存
```

旧语音服务端口会干扰旧审计：

```text
8765 / 9880 在跑时，旧 audit 可能不是 153/153
审计前先停本地语音服务，审计后再启动
```

### 4.5 发布

按仓库 `docs/RELEASE.md` / `scripts/publish-dev.mjs` 走 dev pre-release。  
发布前必须得到用户明确确认：

```text
版本号
改动范围
影响谁
验证结果
回滚方式
```

不要自己 `--yes` 跳过确认。

---

## 5. 发布后验证

### 5.1 新架构

```text
kernel/runtime 词面门禁 0
core-check 平台包 0
93 测试全绿
```

### 5.2 DSH

```text
插件加载成功
旧 bridge 不再作为主路径
新组合根日志出现
QQ / B站 各一条真实消息
记忆读取模式正确
语音试合成正常
```

### 5.3 回滚

如果新组合根失败：

```text
停新宿主
切回 backup/pre-0.8.9-$stamp
恢复 ~/.dsh/surfcore 备份
重启旧 bridge
```

如果已发 dev pre-release：

```text
删除/标记该 pre-release
不要移动/覆盖旧 tag
```

---

## 6. 给发布会话的直接指令块

```text
你是发布会话。先不要发版。

第一步：备份旧 SurfCore
- 停 D:\deepseekwork\surfcore 的桥接
- git bundle create ... --all
- 复制工作区（含未提交 UI）
- 复制 C:\Users\Mieksido\.dsh\surfcore
- 复制 D:\deepseekwork\surfcore-ui
- 校验 bundle / 做一次 clone 恢复测试
- 备份含密钥，禁止进 git / 公开发布物

第二步：接新架构
- 新架构在 D:\deepseekwork\surfcore-persona-core
- 分支 feat/persona-core-design，提交 f7731ed
- 包版本 0.8.9-dev.2；`dist/surfcore-0.8.9-dev.2.tgz` 已生成
- 大适配器 runtime/ 冻结在 0.3.0 / d607d26d...
- 不许改 runtime/
- 建 release/0.8.9-dev.2，从 dev 合并 feat/persona-core-design
- 写新组合根，把 kernel + runtime + packs 接进 DSH
- 如果 DSH 仍走 src/bridge.js，就不算替换，不许发“已替换”

第三步：验证
- 新架构 npm run test:arch 全绿
- 旧 audit / regressions / plugin 通过
- DSH 真机 QQ + B站 + 记忆 + 语音 + 设置
- UI build + smoke

第四步：发 0.8.9-dev.2
- 发 pre-release，不发 stable
- 发布前向用户确认版本号/范围/验证/回滚
- 不发假替换版

第五步：回滚预案
- 保留 backup/pre-0.8.9-* tag
- 保留 bundle + ~/.dsh/surfcore 备份
- 新宿主失败立即切回旧 dev
```

---

## 7. 相关文档

- 外部扩展开发者交接：
  [EXTENSION-HANDOFF.md](EXTENSION-HANDOFF.md)
- 架构景观：
  [ARCHITECTURE-MAP.md](ARCHITECTURE-MAP.md)
- 发布纪律：
  [../RELEASE.md](../RELEASE.md)
- 会话日志：
  [SESSION-LOG.md](SESSION-LOG.md)

---

## 8. 最后一句

**备份不是可选项；组合根不是可选项；真机验证不是可选项。**

新架构可以替换旧架构，但必须是：

```text
旧代码有备份
新组合根真的接管
DSH 真的走新路径
验证真的通过
```

否则只是把两套东西放在同一个包里，不是发布。
