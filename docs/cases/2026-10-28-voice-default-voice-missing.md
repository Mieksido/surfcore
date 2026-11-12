# 2026-10-28 · 本地语音包默认音色 503「没有音色」

## 现象

- 本地语音包装好、voxd 也起来了，但一发语音就 503；
- 插件日志：`没有音色 [loli12-gsv]，可用：（空）`；
- 用户侧看到的还有「DSH 说找不到音色文件」。

## 根因

两个叠加：

1. **音色资产没分发**：`voices/`（音色定义）与 `voicepack/age12/*.wav`（零样本克隆的参考音频）
   被 `.gitignore` 排除，Release 资产里也只有 `vendor` + `models` → 用户机器上根本没有 loli12-gsv；
2. **配置没落地**：公开仓库只有 `config.example.toml`（真实配置不入库），安装后没有 `config.toml`，
   voxd 直接起不来。

loli12-gsv 是**零样本克隆**（用 vendor 里的 GPT-SoVITS 官方底模 + 参考音频），
不涉及作者的微调权重，所以补发 2.5MB 参考音频即可。

## 修法（v0.6.8）

1. 新增 Release 资产 `voice-local-voicepack.tar.gz`（2.5MB，含 `voices/*` + `voicepack/age12/*.wav`），
   登记进 `models.json`（带 sha256/size），`fetch-models.mjs` 会一起拉；
2. 安装流程新增一步：没有 `config.toml` 就从 `config.example.toml` 复制一份。

## 验证

- `releases/latest/download/version.json`、`models.json` 中新增归档可下载（API 校验 sha256/size）；
- `npm run test:audit` 77/77；
- **未验证**：干净机器完整跑一遍「装包 → 拉模型 → 拉 voicepack → 合成成功」。

## 遗留

- 用户必须**卸载重装**一次语音包才会拉到新资产（不会自动补）；
- 本地包仍要求 NVIDIA 显卡（`tts_infer.yaml` 里 `device: cuda`）；无卡用户应改用云端包。
