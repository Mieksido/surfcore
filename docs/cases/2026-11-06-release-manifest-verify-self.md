# 2026-11-06 · release-manifest --verify 读错清单（用本机旧清单核对新包）

## 现象

对新版本解压目录执行：

```text
node scripts/release-manifest.mjs --verify <dev12目录>
→ ok 736 | 不符 8 | 缺失 0
```

被报不符的正好是 dev11 → dev12 之间改过的 8 个文件；包内自带清单核对同一个目录则是
`ok 745 | 不符 0 | 缺失 0`。

## 根因

`scripts/release-manifest.mjs` 的 `verifyDir()` 读的是：

```js
path.join(root, 'release/install-manifest.json')
```

`root` 是本机仓库（当前安装版本），不是被校验目录。于是用旧版本清单核对新版本文件，
版本间正常改动全部被当成损坏；发布门禁对新版本失效，真有损坏也混在“不符”里分不出来。

## 修法

- 改成读 `path.join(dir, 'release/install-manifest.json')`；
- 目录里没有清单时直接报错「这不是发布包」，不回退本机清单；
- 输出明确写「使用 <dir>/release/install-manifest.json」；
- 清单路径越界（`../`）按不符处理，避免读到目录外文件。

## 验证

新增 `scripts/test-release-manifest-verify.mjs`：

1. 构造一个只含 `a.txt` 的自洽小包 → `--verify` 通过；
2. 把 `a.txt` 改一个字节 → 必须 `不符 1`；
3. 目录里没有 `release/install-manifest.json` → 必须报「不是发布包」；
4. 已加入 `test:audit` 固定列表。

```
test-release-manifest-verify  通过
test:audit                    153/153
```

真实 dev12 包按包内清单核对应为 `745 / 0`；本次修复后用同一命令验证即可。

## 回滚

还原 `verifyDir()` 读取 `root` 清单的写法，并移除新测试。
