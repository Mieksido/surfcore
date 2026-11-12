# 2026-10-30 · B站 扫码登录要能看到账号并核查；管理员 UID 长号填不进去

## 现象

1. 点「扫码登录小肥鱼」成功后只闪一句 toast，没有常驻显示登录的是谁，也没有“这个登录还有效吗”的核查；
2. 管理员 B站 UID 填 15 位（或十几位）保存后变成空 —— 像“填不进去”，且没有任何报错。

## 根因

1. 扫码成功只走 `onConfirmed` → toast；弹窗立刻关闭，页面没有账号卡片；核查只发生在扫码那一刻（nav），之后无法复核。
2. `ADMIN_MID_RE = /^\d{4,15}$/` 之外的值会被 `normalizeAdmin` **静默清空**；前端没有长度提示，保存也没有错误返回。
   （15 位本应可用，但用户遇到的是 16 位/更长，或含非数字时被静默丢弃。）

## 修法

| 面 | 改动 |
| --- | --- |
| 扫码成功 | 弹窗内显示「✅ 登录成功 + 昵称（mid） + 保存时间」，用户点「完成」才关闭 |
| 登录核查 | 新增 `POST /bili/account/verify`：读凭据文件 → 再问一次 B站 nav → 核对 mid；返回账号或 `bili.no-credentials / cookie-expired / mid-mismatch` + hint |
| 账号卡片 | B站 页新增「B站 登录账号」：主人/小肥鱼各自的昵称、mid、保存时间 + 「核查登录」「扫码登录」 |
| UID 核查 | 新增 `POST /bili/verify-user`：查 B站 公开名片，返回真实昵称并比对；不一致给「用 B站 昵称填上」 |
| 长 UID | `ADMIN_MID_RE` 放宽到 `4~20` 位；保存时非法值返回 `admin.mid-invalid` + hint（不再静默清空）；输入框提示「4~20 位数字」 |
| 报错 | 扫码启动失败带 `bili.qr-start-failed` + hint；过期/失败文案补“下一步做什么” |

## 验证

- `test-admin-identity`：15/20 位 mid 保留、超长/含字母丢弃；
- `test-client-contract`：账号卡片、核查按钮、UID 核查、长度提示、扫码成功态；
- audit 86/86；插件测试全绿。

## 注意

- 核查会真实请求 `api.bilibili.com`（nav / card），网络不通时返回 `bili.verify-network` 并给建议；
- 后端改的是插件宿主，**需要重启 DSH** 才生效。
