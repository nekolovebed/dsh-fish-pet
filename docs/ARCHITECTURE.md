# 架构与重构方案

本文回答两个问题：**从 Coopanion 里“提取桌宠展示部分”究竟能提取什么**，以及**为什么最终形态是一个独立重写而非代码搬运**。

文中「已核实」表示来自仓库文件、README、类型定义或实机运行；「推断」表示基于命名与结构的合理判断，未逐行验证源码。

---

## 1. 上游是怎么组织的

### 1.1 Coopanion（Pal-AI-Lab）

已核实（来自 `packages/cortico-world-desktop-pet/package.json`）：

```jsonc
{
  "name": "cortico-world-desktop-pet",
  "license": "AGPL-3.0-or-later",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts", "./web/*": "./web/*", "./host/*": "./host/*" },
  "cortico": { "kind": "world", "api": 6, "webUiClient": "dist/webui.js", "describe": "describe.json" }
}
```

关键结论：**桌宠在 Coopanion 里是一个「Cortico World」，不是 DSH 插件。**

- 它跑在自己的 Electron 应用里，由 `vendor/cortico` 子模块 + `packages/cortico-*` 提供运行框架（推断：Cortico 是 Pal AI Lab 自研的组合框架）。
- 桌宠包的形状是 `src/`（宿主逻辑）+ `web/`（渲染层，含 `web/whale/` 贴图）+ `host/` + `describe.json`（声明式描述，约 30 KB）。
- 它依赖 `ws`、`koffi`（Win32/CoreGraphics FFI）、`sherpa-onnx-node`（语音）、`jpeg-js`（截图），并且把 Electron 44 作为 devDependency。

而 DSH 的插件契约完全不同（已核实，见 `@deepseek-ai/cordis` / `dsh-app-boot`）：

- 宿主半区：一个导出 `apply(ctx, config)` 的 ES 模块，经 `cordis.patch.yml` 插入插件树。
- 浏览器半区：`package.json` 的 `dsh.client` + `exports["./client"]`，在页面里通过 `ctx.slots.register()` 挂到 UI 槽位。

两者之间没有可复用的加载器、没有可复用的进程模型。**「把 World 打个包变成 dsh 插件」在技术上不成立**，只能重写宿主装配层。

### 1.2 桌宠展示层实际由哪些能力构成

按 README 与包结构归类（「已核实」= README/包字段写明，「推断」= 由命名推断）：

| 能力 | 说明 | 依据 |
| --- | --- | --- |
| 姿态状态机 | 空闲/思考/读文件/搜索/写入/操作电脑等头顶图标状态 | 已核实（README 描述头顶图标） |
| 气泡对话 | 气泡里回复，可带选项按钮 | 已核实（package description） |
| 形象装配（figure pack / rig） | 形象包、配色、服装、帽子/兽耳/光环等挂件 | 已核实（README 装扮页）；`createRig` 见提交记录 |
| 沿屏幕边缘走动 + 空闲微动作 | 走动、表情、待机小动作 | 已核实 |
| 语音输入 | FunASR SenseVoice / Whisper 本地识别 | 已核实 |
| 电脑操作 | 截图、鼠标、键盘、窗口，触碰即让位 | 已核实（`pet_cua_*` 工具） |
| OBS 浏览器源导出 | 透明背景直播源 | 已核实 |

### 1.3 哪些属于「桌宠展示」，哪些不属于

用户要求「仅提取桌宠展示部分，去除其余聊天相关功能」。按此边界切分：

**属于展示层（本次重写的目标）**
1. 会话状态 → 姿态的映射
2. 气泡的显示/隐藏与文案降级
3. 形象渲染与待机/工作/成功/失败的表现差异
4. 尺寸、位置、透明、置顶、拖拽
5. 状态面板（谁在跑、跑到哪一步）

**不属于展示层（明确不做）**
- 模型接入与多厂商 provider 体系（DSH 已有 `ctx.llm`）
- 语音识别（体积与平台成本极高，与本插件目标无关）
- 电脑操作 / Computer Use（DSH 自身工具已覆盖；重复实现只会扩大攻击面）
- 记忆文件（`PARTNER.md`）、闹钟、Worlds 扩展市场、OBS 导出、Steam 创意工坊
- 独立 Electron 进程与托盘

---

## 2. 为什么是「重写」而不是「搬运」

三个独立原因，任何一个都足以否掉搬运方案：

1. **许可证不兼容。** Coopanion 是 AGPL-3.0-or-later。把它的代码复制进一个 MIT 仓库，会让整个仓库必须按 AGPL 发布；而 AGPL §13 还要求通过网络提供服务的部署方向用户提供源码。这会让本插件无法以 MIT 分发，也无法被更宽松的生态接受。详见 [`LEGAL.md`](LEGAL.md)。
2. **运行时模型不同。** Cortico World 与 Cordis 插件是两套加载器、两套 UI 挂载方式、两套生命周期。可复用的只有「思路」，代码一行都用不上。
3. **形象资源的权利不在上游手里。** 这一点最容易被忽略，也最危险：

   > `web/whale/` 的贴图由图像模型按参考图生成后拆件：角色原设为「溟月」，DeepSeek 女仆装二创参考 ZipZipPipe。围裙上的标志是 DeepSeek、OpenAI、Anthropic、Google、阿里云、月之暗面、MiniMax 的商标图形……**这些贴图不在本包的 AGPL 授权范围内。**
   > —— `packages/cortico-world-desktop-pet/THIRD_PARTY_NOTICES.md`

   也就是说，「大肥鱼」形象**连 AGPL 都没有覆盖**。即便你愿意接受 AGPL，也拿不到这套贴图的授权。

