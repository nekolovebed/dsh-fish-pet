# 形象素材库 · 可动挂件 · Agent 动作接口 —— 设计方案

> 状态：**P1–P3 已实现**（2026-11-09）。实施结果见文末 §13；格式细节以 [`ASSET-GUIDE.md`](ASSET-GUIDE.md) 为准，架构说明以 [`ARCHITECTURE.md`](ARCHITECTURE.md) §6 为准。
> 目标仓库：`dsh-fish-pet`（MIT，DSH 页面内桌宠）。
> 参考形态：Coopanion 的「大肥鱼」展示层——**只参考能力边界，不取代码、不取美术**（理由见 `LEGAL.md`）。

---

## 0. 摘要

把现在「一个内联 SVG 硬编码 6 种姿态」的形象层，拆成**三层可替换结构**：

1. **素材包（pack）**：本地目录 + `manifest.json` 描述分件、锚点、表情、可动规则。仓库只内置原创包，第三方/自产素材放在本地目录，不进仓库。
2. **装配器（rig）**：浏览器端按 manifest 叠层渲染，姿态 = 表情切换 + 运动词汇（bob / wag / sway / blink / hop…），挂件按锚点吸附并跟随主体运动。
3. **Agent 接口**：`pet_status` / `pet_act` / `pet_wear` / `pet_skin` 四个工具，模型能读当前装扮与可用素材目录、能让它做动作、能给它换装。

一句话：**形象是数据，不是代码；挂件是带锚点的数据；动作是模型可调用的工具。**

---

## 1. 现状审计（已核实，逐文件）

| 能力 | 现状 | 缺口 |
| --- | --- | --- |
| 形象渲染 | `lib/client.js` 内 `FishArt()`，单张 140×130 SVG，硬编码 20 余个路径 | 无法换素材、无分件、无法加挂件 |
| 姿态表达 | 6 个 `Pose` × CSS class（bob/wag/blink/hop/shake/droop） | 只有整体位移，**表情不能换**（眼睛/嘴是固定路径，仅 ERROR 时换一条嘴线） |
| 状态来源 | `src/state.js` 把 `session/event` 折成 pose + 任务 + 用量 | 映射本身可用，无需重写 |
| 挂件 | 无 | 全部缺失 |
| Agent 接口 | 无 | 全部缺失；`state.js` 里 `/^(pet_|fish_)/` → `'self'` 的分类是**已经预留的接入点** |
| 素材分发 | 只有 DSH 自带的 `/client.js` 分发 | 无本地素材路由 |
| 持久化 | settings（schemastery）+ localStorage 只存位置/开关 | 无装扮持久化 |
| 测试 | 31 个（`npm test`：29 通过 / 2 失败，因缺 `node_modules`） | 无 manifest / 素材 / 工具相关用例 |

另外两个环境事实：

- 本机**没有安装 DSH**（无 `dsh` 命令、无 `~/.dsh`），因此本轮所有改动只能做静态验证 + 单测，**实机验证需要你在装了 DSH 的机器上跑**。
- 仓库验证目标是 DSH `0.1.1-rc.2`，npm 上最新已是 `0.2.2-rc.1`，且 `0.2.0-rc.2` 起事件流有变动（`assistant/chunk` 移除、新增 `assistant/attempt`）。方案里所有新增的宿主 API 使用都按「探测 + 降级」写，不假设单一版本。

---

## 2. 目标拆解

需求原文三条，转成可验收的工程目标：

| # | 需求 | 目标 | 验收方式 |
| --- | --- | --- | --- |
| G1 | 「现在这个仓库并没有完善显示的形象部分」 | 形象从硬编码 SVG 升级为**分件 + 表情 + 运动**的装配模型，且不引入第三方美术 | 换一套 pack 即换形象；6 姿态下表情/挂件均正确 |
| G2 | 「可以随时添加服饰或其他可动件（尾巴、猫耳），添加后 agent 可以读取并使用」 | 本地投放目录 → 自动扫描 → 目录进工具返回值 → 模型可穿戴 | 放入一个 `cat-ears` 目录，不重启，模型调用 `pet_status` 能看到并可 `pet_wear` |
| G3 | 「可以注入 agent 提供动作交互接口」 | 4 个工具，模型可读状态、驱动动作、改变装扮 | 在会话里说「让小鱼跳一下」，`tool/call` 出现 `pet_act`，页面出现跳动动画 |

