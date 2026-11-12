# 2026-11-06 · Embedding runtime 一键启动报「超时，没有写 discovery」

## 现象

用户点「向量记忆 → 一键启动 runtime + 模型」，弹出：

```text
✗ 运行时启动超时，没有写 discovery
```

同一时间 `~/.dsh/surfcore/plugin.log` 每 10 分钟记一次：

```text
向量记忆整理失败：vector.service-missing Embedding 服务发现文件不存在
```

## 取证（真机，dev4/dev6）

1. `~/.dsh/surfcore/embedding-packs/runtime/service.log` 内容是：

```text
'node' 不是内部或外部命令，也不是可运行的程序或批处理文件。
```

（bat 用控制台编码写，直接读是乱码，但这句能认出来。）

2. pack 的 `run.bat` 第一行就是 `node service.mjs`；本机 **node 不在系统 PATH**
   （DSH 用自带 node 运行，不会给子进程加 PATH）。
3. 用「把 node 目录加进 PATH」的方式手动跑同一个 `run.bat`：**1 秒**写出 discovery，
   `18765`（服务）与 `11435`（ollama）都起来。
4. 继续调 `startEmbeddingRuntime()`：模型注册 `bge-m3:latest` 成功，
   `testEmbeddingPack()` 返回 `selfTest:true / 1024 维 / 106ms` —— **底层链路完全正常**。
5. 手动起服务后，下一轮整理的报错从 `vector.service-missing` 前进到 `service.ollama-failed 502`
   （这一步只是因为手动启动跳过了模型注册；走一键启动会注册）。

## 根因

`plugins/surfcore/lib/embedding-packs.js` 的 `startEmbeddingRuntime()` 用
`spawn(entryPath, { env: runtimeEnv() })` 启动 **pack 自带的 run.bat**，而 `runtimeEnv()`
把 `process.env` 原样传给子进程。zip 用户机器上 `PATH` 里没有 node →
bat 第一行就失败 → 进程秒退 → 30 秒后前端只看到「超时」。

**不是模型包问题，不是模型没装，也不是端口占用。**

## 修法

1. `runtimeEnv()`：
   - `env.SURFCORE_NODE = process.execPath`（给包脚本一个显式入口，彻底不依赖 PATH）；
   - 把 `path.dirname(process.execPath)` 前置进 `PATH`（兼容 `PATH` / `Path` 两种键名）。
2. 启动超时的错误文案带上 `service.log` 最后 3 行，hint 直接点名常见原因
   （"node 不在 PATH / 端口被占 / 模型包损坏"）——失败必须可行动（AGENTS.md §1.7）。
3. 兜底 `plugins/surfcore/runtime/run.bat` 的入口文件名改为真实存在的 `embedding-service.mjs`。

## 影响面

- 只影响「没装过 node 的 zip 用户」首次一键启动 embedding runtime；
- 不碰用户数据、密钥；不改变已启动服务的路径（`serviceStatus().ok` 分支不变）。

## 验证

```powershell
node scripts/test-session-rollover.mjs   # 162 项（含 7 条本修复断言）
npm run test:audit                       # 152/152（合并后已重生成清单）
```

真机验证（临时手段）：把 node 目录加进 PATH 后跑 pack 的 `run.bat`，1 秒出 discovery；
`startEmbeddingRuntime()` → `registration ok`、`verified:true`、`dimension:1024`。

## 回滚

删除 `runtimeEnv()` 里新增的 3 段（SURFCORE_NODE / PATH 注入）与超时文案改动即可；
不影响任何持久化数据。

## 残余 / 未验证

- 修复后在 **dev7** 上要再验一次「一键启动 → 模型注册 → 整理成功 → 索引增长」全链路。
- 真机观察到 `向量记忆整理` 在 10:48 之后不再有 tick（10:58 缺失），
  需要开发机确认定时器是否被 10:52 的插件重载影响。
