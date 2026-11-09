/**
 * Wire protocol shared by the host half and the browser half.
 *
 * The browser never imports this file: it is copied by value into
 * `lib/client.js`, which runs as a standalone CommonJS-ish module inside the
 * DSH page. Any change here must be mirrored there.
 */

/** Message kinds pushed over `/plugins/dsh-fish-pet/stream`. */
export const Kind = {
  /** Sent once on connect: plugin metadata so the client can show versions. */
  HELLO: 'hello',
  /** Current companion pose. */
  STATE: 'state',
  /** Full task ledger replacement. */
  TASKS: 'tasks',
  /** Token usage snapshot. */
  USAGE: 'usage',
  /** Account balance snapshot. */
  BALANCE: 'balance',
  /** One chat message (user echo, assistant reply, or an error notice). */
  CHAT: 'chat',
  /** A transient action the pet is playing, or `{ action: null }` when it ends. */
  ACTION: 'action',
  /** A line the pet says in its head bubble. */
  SAY: 'say',
  /** What the pet is currently wearing (and which skin). */
  WARDROBE: 'wardrobe',
  /** Every pack the host found, hydrated with asset URLs. */
  CATALOG: 'catalog',
  /**
   * Continuous motion intent from the agent (gaze / locomotion). Unlike
   * {@link Kind.ACTION} clips these compose: the pet can walk while looking
   * somewhere. Carries a monotonic `seq` so a client that receives a replayed
   * snapshot never replays a walk it already performed.
   */
  MOTION: 'motion',
}

/** Companion poses. The browser half maps them to animations. */
export const Pose = {
  IDLE: 'IDLE',
  THINKING: 'THINKING',
  WORKING: 'WORKING',
  WAITING: 'WAITING',
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
}

/**
 * Agent-driven actions. The vocabulary is closed on purpose: a pack cannot
 * introduce new CSS, so the renderer only ever has to know these names.
 */
export const Action = {
  WAVE: 'wave',
  JUMP: 'jump',
  SPIN: 'spin',
  DANCE: 'dance',
  SLEEP: 'sleep',
  CHEER: 'cheer',
  SHY: 'shy',
  THINK: 'think',
}

/** Default duration of each action, in ms. `0` means "until replaced". */
export const ACTION_DURATION = {
  wave: 1600,
  jump: 1200,
  spin: 1400,
  dance: 2400,
  sleep: 0,
  cheer: 1600,
  shy: 2000,
  think: 0,
}

/** Human-readable action names, used by both the panel and the tool result. */
export const ACTION_LABEL = {
  wave: '挥手',
  jump: '跳一下',
  spin: '转个圈',
  dance: '跳舞',
  sleep: '打盹',
  cheer: '欢呼',
  shy: '害羞',
  think: '发呆思考',
}

/** Attachment slots, ordered back-to-front by {@link SLOT_Z}. */
export const Slot = {
  BACK: 'back',
  BODY: 'body',
  NECK: 'neck',
  HEAD: 'head',
  FACE: 'face',
  HAND: 'hand',
  EFFECT: 'effect',
}

export const SLOTS = ['back', 'body', 'neck', 'head', 'face', 'hand', 'effect']

/** Fixed stacking order — gear cannot fight over z-index. */
export const SLOT_Z = {
  back: 6,
  body: 30,
  neck: 35,
  head: 40,
  face: 45,
  hand: 48,
  effect: 50,
}

export const SLOT_LABEL = {
  back: '背后',
  body: '身上',
  neck: '颈部',
  head: '头部',
  face: '脸部',
  hand: '手持',
  effect: '光效',
}

/** Motion vocabulary implemented by the browser half. */
export const MOTIONS = ['bob', 'bob-fast', 'wag', 'sway', 'blink', 'hop', 'shake', 'droop', 'spin']

/**
 * Gaze targets. `cursor` follows the pointer; the rest are fixed offsets, so
 * the agent can say "look at what you are reading" without knowing pixels.
 */
export const GAZE_TARGETS = ['front', 'cursor', 'left', 'right', 'up', 'down']

/** Walk destinations. Numbers 0..1 (normalised viewport position) are strings here. */
export const WALK_TARGETS = ['left', 'right', 'center']

/** Bounds for continuous motion so an agent cannot send the pet off-screen. */
export const MOTION_LIMITS = Object.freeze({
  /** Gaze point components, normalised around the character. */
  gazePoint: [-1, 1],
  /** Walk duration in ms. */
  walkDuration: [400, 20_000],
  /** Gaze stickiness in ms. */
  gazeDuration: [300, 60_000],
})

/** Task lifecycle states shown in the status panel. */
export const TaskState = {
  RUNNING: 'running',
  DONE: 'done',
  ERROR: 'error',
  STOPPED: 'stopped',
}

/** Snapshot kinds replayed to a client that connects late. */
export const SNAPSHOT_KINDS = new Set([
  Kind.HELLO,
  Kind.STATE,
  Kind.TASKS,
  Kind.USAGE,
  Kind.BALANCE,
  Kind.CHAT,
  Kind.ACTION,
  Kind.SAY,
  Kind.WARDROBE,
  Kind.CATALOG,
  Kind.MOTION,
])

/** Build one protocol message. */
export function message(kind, payload = {}) {
  return { kind, at: Date.now(), ...payload }
}
