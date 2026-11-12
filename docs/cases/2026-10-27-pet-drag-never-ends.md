# 2026-10-27 · 桌宠拖拽「永不结束」

## 现象

- 用户录屏：按住桌宠拖动，她会「自己动」，松手也不停；
- 0.2.0 / 0.2.1 都存在。

## 根因

`src/renderer/index.ts` 的拖拽结束依赖 `window` 上的 `pointerup`：

1. 拖动时主进程每 8ms 用光标位置移动窗口；
2. 鼠标快速移动时，光标很容易**跑到窗口外**；
3. 指针没被捕获 → `pointerup` 发到窗口外 → 渲染进程收不到 → `dragging` 永远为 true；
4. 主进程的 `dragTimer` 继续跟着光标跑 = 她一直自己动。

次要原因：`startDrag()` 没有打断正在进行的贴边动画（`snapTimer`），
两个定时器同时 `setPosition`，表现为「边拖边自己滑」。

## 修法（桌宠 v0.2.1）

1. `pointerdown` 时 `document.body.setPointerCapture(e.pointerId)`，`pointerup`/`pointercancel` 释放；
2. `window.blur` 与「退出交互模式」时强制结束拖拽（`forceEndDrag`）；
3. `startDrag()` 里先 `clearInterval(snapTimer)`。

## 验证

- `--selftest`：`drag-state: true`、`snap-to-edge: true`；
- 用户复测后仍报告 125% 缩放下漂移 → 另案（见 [拖动漂移](2026-10-27-pet-drag-drift.md)）。

## 遗留

- 这一版没解决「窗口在缩放屏上被撑大」，两个 bug 是独立的。