因此本项目的做法是：**提取行为与信息架构（功能层面），不提取任何表达（代码与美术）**，用原创形象重新实现展示层。

---

## 3. 目标架构

```
┌──────────────────────── 浏览器（DSH 页面）────────────────────────┐
│  lib/client.js  ——  惰性 CJS 模块，无构建步骤                       │
│                                                                    │
│   ctx.slots.register({ name: 'shell.overlay' }, PetOverlay)        │
│        ├── FishArt          原创 SVG 角色，姿态由 data-* 驱动 CSS    │
│        ├── Bubble           当前姿态 / 最近一句对话                  │
│        └── Panel            余额 · 用量 · 任务清单 · 对话输入        │
│                                                                    │
│   EventSource /plugins/dsh-fish-pet/stream   ← 单向状态推送          │
│   fetch POST  /plugins/dsh-fish-pet/chat     → 发送一句话            │
└───────────────────────────────┬────────────────────────────────────┘
                                │ 仅回环地址，校验 Origin
┌───────────────────────────────┴────────────────────────────────────┐
│  src/plugin.js  ——  宿主半区（Node）                                │
│                                                                    │
│   settings.register(ns, Config)    live 生效，落库到 DSH settings    │
│   ctx.on('session/event', {global:true})  ──┐                      │
│   ctx.on('session/disposed')               │                      │
│                                            ▼                      │
│                            src/state.js  CompanionTracker          │
│                            事件 → 姿态 / 任务台账 / token 用量       │
│                                                                    │
│                            src/chat.js   ChatBridge                │
│                            ctx.agents.create + agent.followup      │
│                            （真实会话，带工具 → 能办公）             │
│                                                                    │
│                            src/balance.js 余额适配器                │
│                            DeepSeek /user/balance | 自定义 | 关闭   │
└────────────────────────────────────────────────────────────────────┘
```

### 3.1 模块清单

| 文件 | 职责 | 为什么单独成文件 |
| --- | --- | --- |
| `src/index.js` | 动态导入守卫，加载失败时退化为惰性插件并打印一行提示 | DSH 把插件激活失败视为启动失败；一个依赖缺失不该拖垮整个 harness |
| `src/plugin.js` | 装配：settings、HTTP 路由、SSE、事件订阅、生命周期清理 | 唯一接触 `ctx` 的地方，便于审计 |
| `src/state.js` | 纯函数式 reducer：`session/event` → 姿态 + 任务 + 用量 | 无 I/O、无时钟依赖，可完整单测（11 个用例） |
| `src/chat.js` | 会话桥：建 agent、发消息、收集回复、错误归因 | 与 `ctx` 解耦，可用假 ctx 测试 |
| `src/balance.js` | 余额适配器，永不抛错，失败降级为「—」+ 原因 | 外部 HTTP，必须隔离 |
| `src/config.js` | Schemastery 配置 schema + 纯对象默认值 + 归一化 | 无 settings 服务时仍能工作 |
| `src/protocol.js` | 双端共享的消息种类与协议形状 | 协议是一份契约，不该散落两处 |
| `lib/client.js` | 全部 UI，手写、零构建 | `dsh plugin add git+…` 才能免构建直装 |

### 3.2 状态映射（展示层的核心）

`session/event` 的事件词汇（已核实于 `@deepseek-ai/dsh-session` 类型定义）：

| 事件 | 宠物姿态 | 面板动作 |
| --- | --- | --- |
| `turn/start` | `THINKING` 接到任务 | 新任务入账，标题取上一条用户消息 |
| `step/start` | `THINKING` 思考中 | — |
| `tool/call` | `WORKING` + 活动分类 | 工具计数 +1，记录工具名 |
| `tool/result` | `THINKING` 整理结果 | — |
| `approval/asked` | `WAITING` 等待确认 | 提示需要批准的工具 |
| `approval/decided` | `WORKING` 继续执行 | — |
| `assistant/message` | 不变 | 累加 `usage`（输入/输出/缓存读） |
| `turn/end` | `SUCCESS` / `ERROR` / `WAITING` / `IDLE` | 任务结账，写入耗时 |

活动分类由工具名推导（`read/write/edit/glob/grep` → 文件，`web_search/web_fetch` → 检索，`bash/shell` → 命令……），用于挑选不同的工作动画。

### 3.3 对话为什么走真实会话

需求是「支持通过 dsh 进行聊天**或办公**」。办公意味着要能读文件、跑命令、调用工具。

