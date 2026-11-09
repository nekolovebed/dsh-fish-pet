# 安装与排错

在 **Windows 11 + DSH 0.2.2-rc.1 + Node 22.22** 上实测通过。macOS / Linux 的路径规则见 §5。

---

## 1. 前置条件

- 已安装并能正常启动 DeepSeek Harness（`dsh --version` 有输出即可）
- Node.js ≥ 22.19（DSH 自带运行时通常已满足）
- 一个可用的 DSH profile，一般是 `web`

---

## 2. 安装

### 方式 A：从本地目录安装（开发/自用推荐）

```bash
# 先装依赖（插件自身只有一个运行时依赖）
cd D:/MyProject/DSH-PET
npm install

# 装进 web profile
dsh plugin --profile web add D:/MyProject/DSH-PET
```

> Windows 路径请用 `D:/MyProject/DSH-PET` 这种正斜杠形式。git-bash 风格（`/d/...`）也能装上，但生成的软链目标在部分工具链下不友好。

### 方式 B：从 GitHub 安装

```bash
dsh plugin --profile web add git+https://github.com/nekolovebed/dsh-neko-pet.git
```

插件**不需要构建**：`lib/` 下都是手写的成品（`client.js`、`desktop.html`、`desktop.js`），没有 `prepare` 脚本，pnpm 拉下来即可用。桌面悬浮窗的两个文件也通过 `package.json` 的 `files: ["lib/"]` 一起分发。

### 安装后必须做的一步

**完全退出 DSH 再重新启动。** 插件的宿主半区与客户端半区都在启动时装载，热重载只覆盖配置、不覆盖新增包。

---

## 3. 验证装好了

```bash
# ① 插件行是否进入组合树
dsh --profile web --dump-config | grep -A3 dsh-neko-pet
```

应能看到：

```yaml
- id: dsh-neko-pet
  name: dsh-neko-pet
  config:
    enabled: true
```

```bash
# ② 宿主路由是否起来（把端口换成你的实际端口）
curl http://127.0.0.1:3080/plugins/dsh-neko-pet/status
```

应返回一段包含 `"pose":"IDLE"` 的 JSON。

```bash
# ③ 客户端包是否分发
curl -o /dev/null -w "%{http_code} %{size_download}\n" http://127.0.0.1:3080/plugins/dsh-neko-pet/client.js
```

应为 `200` 且约 55 KB。

打开 DSH 页面：**右下角应出现一条小鱼**，点击可展开面板。

---

## 4. 配置

两条入口，改的是同一份配置（存在 DSH settings 里，重启不丢）：

- **设置 → 插件 → 小鱼桌宠**（推荐）
- 直接改 `cordis.patch.yml` 里 `dsh-neko-pet` 行的 `config`（改完需重启）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `scale` | `1` | 宠物大小 0.6–1.8 |
| `bubble` | `true` | 头顶气泡（显示状态或最近一句对话） |
| `showBalance` | `true` | 面板顶部显示余额 |
| `balanceProvider` | `auto` | `auto` / `deepseek` / `custom` / `off` |
| `balanceApiKey` | 空 | 余额查询密钥；留空则读环境变量 `DEEPSEEK_API_KEY` |
| `balanceBaseUrl` | 空 | 兼容接口地址，留空用 `https://api.deepseek.com` |
| `balanceUrl` | 空 | 自定义余额接口完整地址（`custom` 时用） |
| `balanceJsonPath` | 空 | 自定义接口中余额字段路径，如 `data.balance` |
| `priceInputPerMillion` | `0` | 输入单价（元/百万 token），用于估算费用 |
| `priceOutputPerMillion` | `0` | 输出单价（元/百万 token） |
| `chatEnabled` | `true` | 面板内对话开关 |
| `chatMode` | `session` | `session` = 走真实 DSH 会话（可用工具）；`off` = 只展示 |
| `chatCwd` | 空 | 桌宠会话的工作目录，留空用 DSH 进程当前目录 |
| `maxTasks` | `6` | 面板保留的任务条数 |
| `skinId` | `paopao` | 当前皮肤包 id |
| `worn` | `[]` | 已穿戴挂件 id 列表（设置页、HTTP、Agent 三条写路径共用槽位规则） |
| `assetsEnabled` | `true` | 关掉后回退到内置内联形象 |
| `packsDir` | 空 | 自定义素材根目录，留空用仓库 `packs/` |

### 头顶气泡与 Agent 接口

气泡就是桌宠头顶那一个简单圆角框，内容优先级：`pet_say` > `pet_act` 台词 > 最近一句对话 > 会话阶段。

模型侧调用 `pet_say({ text, durationMs })`；不经过工具注册表时可以直接打 HTTP：

```bash
curl -X POST -H 'content-type: application/json' \
  -d '{"text":"报告写完啦","durationMs":6000}' \
  http://127.0.0.1:3080/plugins/dsh-neko-pet/say
curl http://127.0.0.1:3080/plugins/dsh-neko-pet/say     # 读当前气泡
curl -X DELETE http://127.0.0.1:3080/plugins/dsh-neko-pet/say  # 提前清空
```

