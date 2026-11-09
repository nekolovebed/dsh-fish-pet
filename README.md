# dsh-neko-pet

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

**能被 Agent 驱动。** 通过 `pet_act / pet_say / pet_move / pet_wear / pet_skin` 五个工具，Agent 可以让它挥手、跳舞、说话、走路、转移视线（跟随鼠标或看某个方向）、换装和换皮肤。动作词汇是封闭的：Agent 只能"选择"，不能"编写"动画；眨眼呼吸等微动作完全本地，不烧 token。

**算得清账。** 面板显示：账户余额（可查时）、今日 token、本轮 token、任务清单（每条带工具步数与耗时）。费用只在你自己填了单价后才估算——**面板上的数字会被当成钱，所以要留给真实数据**。

**干得了活。** 在面板里说一句话，它会向一个专用的 DSH 会话投递，走的是 Web UI 提交消息的同一条路径。因此它能读文件、跑命令、调用你已启用的所有工具。

**换得了装。** 形象是**素材包**：一个目录 + 一份 `manifest.json` 描述分件、锚点与表情，不用改代码。静态立绘常驻、表情特效层按姿态切换、动画片段只在动作触发时短播；猫耳、眼镜、披风这类挂件按槽位吸附，戴上就跟着身体一起动；模型也能读到你新放进来的挂件并主动给它戴上。

**听得懂话，也会搭话。** 五个 agent 工具：`pet_status` 读状态与素材目录、`pet_act` 做动作（挥手、跳、转圈、跳舞、打盹……，可带台词）、`pet_say` 让它在头顶气泡里说一句话、`pet_wear` 穿脱、`pet_skin` 换皮肤。想绕开工具注册表也可以直接 `POST /plugins/dsh-neko-pet/say`。模型调用时，面板上会显示「摆弄自己」。

**跳得出窗口。** DSH 桌面版可在设置里开一个透明置顶的独立小窗，桌宠显示在浏览器窗口之外；宠物与气泡区域可拖动、可关闭，其余透明区域点击穿透。纯 Node 的 `dsh web` 没有 Electron，会自动降级成页面内桌宠。

**不添麻烦。** 默认渲染在页面内（`shell.overlay` 槽位），悬浮窗是可选项；不修改 DSH 安装包，升级不会失效；任何子系统出错只降级自己，不影响 harness 启动。素材读不到时自动退回内置形象。

## 安装

```bash
npm install
dsh plugin --profile web add D:/MyProject/DSH-PET
# 或从 GitHub：
# dsh plugin --profile web add git+https://github.com/nekolovebed/dsh-neko-pet.git
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
| 换形象 / 穿挂件 | 设置卡片里的「素材与衣柜」，或把包放进 `packs/` 后点「重新扫描」 |
| 换素材目录 | `packsDir` 指向你自己的目录；关掉 `assetsEnabled` 回退内置形象 |

## 项目结构

```
src/index.js      动态导入守卫：依赖缺失时退化为惰性插件，不拖垮启动
src/plugin.js     装配层：settings、HTTP/SSE 路由、事件订阅、生命周期
src/state.js      纯 reducer：session 事件 → 姿态 + 任务台账 + 用量
src/chat.js       会话桥：建 agent → followup → 从事件流拼出回复
src/balance.js    余额适配器：永不抛错，失败降级为「—」+ 原因
src/config.js     Schemastery schema + 纯对象默认值 + 归一化
src/protocol.js   双端共享的消息契约
src/packs.js      素材包扫描、manifest 校验、素材路由的路径白名单
src/wardrobe.js   穿戴规则：槽位互斥、叠加、归一化（纯函数）
src/pet.js        PetDirector：动作队列、TTL、与会话姿态的优先级
src/say.js        SayBoard：头顶气泡的一句话 + TTL
src/desktop.js    DesktopPetWindow：可选的 Electron 悬浮窗与点击穿透
src/tools.js      五个 agent 工具的契约与注册
lib/client.js     页面内全部 UI：分层装配器 + 挂件 + 气泡 + 面板
lib/desktop.html  悬浮窗页面（透明、置顶、可拖动）
lib/desktop.js    悬浮窗渲染器：分层 rig + 气泡 + SSE
packs/            素材包：内置原创皮肤「泡泡」与四个示例挂件
```

设计与取舍见 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**。

## 验证状态

在本机 **DSH 0.2.2-rc.1**（`web` profile，`dsh --profile web --port 3099 --no-open`）实测：

- ✅ 组合树装载、settings 命名空间、**10 条 HTTP 路由**、**5 个 agent 工具**注册
- ✅ `/status` `/packs` `/asset` `/say` `/desktop` `/desktop.js` 全部 200，路径穿越仍 404
- ✅ 素材目录扫到 3 套皮肤 / 4 件挂件，`errors: []`；分层 manifest 的 `clipVariants` / `clipLayer` 校验通过
- ✅ `/say` 写 / 读 / 清三态正常，SSE 快照能重放 `kind:"say"` 帧
- ✅ 悬浮窗页面把 DSH URL 里的 session token 注入脚本地址以及后续 SSE、素材请求
- ✅ `POST /chat` 创建真实会话并驱动姿态与任务台账
- ⚠️ 一次成功的模型回复未在本机验证——测试 profile 没有模型凭据。
- ⚠️ Electron 悬浮窗只能在 **DSH 桌面版**里开；`dsh web` 是纯 Node，`/desktop` 会如实返回 `supported:false`，页面内桌宠不受影响。

无网络单测 **89 个全绿**（`npm test`），覆盖 manifest 校验与 `clipVariants` 白名单、素材路径穿越、槽位互斥、动作队列与 TTL、SayBoard、工具契约、假 Cordis 上下文装配、分层渲染 z 序与 clip 降级、桌面窗降级。

### 让 Agent 说一句话

```bash
# 模型侧：调用 pet_say({ text, durationMs })，或 pet_act 带一句 text
# 脚本侧（不经过工具注册表）：
curl -X POST -H 'content-type: application/json' \
  -d '{"text":"报告写完啦","durationMs":6000}' \
  http://127.0.0.1:3080/plugins/dsh-neko-pet/say
