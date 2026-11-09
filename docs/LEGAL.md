# 许可证与法律风险说明

> 本文是工程层面的合规梳理，**不是法律意见**。若计划商用、上架应用商店，或收到权利方通知，请咨询执业律师。

---

## 1. 上游许可事实（逐项可核对）

### 1.1 Coopanion（Pal-AI-Lab/Coopanion）

| 项 | 内容 | 出处 |
| --- | --- | --- |
| 主许可 | **AGPL-3.0-or-later** | 仓库根 `LICENSE`、各 package.json `license` |
| 历史许可 | **0.1.10 及更早版本为 MIT** | README 许可证说明 |
| 附加许可 | AGPL 第 7 条附加许可，允许链接 Steamworks API 库 | 根 `LICENSE` 开头 |
| 贡献者协议 | 有 CLA（`CLA.md` v1），签名记录在 `cla-signatures` 分支 | 仓库根 |
| 桌宠包 | `packages/cortico-world-desktop-pet`，`license: AGPL-3.0-or-later`，并入前独立仓库历史为 MIT | 该包 package.json / THIRD_PARTY_NOTICES.md |
| **形象例外** | `web/whale/` 贴图**不在 AGPL 授权范围内** | 该包 `THIRD_PARTY_NOTICES.md` |

`THIRD_PARTY_NOTICES.md` 原文（节选）：

> `web/whale/` 的贴图由 ChatGPT（OpenAI 的图像模型）按参考图生成后拆件：角色原设为「溟月」（上善无形），DeepSeek 女仆装二创参考 ZipZipPipe。围裙上的标志是 DeepSeek、OpenAI、Anthropic（Claude）、Google（Gemini）、阿里云（通义千问）、月之暗面（Kimi）、MiniMax 的商标图形，归各自的公司所有……
> **这些贴图不在本包的 AGPL 授权范围内。** 它们随 Coopanion 分发，想在别处使用请自行确认原设与各家标志的权利。

### 1.2 dsh-dafeiyu（QCYTSN）—— 社区已有的同类插件

| 项 | 内容 |
| --- | --- |
| 代码许可 | **MIT** |
| 当前 `assets/pet/` | 来自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的鲸尾女仆素材，**MIT**（附 `assets/dsh-pet-LICENSE.txt`） |
| 旧 BigFish 帧 | 已归档至 `legacy/dafeiyu/`，**不在 MIT 覆盖范围**。原文：来源于 `QCYTSN/ds-local-pet` v0.2.0 正式运行产物，「derived from a mixture of fan-made DeepSeek-related character views and AI-assisted animation sheets. **Image processing, resizing, or repackaging does not change rights in the underlying artwork. No additional license or warranty is granted**」，且「**Redistribution outside this repository requires permission from the respective rights holders**」 |
| 光标文件 | Chromium 项目的 `hand_grab.cur` / `hand_grabbing.cur` 原样副本，**BSD-3-Clause**，不属 MIT |

### 1.3 形象作者本人的授权声明（关键更正）

本项目早期版本文档曾写「拿不到这套美术的授权」。**该结论不准确，已于 2026-11-09 更正。**

| 项 | 内容 |
| --- | --- |
| 原创角色 | 「溟月」，作者 B 站 **@上善无形** |
| 开放方式 | 2026-08-02 声明：以 **CC BY-NC-SA 4.0** 开放二创——**署名、非商业性使用、相同方式共享** |
| 女仆版二创 | B 站 **@ZipZipPipe**，在溟月基础上加入 DeepSeek 元素；声明遵守同一协议，**不得以任何形式商业化** |
| 动画素材 | GitHub **@PC2005-cloud/dsh-pet**：代码 MIT，宠物形象同样按 CC BY-NC-SA 4.0、禁止商用 |
| 相关声明原文 | 「大肥鱼是遵守 CC BY-NC-SA 4.0 协议的形象，不可以以任何形式商业化。」 |

**这意味着什么**

- ✅ **个人、非商业使用可以**，无需另行取得授权，但必须署名，且衍生作品须以 CC BY-NC-SA 4.0 共享。
- ❌ **不能并入本仓库的 MIT 分发**：NC 限制与 SA 的传染性都与 MIT 冲突。一旦把素材提交进仓库，整个仓库的许可模型就被破坏。
- ❌ **不能商用**：包括打包售卖、付费皮肤、带广告的分发。

### 1.4 一句话结论（修订版）