- 方案 A：在宿主里直接调 `ctx.llm` 做一次补全 —— 实现简单，但**没有任何工具**，只能聊天，做不到办公。
- 方案 B（采用）：`ctx.agents.create()` 建一个专用会话，`agent.followup(userMessage)` 投递一句话，再从 `session/event` 收集 `assistant/message` 拼出回复。

方案 B 走的是 Web UI 自己提交消息的同一条路径（已核实于 `dsh-host-apiproxy`：`createUserMessage({ content, source })` → `agent.followup()`），因此不是私有后门；代价是依赖预览版 API，用防御式写法兜住。

用户消息对象直接按公开的 `Message` 形状构造（`{ id, role, content, source }`），**故意不 import `@deepseek-ai/dsh-llm`** —— 该包在 profile 的 `node_modules` 里不可解析，静态引用会让整个插件加载失败。

### 3.4 余额为什么默认显示「—」

「账户余额」没有免费午餐：DSH 的 `tokenMeter` 只给 token 计数，不给钱。所以余额必须问服务商。

设计上分两层，且**绝不猜数**：

1. **真实余额**：DeepSeek 官方 `GET /user/balance`（已核实其返回结构 `balance_infos[].total_balance`），或用户配置的自定义接口 + JSON 路径。失败一律降级为「—」并显示原因。
2. **用量与估算费用**：从 `assistant/message` 的 `usage` 精确累加 token（这是真数据）；费用只有在用户填了单价后才计算，否则显示「未配置单价」。

宁可显示一个诚实的破折号，也不显示一个编出来的数字——面板上的数字会被当作钱。

---

## 4. 关键取舍

| 取舍 | 决定 | 理由 |
| --- | --- | --- |
| 构建工具 | 不引入，`lib/client.js` 手写 | `dsh plugin add git+…` 直接可用，无需 `prepare`，供应链面更小 |
| 形象资源 | 内置原创 SVG，代码内联 | 不打包任何第三方美术；无网络请求；矢量缩放不糊 |
| 渲染方式 | CSS 动画 + `data-pose` | 比逐帧图省几百倍体积，且能跟随 `prefers-reduced-motion` |
| 窗口形态 | 页面内 `shell.overlay` 槽位 | 不 patch 官方安装包，升级 DSH 不会失效 |
| 依赖注入 | `inject = ['sessions', 'settings']` | 见 §5 的坑：未声明的服务一碰就抛错 |
| 失败策略 | 任何子系统异常都只降级自身 | 桌宠是装饰，不能影响 harness |

---

## 5. 实机验证记录（以及踩到的坑）

在 DSH `0.1.1-rc.2` + 独立 profile 上实测：

**已验证**
- 插件行进入组合树（`dsh --profile <name> --dump-config`）
- `apply` 被调用、settings 命名空间注册成功、5 条 HTTP 路由注册成功
- `GET/PATCH /config` 读写落库；未知字段返回 400
- `GET /stream` 返回 SSE，含 `hello` + 状态/任务/用量/余额快照
- `GET /client.js` 返回 200（37 KB），DSH 的客户端模块分发正常工作
- `POST /chat` 返回 `202`，真实会话被创建，`turn/start`→`step/start`→`turn/end` 事件驱动了姿态变化与任务台账

**未在本环境验证**
- 一次成功的模型回复：测试 profile 没有模型凭据，`turn/end` 以错误结束。这条路径被用作错误归因测试（气泡会显示真实原因），但「模型正常回答」需要在已配置模型的 profile 上确认。

**踩到的三个坑（都写进了 INSTALL 的排错表）**

1. **未声明的服务不能碰。** Cordis 对 `ctx.<service>` 有访问守卫：只要服务没写进 `inject`，读取属性就抛 `cannot get property "webServer" without inject`。我最初只 inject 了 `sessions`，却在 `mount()` 里读 `ctx.settings`，异常被自己的兜底 `catch` 吞掉，表现为「插件静默不生效、日志一片安静」。这类失败最难查，所以插件内置了文件级追踪（`DSH_FISH_PET_TRACE`）。
2. **控制台日志不可靠。** 启动早期的 `console.log` 未必能出现在终端，导致「看起来没运行」。用文件追踪才看到 `apply` 其实一直在跑。
3. **Windows 绝对路径必须是 `file://` URL。** 在 `cordis.yml` 里写 `D:/a/b.js` 会被当成协议 `d:` 而报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`；写 `/d/a/b.js` 会被解析成 `C:\d\…`。只能用 `file:///D:/a/b.js`。

---

## 6. 如果以后要接「形象包」

当前内置形象是 `lib/client.js` 里的 `FishArt` 组件，替换它即可换形象。若要支持外部形象包，建议的形状（未实现）是：

```
cordis.patch.yml 里新增一项配置 skinDir → 宿主读取 skin.json
skin.json: { "id", "name", "canvas": [w,h], "frames": { "idle": [...], "thinking": [...] } }
宿主把帧按白名单经 /skin/:id/frame?n= 提供（沿用本项目已有的路径穿越防护写法）
```

**必须保留的前提**：形象包只能由用户放在本地，插件不得随仓库分发任何第三方形象——这正是 §2 第 3 点的问题所在。详见 [`LEGAL.md`](LEGAL.md) §6。
