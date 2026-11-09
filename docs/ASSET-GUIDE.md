# 素材包手册（skin / accessory）

一只桌宠的形象由**素材包**描述，代码里没有任何角色坐标。改形象不用改 JS，加挂件不用改 JS。

```
packs/
  paopao/               ← 内置原创皮肤（MIT，随仓库分发）
    manifest.json
    layers/*.svg
  cat-ears/             ← 挂件：猫耳
    manifest.json
    art.svg
  ribbon/               ← 挂件：蝴蝶结
  round-glasses/        ← 挂件：圆眼镜
  cape/                 ← 挂件：小披风
  local/                ← 你自己的包放这里（.gitignore 已排除）
```

一个目录 = 一个包 = `manifest.json` 里 `kind` 决定它是皮肤还是挂件。目录名必须等于 `manifest.id`。

---

## 1. 皮肤 `manifest.json`
```jsonc
{
  "schema": 1,
  "kind": "skin",
  "id": "paopao",                 // 必须等于目录名，^[a-z0-9][a-z0-9._-]*$
  "name": "泡泡",                  // 面板上显示的名字
  "author": "dsh-fish-pet",
  "license": "MIT",               // 必填：素材的权利声明
  "description": "一句话描述",
  "canvas": { "width": 140, "height": 130 },   // 逻辑画布，16..4096
  "anchors": {                     // 归一化 0..1，挂件吸附用
    "head":  [0.5, 0.30],
    "eyes":  [0.5, 0.55],
    "neck":  [0.5, 0.78],
    "spine": [0.5, 0.42],
    "back":  [0.3, 0.55],
    "hand":  [0.3, 0.88]
  },
  "layers": [ /* 见下 */ ],
  "expressions": { /* 见下 */ }
}
```

### 1.1 layers

两种层：

