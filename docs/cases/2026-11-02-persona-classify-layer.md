# 人格卡智能拆分报 layer is not defined

日期：2026-11-02

## 1. 现象

角色页点「智能拆分当前人格」，红字：

```text
X layer is not defined
检查人格卡内容，或手动填写各层
```

反复修改人格卡无效；实际一次都没成功。

## 2. 根因

`handlePersonaClassify()` 误粘贴了保存分支的代码：

```js
let text = String(body.text ?? '');
if (layer === 'daily') text = withDailyIdentity(text);
```

`layer` 只在 `handlePersona()` 的 POST 保存分支定义；拆分函数没有这个变量，所以每次都抛 `ReferenceError`。

`catch` 又把所有错误统一翻译成“检查人格卡内容”，把代码 bug 甩锅给用户内容。

## 3. 修法

- 删除拆分函数里未定义的 `layer` 分支；
- 空输入/超 64KB 由 classifier 返回明确 code；
- 内部错误单独返回 `PERSONA_CLASSIFY_INTERNAL`，hint 明确“不是人格卡内容问题”；
- `UNAVAILABLE` / `NO_MODEL` / `BAD_JSON` / `EMPTY_INPUT` / `TOO_LARGE` 分别给下一步；
- 前端拆分发送完整草稿（core + tone + daily + scenes），不再只发 core/tone；
- 空草稿前端直接提示，不打模型；
- 新增接口/静态回归：禁止拆分函数再引用 `layer`。

## 4. 生效/风险

- 重启 DSH 插件；
- 拆分仍只生成草稿，不自动写盘；
- 完整草稿可能更长，但 classifier 已有 64KB 上限；
- 内部错误现在会显示 code/hint，不再误导用户改卡；
- 没有真实模型 live 拆分测试；接口单测用 classifier 假实现/静态检查。

## 5. 验证

```text
node scripts/test-persona-classify.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
