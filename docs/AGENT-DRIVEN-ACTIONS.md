# 让 Agent 驱动桌宠动作

> **实现状态（2026-11-09）**：本文的 T0–T3 分层、封闭词汇表与四道闸已落地。
> 已实现：`pet_move` 工具（look/walk/reset）、`Kind.MOTION` 通道、视线视差（manifest 层级 `gaze` 系数）、
> 走路（容器位移过渡 + `fp-walking` 动画加速）、`desk-pet` skill 运行时注册（实测通过）。
> 未实现：逐帧表情的连续插值（情绪层仍是离散姿态）、多会话租约、限流配置。

## 0. 一句话结论

给 Agent 一个**封闭的语义动作词汇表**，配一个**自描述的能力清单**，用 **4 层控制模型**把「Agent 的一次决定」和「每帧的连续动画」解耦。

**Agent 只负责"选"和"参数化"，动作库在离线编写。** 这是"驱动"和"假装动"的分界线。

---

## 1. 先排除错误做法

| 做法 | 为什么不行 |
| --- | --- |
| Agent 生成一段 CSS/JS 动画代码注入页面 | 不可审计、不可回滚、随时能画出越界的东西；本质就是"写个动作假装动" |
| Agent 直接写动画帧序列 / 关键帧 JSON | 模型对时间和缓动没有可靠直觉，产出多半难看；而且无法与现有姿态混合 |
| Agent 每帧都下指令 | 每帧一次工具调用，token 成本爆炸，且模型延迟远高于 16ms |
| 只给 6 个固定姿态 | 表达力不够，做不出"摇尾巴""走过去"这类连续动作 |

**正确形态**：Agent 调用工具 → 工具产生**参数意图** → 客户端把意图**积分**成连续动画。中间那层参数空间是受控的。

---

## 2. 四层控制模型（核心）

不同频率的控制必须有不同归属。混在一起，要么卡顿，要么烧钱。

| 层 | 由谁驱动 | 频率 | 是否花 token | 例子 |
| --- | --- | --- | --- | --- |
| **T0 待机微动** | 客户端本地 | 每帧 | 否 | 呼吸、眨眼、偶尔转头、尾巴惯性 |
| **T1 会话姿态** | `session/event` 自动 | 每事件 | 否 | 思考/干活/等确认/完成/出错 |
| **T2 Agent 意图** | 工具调用 | 每次决定 | 是 | 摇尾巴、走过去、看某处、点头 |
| **T3 持久状态** | 工具调用 | 变更时 | 是 | 装备猫耳、情绪基调、当前位置 |

合成顺序（后者压前者）：`T0 → T1 → T2 → T3`。

**T0 必须本地。** 眨眼、呼吸这类每 3 秒一次的微动如果走 Agent，一天能烧掉一顿饭钱，而且会有肉眼可见的延迟。

---

## 3. 参数契约（唯一真源）

Agent 能影响的东西，全部落在这个表里。**表外的参数一律拒绝**。

### 3.1 偏移量类（可叠加，相加后 clamp）

| 参数 | 范围 | 含义 |
| --- | --- | --- |
| `leanX` | −1..1 | 左右倾 |
| `leanY` | −1..1 | 上下沉浮 |
| `bodyBob` | 0..1 | 身体起伏幅度 |
| `headTilt` | −1..1 | 歪头 |
| `headNod` | −1..1 | 点头 |
| `tailWagAmp` | 0..1 | 尾巴摆幅 |
| `tailWagSpeed` | 0..1 | 尾巴摆速 |
| `mouthOpen` | 0..1 | 张嘴 |
| `browRaise` | −1..1 | 挑眉 |

### 3.2 状态量类（高优先级覆盖）

| 参数 | 取值 | 含义 |
| --- | --- | --- |
| `gazeTarget` | `front` \| `cursor` \| `left` \| `right` \| `up` \| `down` | 看哪儿 |
| `gazeX` / `gazeY` | −1..1 | 精确注视（覆盖 `gazeTarget`） |
| `walkDir` | `-1` \| `0` \| `1` | 行走方向 |
| `walkSpeed` | 0..1 | 行走速度 |
| `targetX` | 0..1 | 目标位置（视口归一化） |
| `mood` | `neutral` \| `happy` \| `curious` \| `sleepy` \| `annoyed` \| `proud` | 情绪基调 |

