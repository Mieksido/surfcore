# #004 Linux 路径与权限兼容

基线：SurfCore v0.7.18 / feature/linux-support

## 修改
- POSIX 系统优先使用 HOME，不使用 USERPROFILE。
- 路径脱敏使用 $HOME / $DSH_HOME。
- 新建私人数据目录默认使用 0700。
- 不自动 chmod 已有目录。

## 验证
- macOS：路径及权限测试 5/5 通过。
- Debian 13.7 AMD64：隔离测试 5/5 通过。
- Debian 实测五类新建目录均为 0700。
- 当前环境 findNodeExe() 与 process.execPath 一致。

## 限制
- 已有 755 目录未迁移。
- Windows 真机回归未执行。
- 未进行真实 DSH 生产部署验证。