---

## 3. 总体架构

```
┌───────────────────────── 浏览器（DSH 页面）──────────────────────────┐
│  lib/client.js                                                       │
│                                                                      │
│   PetOverlay                                                         │
│     ├── RigStage        ← 新增：按 manifest 叠层渲染                  │
│     │     ├── Layer[]   全画布分件（body/belly/eyes/mouth/clothes）   │
│     │     ├── Prop[]    锚点挂件（猫耳/帽子/项圈/手持物）              │
│     │     └── Motion    运动词汇（bob/wag/sway/blink/hop/shake）      │
│     ├── Bubble / Panel / SettingsCard   ← 复用现有                    │
│     └── EventSource ← 新增 wardrobe / catalog / action 三类消息        │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ 仅回环 + Origin 校验（沿用现有 isLocalRequest）
┌───────────────────────────────┴──────────────────────────────────────┐
│  src/plugin.js —— 宿主半区                                            │
│                                                                      │
│   src/packs.js    新增：扫描 packs 根目录、校验 manifest、路径白名单    │
│   src/wardrobe.js 新增：穿戴状态（settings 持久化）+ 槽位冲突           │
│   src/pet.js      新增：PetDirector——动作队列 / TTL / 优先级           │
│   src/tools.js    新增：ctx.tools.register × 4                        │
│   src/state.js    改动：暴露 pose 供 director 覆盖                    │
│   /plugins/dsh-fish-pet/assets/<pack>/<file>   ← 新增静态素材路由      │
│   /plugins/dsh-fish-pet/packs                  ← 新增目录 JSON        │
└──────────────────────────────────────────────────────────────────────┘
```

设计约束沿用仓库既有三条铁律：**① 任何子系统失败只降级自己；② 不 patch DSH 安装包；③ 不随仓库分发任何有权利瑕疵的美术。**

---

## 4. 素材包格式（spec v1）

### 4.1 目录

```
packs/                      ← 素材根目录（可配置；默认位于用户数据目录）
  paopao/                   ← 内置原创皮肤（MIT，随仓库分发）
    manifest.json
    layers/body.png
    layers/belly.png
    layers/eyes-open.png
    layers/eyes-happy.png
    layers/mouth-smile.png
    layers/tail.png
  cat-ears/                 ← 用户自加挂件（不进仓库，.gitignore）
    manifest.json
    art.png
  maid-outfit/
    manifest.json
    layers/apron.png
```

- 一个目录 = 一个包；`manifest.json` 里 `kind` 区分 `skin`（整套角色）与 `accessory`（单件挂件）。
- **仓库只含 `packs/paopao/`**（原创）。用户目录通过配置项 `packsDir` 指向，默认 `%LOCALAPPDATA%/dsh-fish-pet/packs`（macOS/Linux 用对应 XDG 路径）。

### 4.2 `manifest.json`（skin）

