/**
 * Agent-facing pet tools.
 *
 * Five tools, deliberately small and orthogonal:
 *
 *   pet_status  read: pose, tasks, skin, worn gear and the FULL catalog
 *   pet_act     write: play one animation (optionally with a bubble line)
 *   pet_say     write: put one line in the head bubble
 *   pet_wear    write: wear / remove / clear gear
 *   pet_skin    write: switch the skin pack
 *   pet_move    write: continuous motion — walk somewhere, point the gaze
 *
 * `pet_status` carries the catalog inline. That is the whole point of the
 * feature: a pack dropped into `packs/` becomes visible to the model without a
 * separate discovery tool, and without a restart.
 *
 * Why hand-built definitions instead of `defineTool` from
 * `@deepseek-ai/dsh-tools`: that package is a harness internal and is not
 * resolvable from a profile's `node_modules` (the project already hit this with
 * `dsh-llm`). A `ToolDefinition` is just `ToolSchema` + `output` + `execute`, so
 * building it here keeps the plugin installable and cannot break on a version
 * bump. The shapes below mirror `@deepseek-ai/dsh-tools` 0.0.1-rc.1.
 */
import { ACTION_LABEL, Action, GAZE_TARGETS, SLOTS, SLOT_LABEL, ACTION_DURATION, WALK_TARGETS } from './protocol.js'
import { applyWear, resolveWorn } from './wardrobe.js'

const OUTPUT_SCHEMA = { type: 'object' }