```

气泡是一个贴在头顶的简单圆角框。优先级：`pet_say` > `pet_act` 的台词 > 最近一句对话 > 当前会话阶段；到期自动消失。

## 形象与许可

- 源码：**MIT**
- 内置角色「泡泡」与四个示例挂件：为本项目原创绘制，**MIT**
- **未包含任何第三方角色美术、帧序列、图标或音效**
- 素材包格式见 **[docs/ASSET-GUIDE.md](docs/ASSET-GUIDE.md)**；自带素材请放 `packs/local/`（已 gitignore）

这一点是本项目最重要的设计约束，原因值得单独读一遍：

> 「大肥鱼」形象的权利状态不是「没有授权」，而是**授权与 MIT 不兼容**。原作者上善无形于 2026-08-02 将原创角色「溟月」以 **CC BY-NC-SA 4.0** 开放二创（署名、非商业、相同方式共享）；ZipZipPipe 的女仆版遵守同一协议并明确禁止商用。Coopanion 另在其 `THIRD_PARTY_NOTICES.md` 里把随包贴图排除在 AGPL 之外。
>
> 结论：**你自己非商业使用可以**（署名 + 相同方式共享），**但本仓库不能把素材打包进 MIT 分发**。所以素材放在 `packs/local/`，已 gitignore，由使用者自行放置。

完整取证、风险矩阵与可走的路径，见 **[docs/LEGAL.md](docs/LEGAL.md)** 与 **[NOTICE.md](NOTICE.md)**。

### 用「大肥鱼」做出 Coo 那种效果

本机已按下面的方式实现（素材只在 gitignored 的 `packs/local/whale-maid/`，不进仓库）：

1. 从动画里挑一帧干净的做成**静态立绘** `base.webp`，常驻显示，由 CSS 做呼吸与摇摆；
2. 加一层整画布的 `fx`，按姿态切思考点、星芒、汗滴、Zzz、腮红；
3. 把原来的整段动画降为 `clipVariants`——只有 `pet_act` 触发动作时短播。播放期间渲染器只画 `clipLayer`，隐藏 fx 与挂件并停用 CSS 动作，避免叠影；
4. 重新启用挂件，用 `accessoryOverrides` 按这个形象校准锚点与缩放。

于是平时是「分层、状态驱动、可穿戴」的桌宠，不再是一直循环播放的视频。格式细节见 **[docs/ASSET-GUIDE.md](docs/ASSET-GUIDE.md) §6**。

## 相关项目

- [Pal-AI-Lab/Coopanion](https://github.com/Pal-AI-Lab/Coopanion) — AGPL-3.0-or-later，Electron 桌面伴侣，Cortico World 形态
- [QCYTSN/dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu) — MIT（代码），DSH 的原生桌面窗口版桌宠
- [Kris8888888/dsh-desktop-pet](https://github.com/Kris8888888/dsh-desktop-pet) — MIT，DSH 输入框上的会话反应桌宠

本项目的定位不重复它们：**页面内、看状态、能对话、能干活**，且不携带任何有权利瑕疵的美术资源。

## 开发

```bash
npm install
npm test                 # 89 个测试，无网络依赖
node --check lib/client.js
DSH_NEKO_PET_TRACE=D:/tmp/fish.log dsh --profile web   # 带追踪启动
```

改 `lib/client.js` 后硬刷新页面（`Ctrl+Shift+R`）；改宿主半区需重启 DSH；**只改 `packs/` 里的素材不用重启**，在设置卡片点「重新扫描」即可。