「大肥鱼」可以合法地**本地非商业使用**，但不能作为 MIT 项目的一部分分发。项目因此把它放在 `packs/local/`（gitignore），由使用者自行放置并自行承担署名义务。

---

## 2. 本项目的主张

| 对象 | 许可 / 状态 |
| --- | --- |
| `src/`、`lib/`、`test/` 全部源码 | **MIT**（`LICENSE`） |
| 内置角色「泡泡」（`lib/client.js` 中的 `FishArt`） | **MIT**，为本项目原创绘制的内联 SVG |
| 动画、配色、布局、状态机 | **MIT**，为项目原创 |
| 第三方美术 / 图标 / 音效 / 字体 | **未包含任何一项** |

我们对「原创」的界定是：不复制、不描摹、不重上色、不基于上游帧做缩放/裁切/再编码，也不使用上游的分件结构作为参照。

---

## 3. 风险矩阵

| # | 风险 | 触发条件 | 等级 | 本项目如何规避 |
| --- | --- | --- | --- | --- |
| 1 | **AGPL 传染** | 复制/改写 Coopanion 任何源码进本仓库 | 高 | 一行未取。展示层为独立实现，未参考其源码实现细节（仅依据 README 与包元数据归纳功能边界） |
| 2 | **AGPL §13 网络条款** | 分发基于 Coopanion 的服务端并对外提供 | 高 | 同上，不适用 |
| 3 | **角色美术侵权** | 把「大肥鱼」贴图/帧**打包进仓库分发** | **极高** | 仓库不分发该素材；只允许使用者放 `packs/local/`（gitignore）。本地非商业使用依 CC BY-NC-SA 4.0 合法，但需署名与同协议共享 |
| 4 | **衍生作品链** | 即使自行重绘，若构成对原设「溟月」的实质性相似改编 | 高 | 内置形象在物种轮廓、配色、服饰、饰品上均与「溟月」不构成对应关系；刻意去掉了围裙与厂商标识 |
| 5 | **商标侵权 / 混淆** | 使用 DeepSeek、OpenAI、Anthropic、Google、阿里云、月之暗面、MiniMax 的图形标志；或以「大肥鱼」自称 | 高 | 插件名 `dsh-neko-pet`、角色名「泡泡」，与上述标识均不同；NOTICE 明示非官方、无关联 |
| 6 | **虚假关联 / 背书** | 名称或文案暗示官方出品 | 中 | README 与 NOTICE 均含「非官方、无隶属关系」声明 |
| 7 | **对上游的间接依赖** | 用户自行把上游素材放进本插件目录 | 中 | 文档明确禁止提交此类素材；仓库不提供下载或转换脚本 |
| 8 | **DMCA / 平台下架** | 权利方投诉 | 中 | 权利基础清晰（源码与美术均为原创），可据 NOTICE 申诉 |
| 9 | **服务商条款** | 查询余额时携带用户 API Key | 低 | 仅在用户显式配置后查询；默认关闭；只访问用户指定的回环/官方地址；不外传 |
| 10 | **依赖供应链** | `@deepseek-ai/schemastery` 版本漂移 | 低 | 精确锁定版本号，不用 caret |

### 3.1 需要你自己判断的三件事

1. **「原创」的边界。** 本项目刻意避开了上游形象的具体表达（鲸鱼娘 + 女仆围裙 + 厂商徽记）。但「一只鲸鱼形状的桌宠」这个**抽象概念**本身不受著作权保护——受保护的是具体表达。若你在此基础上再往「溟月」靠拢，风险会迅速上升。
2. **商用场景。** MIT 允许商用，但不代表你的商用场景没有别的合规问题（例如企业内部审计、应用商店审核对「非官方客户端」的态度）。
3. **历史版本例外。** Coopanion ≤0.1.10 为 MIT。理论上你可以从那个 tag 取码——但那时的代码与本项目目标版本差异很大，且**即便取码，`web/whale/` 贴图仍不受 MIT 覆盖**。这不是一条省事的路。

---

## 4. 本项目明确没有做的事

- ❌ 没有克隆或复制 Coopanion、dsh-dafeiyu 的源码
- ❌ 没有下载、再编码、裁切、缩放任何上游美术帧
- ❌ 没有复现上游的分件（部件拆解）结构或 `describe.json` 描述
- ❌ 没有引入上游的语音模型、Electron 运行时、CUA（电脑操作）能力
- ❌ 没有使用上游的名称、角色名或厂商标识作为本项目的标识