```jsonc
// 单图
{ "id": "body", "src": "layers/body.svg", "z": 10 }

// 变体（表情切换用）
{ "id": "eyes", "z": 20, "motion": "blink", "pivot": [0.493, 0.554],
  "variants": { "open": "layers/eyes-open.svg", "happy": "layers/eyes-happy.svg" } }
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 层名，`expressions` 用它做键 |
| `src` / `variants` | ✅ | 二选一；路径必须是包内相对路径 |
| `z` | — | 叠放顺序，默认 10 + 序号 |
| `motion` | — | `bob` `bob-fast` `wag` `sway` `blink` `hop` `shake` `droop` `spin`，闭集 |
| `pivot` | — | 动画轴心（归一化）；尾巴转轴、眨眼轴心都靠它 |

**层必须是整画布尺寸的透明图**（与 `canvas` 同比例）。这样分件天然对齐，不需要给每件写偏移——图像模型出图后拆层可以直接用。

### 1.2 expressions

姿态 → 每个层选哪个变体。没写到的姿态用 `IDLE`。

```jsonc
"expressions": {
  "IDLE":     { "eyes": "open",  "mouth": "smile" },
  "THINKING": { "eyes": "open",  "mouth": "flat"  },
  "WORKING":  { "eyes": "open",  "mouth": "open"  },
  "WAITING":  { "eyes": "star",  "mouth": "flat"  },
  "SUCCESS":  { "eyes": "happy", "mouth": "open"  },
  "ERROR":    { "eyes": "sleep", "mouth": "flat"  },
  "SLEEP":    { "eyes": "sleep", "mouth": "flat"  },
  "SHY":      { "eyes": "happy", "mouth": "smile" }
}
```

`SLEEP` / `SHY` 用于 `pet_act` 的 `sleep` / `shy`。

### 1.3 accessoryOverrides（皮肤级挂件微调）

挂件的 `scale` / `offset` 是相对**画布宽度**的，所以同一件猫耳在 200px 的线稿皮肤和 512px 的厚涂皮肤上需要不同数值。让皮肤自己声明：

```jsonc
"accessoryOverrides": {
  "cat-ears":      { "scale": 0.30, "offset": [0, 0] },
  "round-glasses": { "scale": 0.34, "offset": [0, 0] },
  "cape":          { "scale": 0.56, "offset": [0, 0] }
}
```

可覆盖的字段：`scale`、`offset`、`pivot`、`anchor`、`z`。渲染时与挂件自身的值合并，挂件的 `id/name/src` 不参与覆盖。

---

## 2. 挂件 `manifest.json`

```jsonc
{
  "schema": 1,
  "kind": "accessory",
  "id": "cat-ears",
  "name": "猫耳",
  "license": "MIT",
  "description": "一对会跟着脑袋轻轻晃的猫耳。",   // 模型会读这一句
  "slot": "head",              // back | body | neck | head | face | hand | effect
  "anchor": "head",            // 吸附到皮肤的哪个锚点
  "offset": [0, 0.02],         // 相对锚点的归一化偏移
  "pivot": [0.5, 0.9],         // 旋转轴心（自己的坐标）
  "scale": 0.46,               // 宽度 = 画布宽度 × scale
  "z": 40,                     // 可省略，默认取槽位固定值
  "motion": "sway",
  "tags": ["cat", "cute"],
  "poses": ["IDLE", "SUCCESS"],  // 可选：只在某些姿态显示
  "stackable": false,            // 可选：同槽位能否叠加
  "src": "art.svg"
}
```

固定层序：`back(6) < body(30) < neck(35) < head(40) < face(45) < hand(48) < effect(50)`。挂件与图层共用一条 z 栈，所以 `back` 槽的披风会正确地画在身体后面。

挂件图**要紧贴内容裁剪**（不是整画布），靠锚点定位。

---

## 3. 添加一个新挂件（30 秒）

1. 建目录 `packs/local/bell/`，放 `art.png` 与 `manifest.json`（`id` 写 `bell`）。

> `packs/local/` 这类「不含 manifest 的目录」会被当作分组容器，往下扫一层，所以私用素材可以和仓库自带素材分开摆。`packs/local/` 已在 `.gitignore` 里。

2. 打开 设置 → 插件 → 小鱼桌宠 → 「重新扫描」。
3. 衣柜里点一下「颈部 · 铃铛」即可戴上；不重启 DSH。
4. 模型也能看到它：`pet_status` 的 `accessories` 里会出现 `bell`，`pet_wear` 就能戴。

命令行等价操作：

```bash
curl -X POST http://127.0.0.1:3080/plugins/dsh-fish-pet/packs
```

---

## 4. 用图像模型生成一套皮肤

### 4.1 画布与分件

- 固定画布（建议 1024×1024），**所有层同一构图、同一画布**，透明背景。
- 一次只出一层，提示词里明确「只输出这一层，不要眼睛/嘴/服饰」。
- 层清单（内置皮肤的最小集）：`tail` `body` `belly` `fin-front` `hair` `eyes-*` `mouth-*` `blush`。
- 出图后按画布对齐，不需要裁切定位；只有挂件需要紧贴裁剪。

### 4.2 提示词骨架

```
分层角色设定图，Q 版圆润鲸鱼形，浅蓝渐变身体 + 米白腹部，大眼圆瞳、腮红、短鳍；
纯透明背景，正视角度，画布 1024×1024；
本次只输出 body 层，不含眼睛、嘴、尾巴、服饰；
不要任何厂商 logo、不要文字、不要水印。
```

### 4.3 校验

```bash
# 复用宿主的校验器，不通过就不会出现在目录里
node -e "import('./src/packs.js').then(({PackRegistry})=>{const r=new PackRegistry({root:'./packs'});console.log(r.reload())})"
```

常见拒绝原因：

| 提示 | 原因 |
| --- | --- |
| `id(x) 与目录名(y) 不一致` | 目录名必须等于 manifest.id |
| `缺少合法 src 或 variants` | 路径含 `..`、绝对路径或非法字符 |
| `slot 必须是 …` | 槽位写错 |
| `canvas 必须是 16..4096` | 画布尺寸错 |
| `layers 为空` | 皮肤至少要有一层 |

---

## 5. 体积与性能

- 内置皮肤 14 个 SVG，合计 < 30 KB；浏览器只在姿态变化时换变体，不重复下载。
- 位图建议单层 ≤ 512 KB，单包 ≤ 5 MB；`<img>` 会走 HTTP 缓存（ETag + 5 分钟）。
- 首屏不等素材：素材目录读不到时自动回退到内置内联形象。

---

## 6. 混合 rig：静态立绘 + 表情层 + 动作片段（推荐）

把整段动画当常驻形象，看起来像「播放器」而不是桌宠。推荐做法是**平时分层静态、动作时才播动画**：

- `base.webp`：从动画里挑一帧干净、睁眼、端正的做静态立绘，透明、整画布、底部对齐；
- `fx/*.svg`：整画布透明的表情特效层，按姿态切思考点、星芒、汗滴、Zzz、腮红；
- `clips/*.webp`：原来的动画片段，只在 `pet_act` 触发时短播。

```jsonc
{
  "id": "whale-maid",
  "canvas": { "width": 220, "height": 300 },
  "layers": [
    { "id": "base", "z": 10, "variants": {
      "still": "base.webp",
      "wave": "clips/wave.webp",
      "sleep": "clips/sleep.webp"
    } },
    { "id": "fx", "z": 60, "variants": {
      "none": "fx/none.svg",
      "thinking": "fx/thinking.svg",
      "success": "fx/success.svg"
    } }
  ],
  "expressions": {
    "IDLE":     { "base": "still", "fx": "none" },
    "THINKING": { "base": "still", "fx": "thinking" },
    "SUCCESS":  { "base": "still", "fx": "success" }
  },
  "actionVariants": { "wave": "wave", "sleep": "sleep" },
  "clipVariants": ["wave", "sleep"],
  "clipLayer": "base",
  "propsEnabled": true,
  "accessoryOverrides": {
    "cat-ears": { "anchor": "head", "scale": 0.42, "offset": [0, -0.02] }
  }
}
```

| 字段 | 作用 |
| --- | --- |
| `clipVariants` | 哪些 variant 是**整段动画**（小写 id，白名单）。命中时进入 clip 模式 |
| `clipLayer` | clip 模式下唯一保留的层，默认 `layers[0]`。其余层、挂件、CSS 动作全部停掉，否则会在动的角色上滑位、叠影 |
| `actionVariants` | 动作 → variant key。`wave` 播挥手动画；没配置的动作（`jump`/`spin`/`shy`）仍由 CSS 作用在静态立绘上 |
| `expressions` | 每个姿态给**每一层**选变体；`none.svg` 是一张空的透明画布，表示「不画特效」 |
| `propsEnabled` | 混合 rig 应保持 `true`，挂件靠 `accessoryOverrides` 校准 |
| `fx` 层 | 有 `fx` 层时客户端不再画内置的 `PoseFx` 标记，避免同一张脸出现两套思考点 |

渲染顺序：`layers` 与挂件合并按 `z` 排序；clip 模式是短路，只画 `clipLayer` 那张动画。两个渲染器（页面内 `lib/client.js`、悬浮窗 `lib/desktop.js`）共用这套词汇表。

制作要点：

- 抽静态帧要挑**睁眼、端正、无遮挡**的一帧；`base` 与 `clips` 必须同一画布、底部对齐，否则切动作会「跳一下」。
- 动画 WebP 建议 8–12 fps、宽 200–240、q 65–75；视频无透明时先抠底（纯黑背景用 `format=rgba,colorkey=black:0.12:0.02`）再转码。
- 挂件必须按新形象重新校准：`scale` 相对画布宽度，`anchor` 必须是皮肤 `anchors` 里有的名字；`back` 槽的 `z` 要小于 `base` 的 `z`，否则会盖脸。
- **不推荐**「全动画皮肤」（所有 `expressions` 指向动画 + `propsEnabled:false`）：没有分层、没有表情切换、也不能穿戴，正是要避开的纯动画效果。

---

## 7. 授权（必读）

- 仓库里的 `packs/paopao` 与四个挂件是**本项目原创**，MIT。
- **不要把他人的角色美术放进公开仓库**。Coopanion 随包贴图不在其 AGPL 内；「大肥鱼」的 CC BY-NC-SA 4.0 也与 MIT 不兼容。
- 自用可以：放 `packs/local/`（已 gitignore），并在包内放 `ATTRIBUTION.txt` 署名原作者、注明非商业。
- 分发前确认你对素材拥有权利，并在 `manifest.license` 里写清楚。
