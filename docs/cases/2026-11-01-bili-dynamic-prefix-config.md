# 四类动态清空前缀后仍带固定开头

日期：2026-11-01

## 1. 现象

在设置页把「四类动态 · 固定开头」清空后，发布出去的动态仍然带旧的固定前缀。用户环境特殊，普通机器不一定复现。

## 2. 根因

不是 `withPrefix` 的空串逻辑（它本身正确），而是三处叠加：

1. **配置路径分叉**
   - 插件 `paths.js` 的 `BILI_CONFIG` 用 `DSH_HOME`；
   - `tools/lib/config.mjs` 只认 `HOME/.dsh`（以及 `SURFCORE_BILI_CONFIG`）；
   - 自定义 `DSH_HOME` 或 `SURFCORE_BILI_CONFIG` 时，设置页写的文件和 `daily.mjs` 读的文件不是同一份。
2. **旧前缀没被发布边界清掉**
   - `daily.mjs` 只 `stripPrefix` 当前配置前缀；
   - 当前配置为空时，模型/旧上下文带进 `--text` 的默认前缀会原样保留。
3. **空前缀提示词仍要求固定前缀**
   - scheduler 无条件输出“开头必须是固定前缀：”，空前缀时会诱导模型补旧值。

## 3. 修法

- `tools/lib/config.mjs` 路径解析改为：
  ```text
  SURFCORE_BILI_CONFIG > DSH_HOME/surfcore/bili.config.json > HOME/.dsh/surfcore/bili.config.json
  ```
- `plugins/surfcore/lib/paths.js` 的 `BILI_CONFIG` 使用同一优先级；
- 设置页显示 `overview.paths.biliConfig`（实际路径），不再写死 `~/.dsh`；
- `kinds.mjs` 新增 `stripLegacyPrefix(kind,text)`：空前缀时只清**该类自己的历史默认前缀**，不清所有 `【…】`；
- `daily.mjs` 空前缀时先 `stripLegacyPrefix`，再 `withPrefix`（空前缀不会加）；
- scheduler 空前缀时改成“这类当前不添加固定前缀”；
- dry 预览按是否有前缀显示“固定前缀/无固定前缀”。

## 4. 生效

- 重启 QQ 桥接 / DSH 插件后生效；
- 下一轮 B站 tick 读取新配置；
- 不需要迁移数据；旧配置字段缺失仍按默认前缀兼容。

## 5. 验证

```text
node scripts/test-bili-prefix-config.mjs
npm run test:audit        # 118/118
cd plugins/surfcore && npm test   # 0 失败
```

测试覆盖：

- `prefix=""` normalize 后仍为空；
- `withPrefix` 空前缀不加；
- 空前缀时清掉旧默认前缀；
- `DSH_HOME` 下插件和工具解析出同一个配置文件；
- scheduler/daily 的文案和清洗接线。

## 6. 风险

- `DSH_HOME` / `SURFCORE_BILI_CONFIG` 用户以前可能有两份配置文件；切换后实际读取路径变化，需要用户重新确认前缀并备份旧文件。
- 只清已知默认前缀，避免误删用户自己写的 `【…】`；如果用户想要旧默认前缀，必须重新填回配置。
- 提示词改成“无前缀”后，模型正文可能更随意；正文长度门禁仍按 `BODY` 计算。
- 旧配置缺 `prefix` 字段仍会回退默认前缀；只有明确 `""` 才代表不加。
- 直接 `dynamic.mjs post` 不是四类动态入口，不共享这套前缀清洗。
- 没有真实 B站 发布 live 测试；用 dry-run/单测验证。