```jsonc
{
  "schema": 1,
  "kind": "skin",
  "id": "paopao",
  "name": "泡泡",
  "author": "dsh-fish-pet",
  "license": "MIT",
  "canvas": { "width": 140, "height": 130 },   // 逻辑画布，所有 layer 同尺寸
  "anchors": {                                  // 归一化坐标 0..1，挂件吸附用
    "head":  [0.50, 0.28],
    "neck":  [0.50, 0.52],
    "hip":   [0.62, 0.74],
    "back":  [0.30, 0.55],
    "hand":  [0.34, 0.86]
  },
  "layers": [
    { "id": "tail",  "src": "layers/tail.png",  "z": 5,  "pivot": [0.75, 0.55], "motion": "wag" },
    { "id": "body",  "src": "layers/body.png",  "z": 10 },
    { "id": "belly", "src": "layers/belly.png", "z": 12 },
    { "id": "eyes",  "z": 20, "variants": {
        "open":  "layers/eyes-open.png",
        "happy": "layers/eyes-happy.png",
        "sleep": "layers/eyes-sleep.png",
        "star":  "layers/eyes-star.png" } },
    { "id": "mouth", "z": 21, "variants": {
        "smile": "layers/mouth-smile.png",
        "open":  "layers/mouth-open.png",
        "flat":  "layers/mouth-flat.png" } }
  ],
  "expressions": {                              // pose → 表情组合
    "IDLE":     { "eyes": "open",  "mouth": "smile" },
    "THINKING": { "eyes": "open",  "mouth": "flat"  },
    "WORKING":  { "eyes": "open",  "mouth": "open"  },
    "WAITING":  { "eyes": "star",  "mouth": "flat"  },
    "SUCCESS":  { "eyes": "happy", "mouth": "open"  },
    "ERROR":    { "eyes": "sleep", "mouth": "flat"  }
  }
}
```

### 4.3 `manifest.json`（accessory）

```jsonc
{
  "schema": 1,
  "kind": "accessory",
  "id": "cat-ears",
  "name": "猫耳",
  "slot": "head",            // back | body | neck | head | face | hand | effect
  "anchor": "head",          // 吸附到 skin.anchors 的哪个点
  "offset": [0, -0.10],      // 相对锚点的归一化偏移
  "pivot": [0.5, 0.85],      // 旋转/缩放轴心（自己画布的归一化坐标）
  "scale": 0.42,             // 相对宿主画布短边
  "z": 40,
  "motion": "sway",          // 挂件自己的微动
  "follow": ["bob"],         // 要跟随主体的哪些运动
  "tags": ["cat", "cute"],
  "poses": ["IDLE", "SUCCESS"],   // 可选：仅这些姿态显示
  "description": "一对会跟着晃的猫耳"  // 给模型看的语义描述
}
```

### 4.4 两条分件约定（关键取舍）

| 类型 | 尺寸 | 定位方式 | 为什么 |
| --- | --- | --- | --- |
| **layer**（皮肤自己的部件） | 与 `canvas` 等尺寸的透明整图 | 直接 `inset: 0` 叠放 | 分件天然对齐，生成式素材（AI 出图 → 拆层）零成本；不需要为每件算偏移 |
| **prop**（跨皮肤复用的挂件） | 紧贴内容裁剪的小图 | 锚点吸附 + 偏移 + 轴心 + 缩放 | 一件猫耳要能装在任何皮肤上，必须解耦绝对位置 |

这条约定直接决定了「未来用图像模型生成素材」是否可行：**生成时只需按固定画布出分层图，对齐由渲染器保证。**

### 4.5 合法性边界（写进代码，不只写进文档）

- 仓库内置包 = 本项目原创绘制，MIT；`manifest.license` 必填，缺失即拒绝加载。
- 用户目录的包仅在**本地**被读取和分发（回环 HTTP），插件不上传、不下载、不转换第三方素材。
- `packs/`（用户目录）进 `.gitignore`；README/LEGAL 增加「不要提交不属于你的素材」。
- 「大肥鱼」素材明确不在上游许可内，因此**不做**：内置、镜像、格式转换脚本、下载助手。

---

## 5. 渲染与装配层

### 5.1 `RigStage`

```
RigStage({ skin, worn[], pose, action })
  ├─ <div class="stage" style="width:W*scale">
  │    ├─ <Layer z=5  motion=wag>   <img src=tail.png>
  │    ├─ <Layer z=10>              <img src=body.png>
  │    ├─ <Layer z=20>              <img src=eyes-happy.png>   ← 由 expressions[pose] 决定
  │    ├─ <Prop  z=40 anchor=head>  <img src=cat-ears.png>
  │    └─ <Fx    z=50>              ← SUCCESS 星芒 / ERROR 水滴（沿用现有内联图形）
  └─ 运动：统一由外层 wrapper 承载「主体运动」，挂件跟随
```

