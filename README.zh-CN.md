# Muses

### 你的工作会留下信号，声音可以随之变化。

Muses 是一个**本地优先的开发者音景工具**：它把可观察的编辑活动转化为可解释的状态，再给出可撤回的合成声音建议。声音由你点击启动，也可以随时暂停。

[English](README.md) · [使用指南](docs/USAGE.md) · [安全说明](SECURITY.md) · [MIT 许可证](LICENSE)

```text
文件变化 → 本地事件 → 可解释状态 → 音频建议
                                  ↓
                     你的点击 → 合成声音 → 记录结果
```

公开 beta 使用浏览器的 Web Audio 合成声音，不包含私有录音曲库，也不需要云账户。这个音景是实验性体验，不是医疗工具，也不保证提高专注力。

## 在本机试用

需要 Node `>=22.13 <23`、pnpm `11.4.0` 和支持 Web Audio 的浏览器。在项目目录中运行：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

打开 **http://127.0.0.1:5173**。在另一个终端选择要观察的目录：

```bash
pnpm watch -- --dir /path/to/your/project
```

正常编辑该目录。当前 BUILD 规则需要至少三次编辑事件，且首尾相隔 90 秒，才可能给出声音建议。建议出现后，在页面点击启动；浏览器需要你的手势。你可以随时暂停或调整音量。

## 这个 beta 能做什么

- **观察：**采集器只上报文件变化活动，不读取文件内容。默认不发送相对文件路径，但事件 subject 会包含所选目录的名称。
- **解释：**本地状态和策略显示产生建议所依据的证据。
- **可撤回地执行：**只有你点击后才启动合成声音，手动操作优先于自动调整。
- **留在本机：**默认服务绑定回环地址，无需云账户。未启用认证的本地 API 仍可被同一台机器上的其他进程访问，不要通过隧道或代理向外暴露。

当前版本面向单用户本机使用。私有录音曲库及其播放器、回放体验、云同步、远程托管和多用户隔离不属于本公开发行范围。实际声音和听感因浏览器与设备而异。

## 数据与隐私

原始事件默认保留 24 小时，设置只影响**新**事件；发布值为零会停止新事件入库。到期的新事件按批清理，旧历史、SQLite 空闲页、WAL 和备份不会自动擦除。保留期不是访问控制：清理前，历史 API 仍可能返回过期记录。启用认证或修改隐私设置前，请先阅读[使用指南](docs/USAGE.md)。

## 验证代码

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contracts
pnpm test:release
pnpm check:public
pnpm check:secrets # 需要 gitleaks 8.30.1
pnpm build
pnpm test:e2e:install
pnpm test:e2e
pnpm test:e2e:media
pnpm audit:prod
```

测试通过和浏览器产生音频信号可以证明相应的软件行为，不能替代个人听感或生产部署验收。

## 许可证

Muses 自有源码采用 [MIT 许可证](LICENSE)；第三方依赖仍保留各自的许可证和署名要求，详见[依赖许可清单](THIRD-PARTY-NOTICES.md)及其适用范围。