---

## 5. 与上游的关系声明

本项目是**独立的非官方项目**，与 DeepSeek、Pal AI Lab（Coopanion）、QCYTSN（dsh-dafeiyu）及其维护者均无隶属、合作或背书关系。

「DeepSeek」及相关标识是其各自权利人的商标。本项目仅在**描述性、指示性**意义上提及 DeepSeek（说明本插件运行在 DeepSeek Harness 上），不构成商标使用许可，也不暗示任何官方关系。

---

## 6. 想换成你自己的形象？合法的路径

内置形象在 `packs/paopao/`，替换素材包即可换形象。前提是你对所用素材有权利：

**路径 A：自己画 / 委托绘制（最稳）**
保留 `manifest.json` 的字段约定（层、锚点、表情），换成你的图。你拥有著作权，可用任意许可发布。

**路径 B：使用 CC BY-NC-SA 4.0 的「大肥鱼」素材（本地自用）**
原作者已开放二创。做法：

1. 把素材放进 `packs/local/<id>/`（已在 `.gitignore` 中）；
2. `manifest.license` 写 `CC BY-NC-SA 4.0`，并在包内附 `ATTRIBUTION.txt`，署名**上善无形**（原创）与 **ZipZipPipe**（女仆版），注明动画素材来源（如 `PC2005-cloud/dsh-pet`）；
3. 不得商用；对外分发衍生作品时须以 CC BY-NC-SA 4.0 共享；
4. **不要把素材提交进本仓库。**

`packs/local/whale-maid/` 就是按这条路径做的示例：动画从 dsh-pet 的 WebM 抠底、裁边、转码为透明动画 WebP，附完整署名，且不进版本库。

**路径 C：取得原设作者授权**
自行联系权利人取得书面许可。取得后仍建议**不要**把素材提交到公开仓库——本地读取是风险最低的边界。

**路径 D：使用明确宽松许可的第三方形象**
例如 dsh-dafeiyu 曾使用的 `PC2005-cloud/dsh-pet` 素材（注意：该项目的**代码**是 MIT，**形象**是 CC BY-NC-SA）。此时必须原样保留其许可与署名，不声称原创。

无论哪条路，**都不要把不属于你的素材提交进公开仓库**。插件运行时从本地读取，是风险最低的边界。

---

## 7. 素材包（packs/）的边界

自 `0.2.0` 起形象由 `packs/<id>/manifest.json` 描述（格式见 [`ASSET-GUIDE.md`](ASSET-GUIDE.md)）。

| 对象 | 许可 / 状态 |
| --- | --- |
| `packs/paopao`（原创皮肤「泡泡」与四个示例挂件） | **MIT**，为本项目原创绘制 |
| 用户自备素材（`packs/local/`） | 由用户自行负责；不随仓库分发，已在 `.gitignore` 中排除 |
| 按 CC BY-NC-SA 4.0 使用的「大肥鱼」素材（示例：`packs/local/whale-maid/`） | **CC BY-NC-SA 4.0**：署名、非商业、相同方式共享；不进入仓库，不适用本项目的 MIT |
| 由图像模型生成的素材 | 归属与可商用性取决于所用模型的服务条款；本项目不主张其权利，也不将其纳入 MIT |
| 上游「大肥鱼」/「溟月」相关贴图 | 仓库内**不包含**。是否可在本地使用，取决于使用者是否遵守 CC BY-NC-SA 4.0 与「禁止商用」声明 |

实现层面刻意保留的约束：

- 素材只由本地目录读取，经回环 HTTP 以 `<img>` 提供给页面，插件不上传、不代理、不缓存到别处。
- 仓库不内置任何第三方角色美术，也不提供「一键下载/转换上游素材」的脚本；本地转换由使用者自行完成并自负署名义务。
- 素材包的 `license` 字段会被读取并在设置页与 `pet_status` 中呈现，便于使用者自查来源。
- 生成式素材建议放在 `packs/local/`，并在 `manifest.license` 里写明来源（例如「AI 生成，本地自用」）。

---

## 8. 免责

本项目按「现状」提供，不附带任何明示或默示担保。使用者自行承担因使用、修改、分发本项目（含其形象）而产生的全部法律责任。若你是权利方并认为本项目侵犯了你的权利，请通过仓库 issue 联系，我们会及时处理。