- 素材用 `<img>` 引入，**不内联第三方 SVG**（内联 SVG 可执行脚本；`<img>` 里的 SVG 不能）。
- 内置皮肤保留内联 SVG 版本作为**降级渲染**：素材路由不可用 / manifest 校验失败时，退回现在的 `FishArt`，页面不会白一块。
- 表情由 `expressions[pose]` 选 variant，解决「6 个姿态共用一张脸」的问题。

### 5.2 运动词汇（固定闭集，不接受任意 CSS）

| 词 | 效果 | 默认用于 |
| --- | --- | --- |
| `bob` | 上下浮动 | 主体常驻 |
| `bob-fast` | 快速浮动 | WORKING |
| `wag` | 绕轴心摆动 | 尾巴/鳍 |
| `sway` | 轻微摇动 | 猫耳/挂饰 |
| `blink` | 眨眼缩放 | 眼睛 |
| `hop` | 跳跃 | SUCCESS / 动作 |
| `shake` | 左右抖 | WAITING |
| `droop` | 下沉倾斜 | ERROR |
| `spin` | 旋转一圈 | 动作 |
| `none` | 不动 | — |

固定闭集 = 素材包无法注入任意 CSS，安全边界清晰。

### 5.3 Agent 动作 → 动画

`pet_act` 的 `action` 映射到「临时姿态 + 运动 + 可选气泡」：

| action | 表现 | 时长 |
| --- | --- | --- |
| `wave` | `sway` 加速 + 气泡「挥手」 | 1.6s |
| `jump` | `hop` ×2 | 1.2s |
| `spin` | `spin` | 1.4s |
| `dance` | `bob` + `wag` 加速 + 左右位移 | 2.4s |
| `sleep` | `droop` + `eyes:sleep` | 直到被覆盖 |
| `cheer` | `hop` + 星芒 | 1.6s |
| `shy` | `sway` 慢 + 腮红加深 | 2.0s |
| `think` | 思考点 | 持续 |

---

## 6. 装扮系统

### 6.1 槽位与层序（固定，不随包变化）

| 槽位 | z | 例 |
| --- | --- | --- |
| `back` | 5–8 | 翅膀、披风 |
| `body` | 30 | 衣服、围裙 |
| `neck` | 35 | 项圈、领结 |
| `head` | 40 | 猫耳、帽子 |
| `face` | 45 | 眼镜 |
| `hand` | 48 | 手持物 |
| `effect` | 50 | 光效、粒子 |

### 6.2 状态与持久化

- 写在 settings（DSH 已持久化，重启不丢）：
  - `skinId: string`
  - `worn: string[]`（挂件 id 列表，按加载顺序）
  - `packsDir: string`
  - `assetsEnabled: boolean`（关掉即回退内联形象）
- `normalizeConfig` 需要扩展支持数组字段（当前只处理 bool/number/string）。
- 状态变化 → `Kind.WARDROBE` 消息 → 所有已连接页面即时重绘。

### 6.3 冲突规则

- 同槽位默认互斥（后戴的替换先戴的）。
- 挂件可声明 `"stackable": true` + `layerOffset`，用于「耳环 + 耳朵」这类叠加。
- 引用了不存在锚点的挂件 → 跳过并记一条 warning，不影响其它挂件。

### 6.4 设置卡片 UI

在现有 `SettingsCard` 里加两块：

1. **素材目录**：显示 `packsDir`、已发现包数量、「重新扫描」按钮（`POST /packs/reload`）。
2. **衣柜**：按槽位分组的挂件列表，点选即穿/脱（`PATCH /config {worn}`），带缩略图（`/assets/<pack>/art.png`）。

---

## 7. Agent 交互接口

### 7.1 注册方式（已核实）

