/**
 * Session-event reducer.
 *
 * Turns the durable DSH `session/event` stream into three things the overlay
 * renders: a companion pose, a task ledger and a token/cost tally.
 *
 * Design notes
 * - Pure: no timers, no I/O, no `ctx`. Time and ids are injected so the whole
 *   file is unit-testable.
 * - Defensive: every payload field is optional-chained. A future harness
 *   release that renames a field degrades to "the fish looks idle", never to a
 *   throw that would break the shared session bus.
 * - A "task" is one turn. Turns are what the user actually perceives as work;
 *   steps and tool calls are progress inside it.
 */
import { Kind, Pose, TaskState, message } from './protocol.js'

const TITLE_LIMIT = 60
const TOOL_ACTIVITY = [
  [/^(read|write|edit|multi_edit|apply_patch|glob|grep|ls|list|notebook)/i, 'files'],
  [/^(web_search|web_fetch|fetch|search|browse)/i, 'search'],
  [/^(bash|shell|run_command|exec|terminal)/i, 'shell'],
  [/^(todo|plan|task|goal)/i, 'plan'],
  [/^(pet_|fish_)/i, 'self'],
]

/**
 * Coarse-grained activity bucket for one tool name, used to pick an animation.
 * @param {string} name
 * @returns {'files'|'search'|'shell'|'plan'|'self'|'tool'}
 */
export function activityOf(name) {
  const tool = String(name || '')
  for (const [pattern, activity] of TOOL_ACTIVITY) {
    if (pattern.test(tool)) return activity
  }
  return 'tool'
}

/** Extract readable text from a message's content blocks. */
export function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

function clampTitle(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim()
  if (flat.length <= TITLE_LIMIT) return flat
  return flat.slice(0, TITLE_LIMIT - 1) + '…'
}

