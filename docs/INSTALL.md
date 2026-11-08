# 安装与排错

在 **Windows 11 + DSH 0.1.1-rc.2 + Node 22.22** 上实测通过。macOS / Linux 的路径规则见 §5。

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
dsh plugin --profile web add git+https://github.com/nekolovebed/dsh-fish-pet.git
```

插件**不需要构建**：`lib/client.js` 是手写的成品，没有 `prepare` 脚本，pnpm 拉下来即可用。

### 安装后必须做的一步

**完全退出 DSH 再重新启动。** 插件的宿主半区与客户端半区都在启动时装载，热重载只覆盖配置、不覆盖新增包。

---

## 3. 验证装好了

```bash
# ① 插件行是否进入组合树
dsh --profile web --dump-config | grep -A3 dsh-fish-pet
```

应能看到：

```yaml
- id: dsh-fish-pet
  name: dsh-fish-pet
  config:
    enabled: true
```

```bash
# ② 宿主路由是否起来（把端口换成你的实际端口）
curl http://127.0.0.1:3080/plugins/dsh-fish-pet/status
```

应返回一段包含 `"pose":"IDLE"` 的 JSON。

```bash
# ③ 客户端包是否分发
curl -o /dev/null -w "%{http_code} %{size_download}\n" http://127.0.0.1:3080/plugins/dsh-fish-pet/client.js
```

应为 `200` 且约 37 KB。

打开 DSH 页面：**右下角应出现一条小鱼**，点击可展开面板。

---

## 4. 配置

两条入口，改的是同一份配置（存在 DSH settings 里，重启不丢）：

- **设置 → 插件 → 小鱼桌宠**（推荐）
- 直接改 `cordis.patch.yml` 里 `dsh-fish-pet` 行的 `config`（改完需重启）

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
| 平台范围 | 插件本身跨平台。桌宠在**页面内**渲染，不需要单独的桌面窗口，因此不涉及 macOS/Windows 的原生窗口差异 |

---

## 6. 排错

### 一条命令打开诊断

插件内置文件级追踪。启动 DSH 时带上环境变量，它会把每一步写到文件里：

```bash
DSH_FISH_PET_TRACE=D:/tmp/fish.log dsh --profile web
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
| 右下角没有鱼 | ① 设置里 `enabled` 是否为开；② `scale` 是否被调到极小；③ 硬刷新页面（`Ctrl+Shift+R`）；④ 确认 `/plugins/dsh-fish-pet/client.js` 返回 200 |
| 设置里没有「小鱼桌宠」卡片 | 客户端半区没挂上。看浏览器控制台是否有 `[dsh-fish-pet]` 报错；确认 `package.json` 的 `exports["./client"]` 未被改坏 |
| 卡片显示「设置尚未连接到 DSH Host」 | 宿主半区没起来。开 `DSH_FISH_PET_TRACE` 看 `mount threw` 的内容 |
| 余额一直 `—` | 预期行为。配置密钥或自定义接口后点面板上的「刷新」 |
| 对话提示「没有提供 agents 服务」 | 当前组合里没有 `ctx.agents`。确认 profile 包含 `@deepseek-ai/dsh-base` |
| 对话回复「缺少模型凭据」之类 | 该 profile 没有配置模型。到 DSH 设置里配好模型与 Key |
| 插件装了但完全没反应 | 开追踪。最常见的两种原因：`inject` 里少声明了服务（Cordis 会抛 `cannot get property … without inject`，而该异常可能被兜底 catch 吞掉），或入口路径写成了非 `file://` 形式 |

### 完全卸载

```bash
dsh plugin --profile web remove dsh-fish-pet
```

然后重启 DSH。配置文件里残留的 `dsh-fish-pet` 行不影响启动（找不到模块会被忽略），也可以在 `cordis.patch.yml` 里手动删掉。

---

## 7. 安全边界

- 所有 HTTP 路由**只监听回环地址**，并校验 `Origin` 与 `Host` 一致，跨站请求返回 403。
- 除你显式配置的余额接口外，插件**不发起任何外部网络请求**。
- 对话走 DSH 自己的会话，工具权限完全沿用 DSH 的既有配置——插件不额外扩权。
- 面板上的 `balanceApiKey` 以 `password` 输入框呈现，且只在本地回环接口之间传输。