```js
// src/index.js
export const inject = ['sessions', 'settings', 'tools']   // ← 新增 tools

// src/tools.js
import { defineTool } from '@deepseek-ai/dsh-tools'
export function registerPetTools(ctx, { director, wardrobe, packs }) {
  ctx.tools.register(defineTool({
    name: 'pet_act',
    description: '让桌宠做一个动作……',
    parameters: { action: { type: 'string', required: true, description: '…' } },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(args) { return director.act(args) },
  }))
}
```

- `ctx.tools.register()` 返回 disposer，插件卸载自动注销（Cordis 语义）。
- **`@deepseek-ai/dsh-tools` 可能无法从 profile 的 `node_modules` 解析**（仓库已踩过 `dsh-llm` 的坑）。因此按现有 `index.js` 的守卫模式：动态 `import()` 失败时退回**手写同形对象**（`ToolDefinition = ToolSchema + output + execute`），并把失败原因写进追踪日志。工具是「增强」而 not「必需」，降级后桌宠照常显示。

### 7.2 四个工具契约

| 工具 | 参数 | 返回（canonical） | 副作用 |
| --- | --- | --- | --- |
| `pet_status` | `{ detail?: 'brief' \| 'full' }` | pose/stage/detail、最近 3 条任务、用量、当前 skin、已穿戴列表、**可用动作目录**、**可用挂件目录（id/name/slot/tags/description）** | 无（只读）。首次调用会触发一次 pack 重扫 |
| `pet_act` | `{ action: enum, text?: string, durationMs?: number }` | `{ ok, action, expiresAt }` | 推送 `Kind.ACTION`，客户端播放动画；到期自动回落到 session 姿态 |
| `pet_wear` | `{ op: 'wear' \| 'remove' \| 'clear', item?: string, slot?: string }` | `{ ok, worn: string[], rejected?: {item, reason}[] }` | 写 settings，广播 `Kind.WARDROBE` |
| `pet_skin` | `{ id?: string }` | `{ ok, skinId, available: [{id,name}] }` | 换皮肤，广播 `Kind.CATALOG` |

目录自描述是 G2 的核心：**`pet_status` 的返回里直接带挂件清单和语义描述**，模型不需要额外「发现」步骤就能知道「刚放进去的猫耳可以戴」。

### 7.3 动作生命周期与优先级

```
优先级（高 → 低）：
  1. 临时动作（pet_act，带 TTL）
  2. 会话姿态（session/event 驱动，原有逻辑）
  3. 静默 IDLE
```

- 动作入队，串行播放，不打断正在播的动作（`durationMs` 上限 10s）。
- `sleep` 之类「持续型」动作，TTL 到点或被新动作覆盖才退出。
- 动作到期后**重新读 `tracker` 的当前姿态**，而不是硬回 IDLE——任务还在跑就继续显示 WORKING。
- 新增 `Kind.ACTION`，客户端不认识就忽略（前向兼容）。

### 7.4 与现有状态机的联动（白拿的好处）

`src/state.js` 里已有：

```js
[/^(pet_|fish_)/i, 'self']   // → toolStage('self') → '摆弄自己'
```

所以模型调用 `pet_act` / `pet_wear` 时，`tool/call` 事件会自动把姿态推到 `WORKING + 摆弄自己`，**面板上能看到「它正在摆弄自己」**，不需要额外代码。

---

## 8. 素材生产管线（后续阶段，本轮只交规格）

### 8.1 分件规格

- 画布建议 1024×1024（渲染时按 `canvas` 缩放），透明背景。
- 必须**同一构图、同一画布**出图，才能直接叠层。
- 命名：`layers/<part-id>.png`，部位 id 固定闭集（`body` / `belly` / `eyes-*` / `mouth-*` / `tail` / `clothes-*`）。
- 生成后跑 `node tools/slice.mjs <src> <pack>`：统一裁切到画布、校验 alpha、写 manifest 草稿。

### 8.2 提示词骨架（给未来的图像生成用）