function textResult(value) {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

function objectSchema(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}

function describeAccessory(item) {
  const bits = [item.slot ? SLOT_LABEL[item.slot] || item.slot : '未知槽位']
  if (item.tags?.length) bits.push(item.tags.join('/'))
  if (item.description) bits.push(item.description)
  return `${item.name}（${item.id}）· ${bits.join(' · ')}`
}

/**
 * @param {object} deps
 * @param {import('./packs.js').PackRegistry} deps.packs
 * @param {import('./pet.js').PetDirector} deps.director
 * @param {import('./motion.js').MotionDirector} [deps.motion]
 * @param {import('./say.js').SayBoard} [deps.say]
 * @param {() => object} deps.getConfig
 * @param {(patch: object) => Promise<object>} deps.patchConfig
 * @param {() => object} [deps.tracker] returns `{ stateMessage(), tasksMessage(), usageMessage(pricing) }`
 * @param {() => object} [deps.reloadPacks]
 */
export function createPetTools(deps) {
  const { packs, director, motion, say, getConfig, patchConfig, tracker, reloadPacks } = deps

  const readCatalog = () => {
    // A cheap mtime-guarded rescan: drop a pack in, call the tool, see it.
    if (typeof reloadPacks === 'function') reloadPacks({ quiet: true })
    return packs.catalog()
  }

  const statusTool = {
    name: 'pet_status',
    description:
      '读取桌宠（页面右下角的小鱼）当前状态：姿态、最近任务、正在播放的动作、当前皮肤、已穿戴挂件，以及素材包里所有可用皮肤与挂件的清单（含 id、槽位与描述）。'
      + '想知道“现在能给它戴什么”或“它身上有什么”时调用这个工具。',
    parameters: objectSchema({
      detail: {
        type: 'string',
        enum: ['brief', 'full'],
        description: 'brief 只返回状态与目录；full 额外返回任务清单与 token 用量。默认 brief。',
      },
    }),
    output: { schema: OUTPUT_SCHEMA, render: (_args, value) => textResult(value) },
    async execute(args) {
      const config = getConfig()
      const catalog = readCatalog()
      const { items, worn, rejected } = resolveWorn(config.worn, catalog)
      const skin = catalog.skins.find((entry) => entry.id === config.skinId) ?? catalog.skins[0] ?? null
      const state = tracker?.().stateMessage?.() ?? {}
      const detail = args?.detail === 'full' ? 'full' : 'brief'

      const result = {
        ok: true,
        state: {
          pose: state.pose ?? 'IDLE',
          stage: state.stage ?? '',
          detail: state.detail ?? '',
          action: director.active ? { action: director.active.action, until: director.active.until } : null,
          motion: motion ? motion.snapshot() : null,
        },
        skin: skin ? { id: skin.id, name: skin.name, license: skin.license } : null,
        worn,
        wearing: items.map((item) => ({ id: item.id, name: item.name, slot: item.slot, z: item.z })),
        unavailable: rejected,
        actions: Object.values(Action).map((action) => ({
          id: action,
          label: ACTION_LABEL[action],
          durationMs: ACTION_DURATION[action],
        })),
        accessories: catalog.accessories.map((item) => ({
          id: item.id,
          name: item.name,
          slot: item.slot,
          slotLabel: SLOT_LABEL[item.slot] || item.slot,
          tags: item.tags,
          description: item.description,
          poses: item.poses,
          summary: describeAccessory(item),
        })),
        skins: catalog.skins.map((entry) => ({
          id: entry.id, name: entry.name, license: entry.license, builtin: entry.builtin === true,
        })),
        slots: SLOTS.map((slot) => ({ id: slot, label: SLOT_LABEL[slot] })),
        packs: {
          root: catalog.root,
          updatedAt: catalog.updatedAt,
          errors: catalog.errors.map((error) => `${error.pack || '(root)'}: ${error.reason}`).slice(0, 8),
        },
      }

      if (detail === 'full') {
        const tasks = tracker?.().tasksMessage?.() ?? { items: [] }
        const usage = tracker?.().usageMessage?.(config) ?? {}
        result.tasks = Array.isArray(tasks.items) ? tasks.items.slice(0, 5) : []
        result.usage = {
          input: usage.input ?? 0,
          output: usage.output ?? 0,
          dayInput: usage.dayInput ?? 0,
          dayOutput: usage.dayOutput ?? 0,
          turns: usage.turns ?? 0,
        }
      }
      return result
    },
  }

  const actTool = {
    name: 'pet_act',
    description:
      '让桌宠做一个动作：挥手 wave、跳一下 jump、转圈 spin、跳舞 dance、打盹 sleep、欢呼 cheer、害羞 shy、发呆 think。'
      + '可以同时给一句气泡台词（text，最多 120 字）。想让它对用户说点什么、或对任务结果做个反应时调用。',
    parameters: objectSchema({
      action: {
        type: 'string',
        enum: Object.values(Action),
        description: '动作 id',
      },
      text: {
        type: 'string',
        description: '气泡里显示的台词，可省略',
      },
      durationMs: {
        type: 'integer',
        description: '持续时间（毫秒），留空用该动作的默认时长；sleep/think 会一直保持到被替换',
      },
    }, ['action']),
    output: { schema: OUTPUT_SCHEMA, render: (_args, value) => textResult(value) },
    async execute(args) {
      const result = director.act({ action: args?.action, text: args?.text, durationMs: args?.durationMs })
      return {
        ...result,
        label: ACTION_LABEL[result.action] ?? result.action,
        hint: result.queued ? '前面还有动作，这一段排队播放' : undefined,
      }
    },
  }

  const sayTool = {
    name: 'pet_say',
    description:
      '让桌宠在头顶气泡里说一句话（最多 160 字），用于汇报进度、吐槽、提醒或单纯卖萌。'
      + '气泡会自动消失；想同时做个动作就用 pet_act，它也能带一句台词。',
    parameters: objectSchema({
      text: { type: 'string', description: '要说的话' },
      durationMs: { type: 'integer', description: '气泡停留时长（毫秒），默认 6000，范围 1200–60000' },
    }, ['text']),
    output: { schema: OUTPUT_SCHEMA, render: (_args, value) => textResult(value) },
    async execute(args) {
      if (!say || typeof say.say !== 'function') {
        return { ok: false, reason: '当前宿主没有气泡通道' }
      }
      return say.say({ text: args?.text, durationMs: args?.durationMs })
    },
  }

  const wearTool = {
    name: 'pet_wear',
    description:
      '给桌宠穿脱挂件（猫耳、蝴蝶结、眼镜等）。op=wear 戴上（同槽位会自动替换）、op=remove 脱下、op=clear 全脱。'
      + 'item 传挂件 id，可先用 pet_status 查目录。',
    parameters: objectSchema({
      op: { type: 'string', enum: ['wear', 'remove', 'clear'], description: '操作' },
      item: { type: 'string', description: '挂件 id（wear/remove 必填）' },
      slot: { type: 'string', enum: SLOTS, description: '可选槽位校验，防止戴错部位' },
    }, ['op']),
    output: { schema: OUTPUT_SCHEMA, render: (_args, value) => textResult(value) },
    async execute(args) {
      const config = getConfig()
      const catalog = readCatalog()
      const outcome = applyWear({
        worn: config.worn,
        catalog,
        op: args?.op,
        item: args?.item,
        slot: args?.slot,
      })
      if (!outcome.ok) {
        return { ok: false, reason: outcome.reason, worn: config.worn, rejected: outcome.rejected }
      }
      const next = await patchConfig({ worn: outcome.worn })
      const resolved = resolveWorn(next?.worn ?? outcome.worn, catalog)
      return {
        ok: true,
        worn: resolved.worn,
        wearing: resolved.items.map((item) => ({ id: item.id, name: item.name, slot: item.slot })),
        rejected: outcome.rejected,
        note: outcome.reason,
      }
    },
  }

  const skinTool = {
    name: 'pet_skin',
    description: '查看或切换桌宠皮肤。不带参数返回当前皮肤与可选列表；带 id 则切换。',
    parameters: objectSchema({
      id: { type: 'string', description: '皮肤包 id，省略则只查询' },
    }),
    output: { schema: OUTPUT_SCHEMA, render: (_args, value) => textResult(value) },
    async execute(args) {
      const config = getConfig()
      const catalog = readCatalog()
      const available = catalog.skins.map((entry) => ({ id: entry.id, name: entry.name, license: entry.license }))
      const id = typeof args?.id === 'string' ? args.id.trim() : ''
      if (!id) return { ok: true, skinId: config.skinId, available }
      const target = catalog.skins.find((entry) => entry.id === id)
      if (!target) {
        return { ok: false, reason: `没有皮肤 ${id}`, skinId: config.skinId, available }
      }
      const next = await patchConfig({ skinId: id })
      return { ok: true, skinId: next?.skinId ?? id, name: target.name, available }
    },
  }

  /**
   * Continuous motion. Kept separate from `pet_act` on purpose: clips are
   * discrete performances, gaze and walking are sticky states that must
   * compose with everything else (the pet walks while a dance clip plays).
   */
  const moveTool = {
    name: 'pet_move',
    description:
      '移动桌宠或转移它的视线。op=look 让它看向某处（at=cursor 跟随鼠标 / left / right / up / down / front，或给 x、y 各 -1..1）；'
      + 'op=walk 让它走到屏幕某处（to=left / right / center，或 0..1 的视口位置，0 是最左）；op=reset 恢复默认。'
      + '这些是持续状态，会与 pet_act 的动作叠加：它可以一边走一边挥手。',
    parameters: objectSchema({
      op: { type: 'string', enum: ['look', 'walk', 'reset'], description: '操作' },
      at: {
        type: 'string',
        enum: GAZE_TARGETS,
        description: 'look 的目标；省略 at 时可用 x/y 精确指定',
      },
      x: { type: 'number', description: 'look 的水平偏移，-1..1，0 是正前方' },
      y: { type: 'number', description: 'look 的垂直偏移，-1..1，0 是正前方' },
      to: { type: 'string', description: `walk 的目的地：${WALK_TARGETS.join('/')}，或 0..1 的视口位置字符串` },
      durationMs: { type: 'integer', description: '持续时间（毫秒）。walk 400–20000，look 300–60000；省略用默认值' },
      scope: { type: 'string', enum: ['all', 'gaze', 'walk'], description: 'reset 的范围，默认 all' },
    }, ['op']),
    output: { schema: OUTPUT_SCHEMA, render: (_args, value) => textResult(value) },
    async execute(args) {
      if (!motion || typeof motion.look !== 'function') {
        return { ok: false, reason: '当前宿主没有运动通道（版本过旧）' }
      }
      const op = args?.op
      if (op === 'look') return motion.look({ at: args?.at, x: args?.x, y: args?.y, durationMs: args?.durationMs })
      if (op === 'walk') return motion.walk({ to: args?.to, durationMs: args?.durationMs })
      if (op === 'reset') return motion.reset({ scope: args?.scope })
      return { ok: false, reason: `未知操作 ${op}，可用 look / walk / reset` }
    },
  }

  return [statusTool, actTool, sayTool, wearTool, skinTool, moveTool]
}

/**
 * Register every tool against a Cordis context that exposes `ctx.tools`.
 * @returns {() => void} disposer (registration through ctx also auto-disposes)
 */
export function registerPetTools(ctx, deps, options = {}) {
  const warn = typeof options.warn === 'function' ? options.warn : () => {}
  const disposers = []
  if (!ctx?.tools || typeof ctx.tools.register !== 'function') {
    warn('当前 DSH 没有 tools 服务，Agent 接口未启用（桌宠显示不受影响）')
    return () => {}
  }
  for (const definition of createPetTools(deps)) {
    try {
      const dispose = ctx.tools.register(definition)
      if (typeof dispose === 'function') disposers.push(dispose)
    } catch (error) {
      warn(`注册工具 ${definition.name} 失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {}
    }
  }
}