### 3.3 触发类（一次性，不进持续合成）

`hop`、`shake`、`stretch`、`sit`、`sleep`

### 3.4 装备参数（装上了才存在）

| 参数 | 出现条件 |
| --- | --- |
| `earTwitch` | 装备含 `earTwitch` 的物品（如猫耳） |
| `clothSway` | 装备含 `clothSway` 的物品（如裙子/围裙） |
| `glassesGlint` | 装备眼镜 |

**这就是"感知"的关键**：参数不是写死的全集，而是随装备**动态出现/消失**。

---

## 4. 自描述 rig（Agent 感知的载体）

`rig.json` 里声明参数与挂点，而不是在代码里硬编码"猫耳"。

```jsonc
{
  "params": [
    { "id": "tailWagAmp", "range": [0, 1], "desc": "尾巴摆幅" },
    { "id": "earTwitch",  "range": [0, 1], "desc": "耳朵抖动", "from": "ear-cat" },
    { "id": "clothSway",  "range": [0, 1], "desc": "布料摆动", "from": "apron" }
  ],
  "slots": {
    "head": { "attach": [512, 520] },
    "body": { "attach": [512, 760] },
    "neck": { "attach": [512, 640] }
  },
  "items": [
    { "id": "ear-cat", "label": "猫耳", "slot": "head", "src": "items/ear_cat.webp",
      "params": ["earTwitch"], "z": 30 },
    { "id": "apron",   "label": "围裙", "slot": "body", "src": "items/apron.webp",
      "params": ["clothSway"], "z": 15 }
  ]
}
```

装备一件 → 它声明的参数自动加入总线 → `describe` 结果变化 → Agent 下一轮就"知道"自己多了猫耳可以抖。

**没有这一步，Agent 只能靠提示词里写死"你有猫耳"，一加装备就要改代码。**

---

## 5. 工具面（只开 3 个）

### `pet_describe` — 感知

无参数。返回当前能力快照：

```
姿态: WORKING   位置: 右下 (x=0.82)   情绪: neutral
装备: 猫耳(earTwitch 0-1), 围裙(clothSway 0-1)
可做: wag / walk / look / nod / hop / sit / emote / dress / undress
参数: tailWagAmp 0-1, headTilt -1..1, ...
```

**Agent 动手前先 describe**，这样它看到的是真实状态，不是假设。

### `pet_perform` — 表演

```jsonc
{
  "acts": [
    { "verb": "look", "params": { "at": "cursor" } },
    { "verb": "wag",  "params": { "intensity": 0.9 } },
    { "verb": "walk", "params": { "to": "left" }, "durationMs": 1600 }
  ],
  "durationMs": 4000
}
```

- `acts` **支持批量**：一次工具调用演一串动作。Agent 想说"先看你，再摇尾巴，然后走过去"，不该花三次 round trip。
- `verb` 是白名单枚举；`params` 按 verb 各自的 schema 校验。
- 返回实际生效的参数与被 clamp 的值，让模型能自我纠正。

### `pet_wardrobe` — 换装

```jsonc
{ "op": "equip", "item": "ear-cat" }
```

`op: list | equip | unequip`。换装后 `pet_describe` 立刻反映新参数。

---

## 6. Skill：让 Agent 知道该在什么时候动

用 `ctx.skills` 的**运行时注册**（不需要落文件系统），注册一个 `desk-pet` skill。正文控制在 200 token 内，说清四件事：

1. **它是什么**：页面右下角有一只宠物，是你的分身
2. **能做什么**：verb 清单（一行一个，不要展开 schema）
3. **什么时候该动**：任务开始/完成、等待用户确认、被夸奖、出错时给个反馈
4. **什么时候别动**：不要连续调用、不要每句话都动、用户没在看时收敛

配合渐进披露：skill 正文只在相关时才被加载，不占常驻 context。