```
分层角色设定图，Q 版圆润鲸鱼形，浅蓝渐变身体 + 米白腹部，
大眼圆瞳、腮红、短鳍；纯透明背景，正视角，画布 1024×1024；
仅输出「body」层，不含眼睛/嘴/尾巴/服饰；
不要任何厂商 logo、不要文字、不要水印。
```

### 8.3 切件脚本（`tools/`，不进运行时包）

- `slice.mjs`：主图 → 分件、锚点标定辅助
- `validate.mjs`：manifest 校验（与宿主同一份 schema，避免两套规则）
- 产物直接落到 `packs/<id>/`，用户本地自用

---

## 9. 改动清单

| 文件 | 改动 | 规模 |
| --- | --- | --- |
| `src/packs.js` | 新增：扫描、manifest 校验、路径白名单、mtime 缓存 | ~200 行 |
| `src/wardrobe.js` | 新增：穿戴状态、槽位冲突、归一化 | ~120 行 |
| `src/pet.js` | 新增：PetDirector（动作队列 / TTL / 优先级） | ~150 行 |
| `src/tools.js` | 新增：4 个工具 + defineTool 降级 | ~220 行 |
| `src/protocol.js` | 改：新增 `Kind.ACTION` / `WARDROBE` / `CATALOG` / `Pose` 扩展 | ~20 行 |
| `src/plugin.js` | 改：装配 packs/wardrobe/director/tools，新增 2 条路由 | ~80 行 |
| `src/config.js` | 改：4 个新字段 + 数组归一化 | ~40 行 |
| `lib/client.js` | 改：`RigStage` / `Layer` / `Prop` / 衣柜 UI，保留 `FishArt` 降级 | ~420 行 |
| `packs/paopao/**` | 新增：内置原创皮肤（SVG 分件或 PNG） | 素材 |
| `test/packs.test.js` 等 | 新增：manifest 校验、路径穿越、槽位冲突、动作 TTL、工具返回 | ~260 行 |
| `docs/` | 改 ARCHITECTURE §6、新增 ASSET-GUIDE.md、LEGAL 补 pack 条款 | 文档 |

---

## 10. 分阶段与验收

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| **P1 素材与装配** | packs 扫描 + 静态路由 + RigStage + 内置皮肤转 pack（保留内联降级） | 换 `skinId` 页面形象变化；删掉素材目录仍能显示内联形象 |
| **P2 装扮** | 槽位/冲突/持久化 + 设置衣柜 UI + SSE 同步 | 打开页面戴猫耳，刷新仍在；两个同槽挂件互斥 |
| **P3 Agent 接口** | 4 个工具 + Director + 目录自描述 | 会话里「让小鱼跳一下」触发 `pet_act`；`pet_status` 能看到新放的挂件 |
| **P4 生产管线** | 规格文档 + 切件/校验脚本 | 用一张自绘图生成可用 pack（占位素材验证） |
| **P5 文档与回归** | 单测补齐、README/ARCHITECTURE/LEGAL 更新 | `npm test` 全绿（含原有 2 个修复） |

建议本轮做 **P1 + P2 + P3 + P5 的测试骨架**，P4 只交付规格和脚本骨架——因为素材最终要你自己生成或委托绘制。

---

## 11. 风险与未验证项

| # | 风险 | 影响 | 应对 |
| --- | --- | --- | --- |
| 1 | **本机无 DSH**，无法实机验证 | 中 | 全部按「探测 + 降级」写；加 `DSH_FISH_PET_TRACE` 追踪点；交付时给一份实机验证清单 |
| 2 | DSH 0.2.x 客户端槽位/事件可能变化 | 中 | 不新增对私有 API 的依赖；新消息类型不认识即忽略 |
| 3 | `@deepseek-ai/dsh-tools` 解析不到 | 中 | 动态导入 + 手写同形 ToolDefinition 兜底 |
| 4 | 素材体积（PNG 分层）拖慢首屏 | 低 | 懒加载 + 只在 pose 变化时换 variant；内置包控制在 100KB 内 |
| 5 | 路径穿越 / 恶意 SVG | 高 | 白名单扩展名 + `path.resolve` 前缀校验 + `<img>` 引用（不内联） |
| 6 | 素材版权 | **高** | 仓库只含原创包；`packs/` gitignore；文档与 NOTICE 明示；不提供上游素材转换 |
| 7 | 工具被滥用（模型反复调 `pet_act`） | 低 | 动作队列串行 + 最小间隔 + `durationMs` 上限 |

