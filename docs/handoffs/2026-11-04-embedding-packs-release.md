# 交接：向量记忆 + 四个 Embedding 包发布

日期：2026-11-04
分支：`feat/vector-memory-impl`
代码 HEAD：见分支 HEAD（本文件所在提交）
目标：协调会话合并到 `dev`；四个 zip 由用户上传 GitHub / 云盘；设置页填链接后测试机导入。

## 1. 先合代码

```powershell
cd D:\deepseekwork\surfcore
git checkout dev
git merge --no-ff feat/vector-memory-impl
node scripts/release-manifest.mjs
git add release/install-manifest.json
git commit -m "chore(release): sync manifest after vector memory merge"
npm run test:audit
```

- 分支已包含 `dev 82addb7`，无落后；
- 合并后必须从**合并后的 HEAD** 重新生成 `release/install-manifest.json`；
- 四个包**不在仓库、不在安装清单**，不要试图把 zip/权重提交进 SurfCore。

## 2. 四个 zip（用户上传 GitHub / 云盘）

目录：`D:\deepseekwork\surfcore-embedding-packs\dist\`

| 文件 | 大小 | SHA256 |
| --- | --- | --- |
| `surfcore-embedding-runtime.zip` | 29.3 MB | `54131dc6d42f77dcb1397b5f9e80d03b3a0645f781a40070d13cd94210f88d40` |
| `bge-small-zh-v1.5.zip` | 46.1 MB | `ed116aaab092ec181119619508a9304807f0b69fb8cbaaeabc461f88ffa91106` |
| `qwen3-embedding-0.6b.zip` | 609.6 MB | `8d67672c7214846de18af7c029a92e54527b9ac67a331fa484c92be8e8d691a0` |
| `bge-m3.zip` | 1104.2 MB | `a2b187719a364d148a7c437c29866c29989223e9714d71cbeff89d0dfe8d69a1` |

上传方式二选一：

- GitHub：建一个 release/tag（例如 `embedding-packs-v1`），四个 zip 作为四个 asset；
- 云盘：四个文件放同一目录，设置页分别填链接。

> 云端包不在这四个里：它没有权重，只是 endpoint/model/space + key，设置页直接配置即可。需要独立“云端包 zip”时再单独生成，体积 <1 MB。

## 3. 设置页填链接

设置 → 记忆 →「Embedding 功能（可选安装）」→「三个本地向量记忆模型」：

- 每个模型一行：网盘链接输入框 + 「打开网盘」+「导入 zip」；
- 填完链接点页面底部「保存」；链接存在 `vectorMemory.packLinks`；
- 用户导入顺序：**先 runtime，再模型**；
- 导入文件必须严格匹配：
  - `bge-small-zh-v1.5.zip`
  - `qwen3-embedding-0.6b.zip`
  - `bge-m3.zip`
- 导入时会校验文件名/SHA256，并提示“请选择 xxx.zip”；不要解压到 SurfCore 目录。

## 4. 测试机验收顺序

1. 设置页安装 `surfcore-embedding-runtime.zip`；
2. 安装任一模型 zip（低配先 bge-small）；
3. 「选择」该模型 →「启动」运行时；
4. 状态显示 `已安装 / 使用中 / 服务就绪`；
5. QQ 发一条能命中旧事的消息，确认 `【想起的旧事】`；
6. 换模型需点「重建索引」。

## 5. 已验收 / 未验收

已验收（本机，无系统 Ollama）：

- runtime 自带 Ollama CPU，启动后自动注册模型；
- bge-small 512 维、qwen3 1024 维、bge-m3 1024 维，L2=1；
- 安装 → 选择 → 启动 → 检索 → 停止 → 卸载；
- zip 安装、目录安装、SHA 校验、坏包可见；
- 云端 mock provider 路由与 key 掩码。

未验收：

- 全新 Windows VM；
- 真实云端 key；
- GPU 加速包；
- GitHub/云盘的实际下载链路（需要用户上传后回填链接再测）。

## 6. 用户回填链接后

把四个链接填进 `vectorMemory.packLinks`（设置页输入框或 `config.json`）：

```json
{
  "vectorMemory": {
    "packLinks": {
      "bge-small-zh-v1.5": "https://…",
      "qwen3-embedding-0.6b": "https://…",
      "bge-m3": "https://…"
    }
  }
}
```

填完不需要改代码、不需要重新打包 SurfCore；链接只存在本机配置。

## 7. 合并请求

```text
【合并请求】
分支：feat/vector-memory-impl
commit：见 HEAD
范围：向量记忆 + Embedding 按需安装包（runtime 自带 Ollama CPU、模型自动注册、cloud 配置、三模型网盘链接/导入 UI）
测试：test:audit 151/151；plugins/surfcore npm test 通过；无系统 Ollama 下三模型真实 embedding
包：四个 zip 见 docs/handoffs/2026-11-04-embedding-packs-release.md；不进 install-manifest
风险：干净 Windows VM / 真实云 key / GPU 加速未验；模型切换需手动重建索引
回滚：卸载包（quarantine）/ 关闭 vectorMemory.enabled / 回退分支
```