### 窗口外悬浮窗

设置 → 插件 → 小鱼桌宠 →「桌面悬浮窗」→「打开悬浮窗」。仅 **DSH 桌面版（Electron）** 支持：`dsh web` 是纯 Node，按钮会提示不支持，页面内桌宠照常工作。

窗口透明、无边框、置顶、不进任务栏；只有宠物/气泡所在列和右上角关闭按钮接收鼠标（可拖动、可关闭），其余透明区域点击穿透。DSH Web UI 的 session token 会随窗口 URL 带到 SSE 与素材请求上。

### 关于余额

- **默认会显示 `—`**，这是正常的：余额必须问服务商，没有配置就查不到。
- 填了 `balanceApiKey`（或设置 `DEEPSEEK_API_KEY`）后，`auto` 会自动走 DeepSeek 官方 `/user/balance`。
- 其他厂商请用 `custom` + `balanceUrl` + `balanceJsonPath`。
- **费用是估算**：只有在填了单价后才会出现，且完全基于你填的数字，不代表账单。

---

## 5. 路径与平台注意

| 场景 | 规则 |
| --- | --- |
| `dsh plugin add` 的路径 | 用 `D:/xxx` 正斜杠；避免 `/d/xxx` |
| `cordis.yml` / patch 里写**文件绝对路径** | 必须是 `file:///D:/xxx.js`。写 `D:/xxx.js` 会报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`（被当成协议 `d:`）；写 `/d/xxx.js` 会被解析成 `C:\d\…` |
| 平台范围 | 插件本身跨平台，页面内桌宠不需要原生窗口。可选的悬浮窗依赖 Electron 的 `BrowserWindow`：仅 DSH 桌面版可用，`dsh web` 会降级；macOS 上 `transparent` 窗口与 `setVisibleOnAllWorkspaces` 的行为与 Windows 略有差异 |

---

## 6. 排错

### 一条命令打开诊断

插件内置文件级追踪。启动 DSH 时带上环境变量，它会把每一步写到文件里：

```bash
DSH_NEKO_PET_TRACE=D:/tmp/fish.log dsh --profile web
```

正常应看到：

```
apply called; inject=function get=function
mount start; hasSettings=function
settings ready; scope=function
calling ctx.inject([webServer])
ctx.inject returned
registerRoutes fired; webServer=object register=function
```

没到 `registerRoutes fired` 就说明宿主没装配完；`mount threw: …` 会直接给出原因。

### 常见现象

| 现象 | 原因与处理 |
| --- | --- |
| 右下角没有鱼 | ① 设置里 `enabled` 是否为开；② `scale` 是否被调到极小；③ 硬刷新页面（`Ctrl+Shift+R`）；④ 确认 `/plugins/dsh-neko-pet/client.js` 返回 200 |
| 设置里没有「小鱼桌宠」卡片 | 客户端半区没挂上。看浏览器控制台是否有 `[dsh-neko-pet]` 报错；确认 `package.json` 的 `exports["./client"]` 未被改坏 |
| 卡片显示「设置尚未连接到 DSH Host」 | 宿主半区没起来。开 `DSH_NEKO_PET_TRACE` 看 `mount threw` 的内容 |
| 余额一直 `—` | 预期行为。配置密钥或自定义接口后点面板上的「刷新」 |
| 对话提示「没有提供 agents 服务」 | 当前组合里没有 `ctx.agents`。确认 profile 包含 `@deepseek-ai/dsh-base` |
| 对话回复「缺少模型凭据」之类 | 该 profile 没有配置模型。到 DSH 设置里配好模型与 Key |
| 插件装了但完全没反应 | 开追踪。最常见的两种原因：`inject` 里少声明了服务（Cordis 会抛 `cannot get property … without inject`，而该异常可能被兜底 catch 吞掉），或入口路径写成了非 `file://` 形式 |
| 素材包里看不到新皮肤/挂件 | ① 目录名是否等于 `manifest.id`；② `manifest.json` 是否在包根目录；③ 设置卡片点「重新扫描」；④ `curl /plugins/dsh-neko-pet/packs` 看 `errors` 里的原因 |
| 挂件戴上了但看不见 | 检查 `anchor` 是否为皮肤 `anchors` 里存在的名字；`z` 太小会被身体盖住；`scale` 是否接近 0 |
| 模型不知道有桌宠工具 | 该 profile 没有 `ctx.tools`，或组合里没有工具注册表。`pet_*` 只在有 tools 服务时注册，桌宠显示不受影响 |
| 悬浮窗按钮显示「当前环境不支持」 | 你开的是 `dsh web`（纯 Node）。换成 DSH 桌面版；页面内桌宠不受影响 |
| 悬浮窗打开后是空白 | 看 `DSH_NEKO_PET_TRACE` 里有没有 `desktop window load failed`。多数是 session token 没带过去，确认 Web UI 的 URL 带 `?token=` |
| 桌宠一直像在循环放视频 | 这是「全动画」皮肤。按 [ASSET-GUIDE.md](ASSET-GUIDE.md) §6 改成静态立绘 + `fx` 层 + `clipVariants`，动画只在动作时短播 |