---

## 12. 待确认的 4 个决策

1. **内置形象的方向**：重绘「泡泡」把它做成标准 rig（推荐，风险最低），还是先做一个「圆润鲸鱼 + 白肚 + 呆萌大眼、无厂商标识」的原创鲸鱼娘风格（更接近你想要的观感，但要严格避开与「溟月」的实质性相似）？
2. **素材格式**：PNG 分层（生成友好，推荐主路径）+ SVG 分件（矢量清晰，内置用）双支持，还是只做一种？
3. **素材目录位置**：用户数据目录（推荐，仓库干净）+ 仓库内 `packs/` 示例，还是都放仓库里（简单但容易误提交）？
4. **本轮范围**：P1+P2+P3（形象 + 装扮 + Agent 接口，一次跑通闭环），还是先只做 P1（先把形象换掉，再谈挂件）？

---

## 13. 实施结果（2026-11-09）

### 13.1 已采纳的决策

| 决策 | 选择 |
| --- | --- |
| 形象方向 | 原创鲸鱼娘风格「泡泡」，与「溟月」在轮廓、配色、服饰、饰品上均无对应关系 |
| 素材格式 | PNG 分层（生成主路径）+ SVG 分件（内置用）双支持 |
| 素材目录 | 仓库 `packs/`（内置与示例），自备素材放 `packs/local/`（gitignore） |
| 范围 | P1 + P2 + P3 + P5 测试，全部落地 |

### 13.2 与原方案的差异（都是实现时发现的）

1. **挂件与图层必须共用一条 z 栈。** 原方案写「先画图层，再叠挂件」，实现后 `back` 槽披风会盖住整张脸。已改为合并排序，并有专门的回归测试。
2. **去掉背鳍图层。** 正视角下它从头发里钻出来像一只角，删掉更干净。
3. **`scarf` 改名 `cape`。** 围巾在「没有脖子」的鱼形身体上必然压在嘴上；改成 `back` 槽的小披风，只露边缘，反而更像回事。
4. **手写 `ToolDefinition`，不引 `@deepseek-ai/dsh-tools`。** 该包是 harness 内部件，profile 里不一定可解析；结构简单，手写更稳。
5. **工具用 `ctx.inject(['tools'])` 而非静态 `inject`。** 静态声明在缺少工具服务的 harness 上会阻止 `apply` 执行——那是「整个插件静默失效」级别的故障。
6. **新增 `PoseFx`。** 表情标记（思考点、星芒、水滴、感叹号）由客户端画，不进素材包；否则换皮肤就会丢性格。
7. **动作优先级不改写 tracker。** `PetDirector` 只覆盖最高层，动作结束后回落到会话姿态。

### 13.3 交付物

| 文件 | 内容 |
| --- | --- |
| `src/packs.js` | 扫描、校验、目录、路径白名单 |
| `src/wardrobe.js` | `resolveWorn` / `applyWear` / `normalizeWorn` / `bySlot` |
| `src/pet.js` | `PetDirector`（队列、TTL、持久动作） |
| `src/tools.js` | `pet_status` / `pet_act` / `pet_wear` / `pet_skin` + 注册器 |
| `packs/paopao/**` | 原创皮肤：13 个 SVG 分件、8 个姿态表情 |
| `packs/{cat-ears,ribbon,round-glasses,cape}` | 四个示例挂件，覆盖 head/neck/face/back 四个槽位 |
| `lib/client.js` | `RigStage`、`PoseFx`、挂件叠层、衣柜 UI、动作动画 |
| `docs/ASSET-GUIDE.md` | 素材包格式与生成规范 |
| `test/{packs,wardrobe,pet,tools,plugin}.test.js` | 37 个新用例，全套 78 个 |