function localDayKey(at) {
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export class CompanionTracker {
  /**
   * @param {object} [options]
   * @param {number} [options.maxTasks] finished tasks kept in the ledger
   * @param {() => number} [options.now] injectable clock (tests)
   */
  constructor(options = {}) {
    this.maxTasks = Math.max(1, Number(options.maxTasks) || 6)
    this.now = typeof options.now === 'function' ? options.now : Date.now
    /** @type {Map<string, object>} sessions currently being watched */
    this.sessions = new Map()
    /** @type {object[]} newest last */
    this.tasks = []
    this.pose = Pose.IDLE
    this.stage = '待命中'
    this.detail = 'DSH · 等待下一次任务'
    this.activity = null
    this.lastSeq = 0
    this.usage = {
      input: 0,
      output: 0,
      cacheRead: 0,
      day: localDayKey(this.now()),
      dayInput: 0,
      dayOutput: 0,
      turns: 0,
    }
  }

  /** Pose message for the current state. */
  stateMessage() {
    return message(Kind.STATE, {
      pose: this.pose,
      stage: this.stage,
      detail: this.detail,
      activity: this.activity,
      seq: this.lastSeq,
    })
  }

  tasksMessage() {
    return message(Kind.TASKS, { items: this.tasks.slice(-this.maxTasks).reverse() })
  }

  usageMessage(pricing = {}) {
    const cost = estimateCost(this.usage, pricing)
    return message(Kind.USAGE, {
      input: this.usage.input,
      output: this.usage.output,
      cacheRead: this.usage.cacheRead,
      dayInput: this.usage.dayInput,
      dayOutput: this.usage.dayOutput,
      turns: this.usage.turns,
      cost,
      priced: cost !== null,
      day: this.usage.day,
    })
  }

  /** Snapshot used to seed a freshly connected client. */
  snapshot(pricing) {
    return [this.stateMessage(), this.tasksMessage(), this.usageMessage(pricing)]
  }

  /**
   * Fold one session event.
   * @param {{id?: string}} session
   * @param {{type?: string, seq?: number, data?: object}} event
   * @returns {object[]} protocol messages to broadcast
   */
  handle(session, event) {
    if (!event || typeof event.type !== 'string') return []
    const sessionId = String(session?.id ?? 'unknown')
    const data = event.data && typeof event.data === 'object' ? event.data : {}
    if (Number.isFinite(event.seq)) this.lastSeq = Number(event.seq)

    const out = []
    const record = this.#sessionRecord(sessionId)

    switch (event.type) {
      case 'user/message': {
        const text = clampTitle(textOf(data.message?.content))
        if (text) {
          record.pendingTitle = text
          // A turn opened before the message was logged keeps the better title.
          const task = this.#findTask(sessionId)
          if (task && task.title === record.fallbackTitle) task.title = text
        }
        break
      }

      case 'turn/start': {
        record.turn = Number(data.turn ?? record.turn + 1)
        record.fallbackTitle = `会话 ${sessionId.slice(0, 6)} · 第 ${record.turn} 轮`
        const task = {
          id: `${sessionId}#${record.turn}`,
          sessionId,
          title: record.pendingTitle || record.fallbackTitle,
          state: TaskState.RUNNING,
          activity: null,
          tool: null,
          tools: 0,
          startedAt: this.now(),
          updatedAt: this.now(),
        }
        record.pendingTitle = null
        this.tasks.push(task)
        this.#prune()
        this.#set(Pose.THINKING, '接到任务', task.title, null)
        out.push(this.stateMessage(), this.tasksMessage())
        break
      }

      case 'step/start': {
        const task = this.#findTask(sessionId)
        if (task && task.state === TaskState.RUNNING) {
          this.#set(Pose.THINKING, '思考中', task.title, task.activity)
          out.push(this.stateMessage())
        }
        break
      }

      case 'tool/call': {
        const name = String(data.name ?? data.message?.name ?? 'tool')
        const activity = activityOf(name)
        const task = this.#findTask(sessionId)
        if (task) {
          task.tools += 1
          task.tool = name
          task.activity = activity
          task.updatedAt = this.now()
        }
        this.#set(Pose.WORKING, toolStage(activity), name, activity)
        out.push(this.stateMessage(), this.tasksMessage())
        break
      }

      case 'tool/result': {
        const task = this.#findTask(sessionId)
        if (task) task.updatedAt = this.now()
        this.#set(Pose.THINKING, '整理结果', task?.title ?? '处理中', task?.activity ?? null)
        out.push(this.stateMessage())
        break
      }

      case 'approval/asked': {
        const toolName = String(data.toolName ?? data.name ?? 'approval')
        this.#set(Pose.WAITING, '等待确认', `需要你批准：${toolName}`, 'approval')
        out.push(this.stateMessage())
        break
      }

      case 'approval/decided': {
        const task = this.#findTask(sessionId)
        this.#set(Pose.WORKING, '继续执行', task?.title ?? '继续', task?.activity ?? null)
        out.push(this.stateMessage())
        break
      }

      case 'assistant/message': {
        this.#addUsage(data.usage)
        const task = this.#findTask(sessionId)
        if (task) task.updatedAt = this.now()
        out.push(this.usageMessage())
        break
      }

      case 'turn/end': {
        const task = this.#findTask(sessionId)
        const kind = String(data.reason?.kind ?? 'completed')
        const outcome = outcomeOf(kind)
        if (task) {
          task.state = outcome.taskState
          task.updatedAt = this.now()
          task.durationMs = task.updatedAt - task.startedAt
        }
        this.usage.turns += 1
        this.#set(outcome.pose, outcome.stage, task?.title ?? outcome.detail, null)
        out.push(this.stateMessage(), this.tasksMessage(), this.usageMessage())
        break
      }

      default:
        return out
    }
    return out
  }

  /** Drop per-session bookkeeping when a session is disposed. */
  disposeSession(session) {
    const sessionId = String(session?.id ?? 'unknown')
    this.sessions.delete(sessionId)
    return []
  }

  /** Reset live poses; used when no session is active any more. */
  idle(stage = '待命中', detail = 'DSH · 等待下一次任务') {
    this.#set(Pose.IDLE, stage, detail, null)
    return [this.stateMessage()]
  }

  #sessionRecord(sessionId) {
    let record = this.sessions.get(sessionId)
    if (!record) {
      record = { turn: 0, pendingTitle: null, fallbackTitle: '' }
      this.sessions.set(sessionId, record)
    }
    return record
  }

  #findTask(sessionId) {
    for (let index = this.tasks.length - 1; index >= 0; index -= 1) {
      const task = this.tasks[index]
      if (task.sessionId === sessionId && task.state === TaskState.RUNNING) return task
    }
    return null
  }

  #set(pose, stage, detail, activity) {
    this.pose = pose
    this.stage = stage
    this.detail = detail || ''
    this.activity = activity ?? null
  }

  #prune() {
    const running = this.tasks.filter((task) => task.state === TaskState.RUNNING)
    const finished = this.tasks.filter((task) => task.state !== TaskState.RUNNING)
    const keep = finished.slice(-Math.max(0, this.maxTasks - running.length))
    this.tasks = [...running, ...keep]
  }

  #addUsage(usage) {
    if (!usage || typeof usage !== 'object') return
    const input = Number(usage.inputTokens) || 0
    const output = Number(usage.outputTokens) || 0
    const cacheRead = Number(usage.cacheReadTokens) || 0
    const day = localDayKey(this.now())
    if (day !== this.usage.day) {
      this.usage.day = day
      this.usage.dayInput = 0
      this.usage.dayOutput = 0
    }
    this.usage.input += input
    this.usage.output += output
    this.usage.cacheRead += cacheRead
    this.usage.dayInput += input
    this.usage.dayOutput += output
  }
}

function toolStage(activity) {
  switch (activity) {
    case 'files': return '读写文件'
    case 'search': return '检索资料'
    case 'shell': return '运行命令'
    case 'plan': return '整理计划'
    case 'self': return '摆弄自己'
    default: return '调用工具'
  }
}

function outcomeOf(kind) {
  switch (kind) {
    case 'completed':
      return { pose: Pose.SUCCESS, stage: '任务完成', detail: '这一轮顺利收工', taskState: TaskState.DONE }
    case 'blocked':
      return { pose: Pose.WAITING, stage: '等待你处理', detail: '任务被挂起', taskState: TaskState.RUNNING }
    case 'aborted':
      return { pose: Pose.IDLE, stage: '已停止', detail: '这一轮被中断', taskState: TaskState.STOPPED }
    case 'max-tokens':
      return { pose: Pose.ERROR, stage: '上下文用尽', detail: '这一轮达到长度上限', taskState: TaskState.ERROR }
    default:
      return { pose: Pose.ERROR, stage: '出错了', detail: '这一轮没能完成', taskState: TaskState.ERROR }
  }
}

/**
 * Estimate money spent from token totals.
 * Returns `null` when no unit price is configured — the UI must show "未配置"
 * rather than a fabricated zero.
 */
export function estimateCost(usage, pricing = {}) {
  const input = Number(pricing.priceInputPerMillion) || 0
  const output = Number(pricing.priceOutputPerMillion) || 0
  if (input === 0 && output === 0) return null
  if (!usage) return null
  const cost = ((Number(usage.input) || 0) * input + (Number(usage.output) || 0) * output) / 1_000_000
  return Math.round(cost * 10000) / 10000
}