### 完全卸载

```bash
dsh plugin --profile web remove dsh-neko-pet
```

然后重启 DSH。配置文件里残留的 `dsh-neko-pet` 行不影响启动（找不到模块会被忽略），也可以在 `cordis.patch.yml` 里手动删掉。

---

## 7. 安全边界

- 所有 HTTP 路由**只监听回环地址**，并校验 `Origin` 与 `Host` 一致，跨站请求返回 403。
- 除你显式配置的余额接口外，插件**不发起任何外部网络请求**。
- 对话走 DSH 自己的会话，工具权限完全沿用 DSH 的既有配置——插件不额外扩权。
- 面板上的 `balanceApiKey` 以 `password` 输入框呈现，且只在本地回环接口之间传输。
- 素材只从配置的本地目录读取，经回环 HTTP 以 `<img>` 提供；路径做了白名单与前缀校验，`.json` 不能通过素材路由读取，SVG 响应带 `CSP default-src 'none'`。
- `/say` 与 `/desktop` 沿用同一套回环 + Origin/Host 校验；气泡文本上限 160 字、TTL 1.2–60 秒，不写任何文件。悬浮窗 `sandbox: true`、`nodeIntegration: false`，页面只能访问同源插件路由。

---

## 8. 素材包、气泡与 Agent 工具的验收清单

以下命令已在 DSH `0.2.2-rc.1` 的 web profile 上跑过（端口换成你的实际端口）。

```bash
# ① 素材目录
curl -s http://127.0.0.1:3080/plugins/dsh-neko-pet/packs | head -c 300
# 期望：skins 里有 paopao（自备包放 packs/local/ 后会一并出现），
#       accessories 里有 cat-ears / ribbon / round-glasses / cape，errors 为空

# ② 素材文件
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
  "http://127.0.0.1:3080/plugins/dsh-neko-pet/asset?pack=paopao&path=layers%2Fbody.svg"
# 期望：200 image/svg+xml

# ③ 路径防护
curl -s -o /dev/null -w "%{http_code}\n" \
  "http://127.0.0.1:3080/plugins/dsh-neko-pet/asset?pack=paopao&path=..%2F..%2Fpackage.json"
# 期望：404

# ④ Agent 气泡
curl -s -X POST -H 'content-type: application/json' \
  -d '{"text":"验收一下","durationMs":6000}' \
  http://127.0.0.1:3080/plugins/dsh-neko-pet/say
# 期望：{"ok":true,...}，头顶气泡立刻变成这句话，6 秒后消失

# ⑤ 悬浮窗页面（页面里会自动带 token；这里手工模拟）
curl -s "http://127.0.0.1:3080/plugins/dsh-neko-pet/desktop?token=abc" | grep desktop.js
# 期望：script src 带 ?token=abc；再 curl /desktop.js 应为 200
```

页面上：

- [ ] 右下角是**分层立绘常驻**，不是一直循环播放的动画
- [ ] 思考 / 干活 / 成功 / 出错时，头顶与脸侧的**特效层会切换**（静态立绘 + `fx`）
- [ ] 执行 `pet_act wave` 时短暂播放挥手动画片段，期间挂件与特效消失，动作结束自动回到静态 rig
- [ ] 头顶是**一个简单圆角框**，没有署名行；`pet_say` 的话优先显示且到期消失
- [ ] 设置 → 小鱼桌宠 →「素材与衣柜」能看到皮肤与 4 件挂件
- [ ] 点「头部 · 猫耳」立即出现；点「背后 · 小披风」披风在身体**后面**，不遮脸
- [ ] 刷新页面，穿戴状态仍在

对模型说：

- [ ] 「用 pet_status 看看桌宠现在什么样」→ 返回值里有 `accessories` / `skins` / `actions`
- [ ] 「让它说一句『写完啦』」→ `pet_say`，头顶气泡出现这句话
- [ ] 「让它挥个手」→ `pet_act`，播放挥手片段
- [ ] 「给它戴上猫耳」→ `pet_wear`，页面出现猫耳

新增素材：

- [ ] 往 `packs/local/bell/` 放一个合法包，点「重新扫描」→ 衣柜出现「颈部 · 铃铛」
- [ ] 不重启 DSH，模型也能在 `pet_status` 里看到 `bell`

悬浮窗（仅 DSH 桌面版）：

- [ ] 设置里点「打开悬浮窗」→ 窗口出现在浏览器窗口之外，透明置顶
- [ ] 拖动宠物可移动窗口；鼠标移到透明空白区时点击能穿透到下层应用
- [ ] 右上角 × 可关闭；`dsh web` 下按钮显示「不支持」且页面内桌宠不受影响

降级：

- [ ] 把 `packsDir` 指向空目录（或关掉 `assetsEnabled`）→ 页面仍显示内置内联形象，不白屏