> 已核实：本版 DSH 的 `ctx.skills` 支持运行时注册（`SkillRegistration` 允许省略 `provider`），`ctx.tools.register(defineTool({...}))` 可用。

---

## 7. 客户端：分层积分器

```
每帧 (rAF):
  target = 合成(T0 待机, T1 姿态, T2 意图层, T3 持久)
  current += (target - current) * damping      // 临界阻尼，避免抖动
  写 DOM: transform / right / opacity
  TTL 到期的 T2 层淡出并移除
```

- 用 rAF 而不是 CSS 变量插值：需要按层加权、TTL 衰减、跨参数联动，`@property` 撑不住。
- 每帧只做几十次浮点运算 + 一次 style 写入，成本可忽略。
- 行走通过改 `right` 实现，到边界自动转身（`scaleX(-1)`）。

**为什么用参数而不是播放预设动画**：

| | 预设动画（clip） | 参数总线 |
| --- | --- | --- |
| 同时摇尾 + 走路 + 看左边 | 需要预先组合，指数爆炸 | 天然叠加 |
| 加猫耳后抖耳朵 | 每个 clip 都要重做 | 加一个参数即可 |
| 中途被打断 | 硬切 | 平滑转向新目标 |

---

## 8. 四道闸：保证"驱动"不退化成"乱动"

1. **封闭参数空间** —— 表外参数**报错**，不静默忽略（静默忽略会让模型以为生效了）
2. **硬范围 clamp** —— 越界取边界，返回值里如实告知被截断
3. **verb 白名单** —— 只有枚举内的语义动作
4. **动作库离线编写** —— 新增动作必须改代码走 PR，**不允许运行时生成新动作**

第 4 条是本质：Agent 拥有的是**选择权**，不是**创作权**。

---

## 9. 协议扩展

现有 SSE 通道加两类消息即可，客户端向后兼容：

```jsonc
{ "kind": "perf", "acts": [...], "at": 1730000000000 }        // T2 意图
{ "kind": "wardrobe", "equipped": ["ear-cat"], "params": [...] } // T3 装备
```

`state` 消息保持不变（T1 姿态仍由它驱动）。

---

## 10. 风险与对策

| 风险 | 对策 |
| --- | --- |
| **Token 成本**：频繁调用 | `pet_perform` 批量 acts；T0 全部本地；skill 明确"克制"；可选配置限流（每分钟 N 次） |
| **多会话争抢**：两个会话同时指挥 | 每层带 `owner` 与优先级；高优先级会话可抢占，被抢占方收到通知 |
| **感知膨胀**：装备多了 describe 变长 | 参数分组返回，只列当前装备相关项；上限截断 |
| **版本脆弱**：`ctx.tools` / `ctx.skills` 是预览 API | 全部 try/catch 降级；工具注册失败只损失动作能力，姿态照常 |
| **观感漂移**：Agent 反复小幅微调导致抖动 | 参数变化加最小间隔与死区（deadband），小于阈值不写 |

---

## 11. 落地顺序（每步可独立验收）

| 步 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 参数总线 + 分层积分器（客户端） | ✅ 已落地为「T1 姿态 + T2 意图」双通道；连续参数先覆盖 gaze/walk |
| 2 | 把现有 `FishArt` 拆成零件 | ✅ 由 `packs/paopao` 分件完成（他方实现）；gaze 视差复用该分层 |
| 3 | `pet_perform` + `pet_describe` 两个工具 | ✅ 以 `pet_act`/`pet_status` + 新增 `pet_move` 的形态实现 |
| 4 | 注册 `desk-pet` skill | ✅ `ctx.skills.register()` 运行时注册，真实 DSH 实测通过 |
| 5 | `pet_wardrobe` + 装备参数注入 | ✅ 装备已在 `pet_status` 目录中可见（挂件级参数注入待做） |

**尚未落地**（按优先级）：gaze 的眼珠级细分（当前是整头/眼组平移）、walk 的转向翻转（泡泡为正面形象，用倾斜代替）、
连续情绪参数、多会话租约、`pet_perform` 限流配置。
