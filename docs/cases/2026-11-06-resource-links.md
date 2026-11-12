# 2026-11-06 · 记忆页顶部「获取网盘资源」入口

## 需求

在设置页顶部说明文字下方加一个入口：

- 按钮文案：`获取网盘资源（语音、向量记忆模型）`
- 点击弹窗，四个网盘按钮：夸克 / UC / 迅雷 / 百度
- 每个按钮用默认浏览器打开对应链接

## 实现

- `plugins/surfcore/lib/client.js`：
  - `QQBIliWhaleSection` 增加 `resourceOpen` 状态；
  - 顶部 `qbw-sub` 下面加按钮；
  - 弹窗列出四个网盘；
  - `RESOURCE_LINKS` 先留空（链接由管理员后补）；空链接点击给 toast 提示，不假装打开；
  - 非空时 `window.open(url, "_blank", "noopener")`。
- `plugins/surfcore/scripts/test-client-contract.mjs`：钉住按钮文案、四个网盘名、`window.open`。

## 链接待补

等用户给链接后，只改：

```js
const RESOURCE_LINKS = {
  quark: "",
  uc: "",
  xunlei: "",
  baidu: "",
};
```

## 验证

```
test-client-contract   ✅
test:audit             151/151
```

## 残余

- 未在浏览器实测点击（链接还没填）；填完后按“点四个按钮各打开一次”验收；
- 弹窗样式复用现有 `qbw-modal`，与设置页其他弹窗一致。
