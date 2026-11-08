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
])

/** Build one protocol message. */
export function message(kind, payload = {}) {
  return { kind, at: Date.now(), ...payload }
}