### 13.4 后续补上的

- **实机验证**：已在 DSH `0.2.2-rc.1` 的 web profile 上跑通挂载、路由、工具注册、素材与路径防护、SSE 快照；见 §14。
- **P4 素材生产脚本**：`tools/slice.mjs` 仍未写。实际素材改用一次性脚本（`.preview/`，gitignored）按真实素材定制，比通用切片脚本更贴合。
- **动作精细度**：仍是 CSS 级表现；「走动」「拖尾」这类连续动作需要运动模型，暂未做。

---

## 14. 第二轮：Coo 式分层效果、气泡与窗口外显示（2026-11-09 傍晚）

### 14.1 需求与判断

用户反馈：要用社区「大肥鱼」形象，但做成 Coopanion 那种**分层、状态驱动、可交互**的桌宠；`dsh-pet` 的纯动画播放效果不好；对话框改成头顶简单框；提供 Agent 接口用气泡说话；桌宠要能显示在窗口之外。

判断：上一轮把 7 段动画 WebP 直接当 `expressions`，本质是「视频播放器」。形象可以留，表现方式必须换掉。

### 14.2 实现

| 改动 | 内容 |
| --- | --- |
| 素材（`packs/local/whale-maid/`，gitignored） | 从 idle 动画抽第 24 帧成透明 `base.webp`（22 KB）；新增 8 张整画布 `fx/*.svg` 表情特效；manifest 改为静态立绘常驻 + `clipVariants` 动作短播 + `propsEnabled:true` + `accessoryOverrides` 校准 4 件挂件 |
| 协议 / 校验 | `src/packs.js` 新增 `clipVariants` 白名单与 `clipLayer`（默认首层） |
| 页面渲染 | `RigStage` 增加 clip 模式：只画 `clipLayer`，隐藏 fx 与挂件，停用 CSS 动作；有 `fx` 层时不再画内置 `PoseFx` |
| 头顶气泡 | `Bubble` 去掉署名行与毛玻璃，改成贴头顶、带小尖角的白底圆角框；面板展开时也保持显示 |
| Agent 接口 | `pet_say` + 新增 `POST/GET/DELETE /say` HTTP 入口，共用 `SayBoard`；TTL 到期广播空帧 |
| 悬浮窗 | `src/desktop.js` 加点击穿透轮询（宠物/气泡列与关闭按钮可交互，其余穿透）；`lib/desktop.{html,js}` 重写为纯 DOM 分层 rig 渲染器，与页面内共用 manifest 词汇；DSH session token 经窗口 URL 注入脚本、SSE 与素材请求 |
| 打包 | `package.json` 的 `files` 从 `lib/client.js` 改成 `lib/`，否则悬浮窗两个文件不会随插件分发 |

### 14.3 验证

- `npm test` **89/89 全绿**；新增 clip 渲染、manifest 字段、SayBoard、悬浮窗降级、`/say` 与 token 注入用例。
- DSH `0.2.2-rc.1` web profile 实测：`/packs` 3 皮肤 / 4 挂件 / `errors: []`；`/asset` 的 WebP/SVG 200、路径穿越 404；`/say` 写读清 + SSE 重放；`/desktop` token 注入与 `/desktop.js` 200。
- 本地合成预览（`.preview/full-*.png`）目视确认静态立绘、简单气泡、猫耳 / 眼镜 / 蝴蝶结 / 披风的层序与锚点。

### 14.4 仍待确认

- Electron 悬浮窗的真实开合与拖动只能在 DSH 桌面版验证；`dsh web` 是纯 Node，能力探测会如实降级。
- 配置好模型凭据时的一次成功模型回复未在本机验证。
