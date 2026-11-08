# dsh-fish-pet

一只住在 **DeepSeek Harness** 页面里的小鱼。它跟着你的任务变表情，把余额、用量和任务清单摊在面板上，还能替你去干活——因为它的对话框接的是**真实的 DSH 会话**，不是另一个 LLM 客户端。

> 非官方项目，与 DeepSeek、Pal AI Lab、QCYTSN 均无隶属关系。

```
        ╭──────────────────────────╮
        │  整理季度报告…            │   ← 气泡跟随当前状态 / 最近一句对话
        ╰───────────────┬──────────╯
                   ╭────┴────╮
                   │  ◕   ◕  │        ← 原创角色「泡泡」
                   │   ▿     │           点击展开面板，拖动换位置
                   ╰─────────╯
```

## 它能做什么

**看得懂状态。** 订阅 DSH 的 `session/event`，把思考、调用工具、等待审批、完成、出错映射成不同姿态与动画，并在头顶气泡写一句人话。

**算得清账。** 面板显示：账户余额（可查时）、今日 token、本轮 token、任务清单（每条带工具步数与耗时）。费用只在你自己填了单价后才估算——**面板上的数字会被当成钱，所以要留给真实数据**。

**干得了活。** 在面板里说一句话，它会向一个专用的 DSH 会话投递，走的是 Web UI 提交消息的同一条路径。因此它能读文件、跑命令、调用你已启用的所有工具。

**不添麻烦。** 全部渲染在页面内（`shell.overlay` 槽位），不修改 DSH 安装包，升级不会失效；任何子系统出错只降级自己，不影响 harness 启动。

## 安装

```bash
npm install
dsh plugin --profile web add D:/MyProject/DSH-PET
# 或从 GitHub：
# dsh plugin --profile web add git+https://github.com/<you>/dsh-fish-pet.git
```

**装完必须完全退出 DSH 再启动。**

详细步骤、配置说明与排错见 **[docs/INSTALL.md](docs/INSTALL.md)**。

## 配置速查

装好后到 **设置 → 插件 → 小鱼桌宠**。最常改的三个：

| 想做的事 | 改什么 |
| --- | --- |
| 看到余额 | `balanceApiKey` 填 DeepSeek 密钥（或设环境变量 `DEEPSEEK_API_KEY`） |
| 看到费用估算 | `priceInputPerMillion` / `priceOutputPerMillion` 填单价 |
| 调大小 / 挪位置 | `scale`；位置直接拖动，记在本地 |

## 项目结构

```
src/index.js      动态导入守卫：依赖缺失时退化为惰性插件，不拖垮启动
src/plugin.js     装配层：settings、HTTP/SSE 路由、事件订阅、生命周期
src/state.js      纯 reducer：session 事件 → 姿态 + 任务台账 + 用量
src/chat.js       会话桥：建 agent → followup → 从事件流拼出回复
src/balance.js    余额适配器：永不抛错，失败降级为「—」+ 原因
src/config.js     Schemastery schema + 纯对象默认值 + 归一化
src/protocol.js   双端共享的消息契约
lib/client.js     全部 UI：原创 SVG + CSS 动画 + 面板（手写，零构建）
```

设计与取舍见 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**。

## 验证状态

在本机 DSH `0.1.1-rc.2` 上实测：

- ✅ 插件进入组合树、单次挂载、5 条路由注册成功
- ✅ 配置读写落库、未知字段返回 400
- ✅ SSE 推送、客户端包分发（`/client.js` 200，37 KB）
- ✅ `POST /chat` 创建真实会话，`turn/start → step/start → turn/end` 驱动了姿态与任务台账
- ⚠️ **一次成功的模型回复未在本机验证**——测试用的独立 profile 没有模型凭据，那一轮以错误结束（该路径被用作错误归因测试）。在已配置模型的 profile 上应当正常。

## 形象与许可

- 源码：**MIT**
- 内置角色「泡泡」：为本项目原创绘制的内联 SVG，**MIT**
- **未包含任何第三方角色美术、帧序列、图标或音效**

这一点是本项目最重要的设计约束，原因值得单独读一遍：

> 「大肥鱼」形象被 Coopanion 与 dsh-dafeiyu **分别明文排除在各自的开源许可之外**。前者为 AGPL-3.0-or-later 但贴图除外；后者代码 MIT 但 `ASSET_LICENSE.md` 写明旧 BigFish 帧不属 MIT、且「仓库外再分发需权利人许可」。因此即便你接受 AGPL，也拿不到这套美术的授权。

完整取证、风险矩阵，以及「想换形象的三条合法路径」，见 **[docs/LEGAL.md](docs/LEGAL.md)** 与 **[NOTICE.md](NOTICE.md)**。

## 相关项目

- [Pal-AI-Lab/Coopanion](https://github.com/Pal-AI-Lab/Coopanion) — AGPL-3.0-or-later，Electron 桌面伴侣，Cortico World 形态
- [QCYTSN/dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu) — MIT（代码），DSH 的原生桌面窗口版桌宠
- [Kris8888888/dsh-desktop-pet](https://github.com/Kris8888888/dsh-desktop-pet) — MIT，DSH 输入框上的会话反应桌宠

本项目的定位不重复它们：**页面内、看状态、能对话、能干活**，且不携带任何有权利瑕疵的美术资源。

## 开发

```bash
npm install
npm test                 # 41 个测试，无网络依赖
node --check lib/client.js
DSH_FISH_PET_TRACE=D:/tmp/fish.log dsh --profile web   # 带追踪启动
```

改 `lib/client.js` 后硬刷新页面（`Ctrl+Shift+R`）；改宿主半区需重启 DSH。
