/**
 * Agent-facing tool contracts.
 *
 * The definitions are hand-built (no `@deepseek-ai/dsh-tools` import), so this
 * suite pins the shape the registry expects as well as the behaviour the model
 * sees.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PackRegistry } from '../src/packs.js'
import { PetDirector } from '../src/pet.js'
import { SayBoard } from '../src/say.js'
import { createPetTools, registerPetTools } from '../src/tools.js'
import { repoOnlyPacks } from '../testkit/packs.js'

const repoPacks = repoOnlyPacks()

function harness() {
  const config = { skinId: 'paopao', worn: [], maxTasks: 6 }
  const patches = []
  const packs = new PackRegistry({ root: repoPacks })
  packs.reload()
  const director = new PetDirector({ emit: () => {} })
  const say = new SayBoard({ emit: () => {} })
  const tools = createPetTools({
    packs,
    director,
    say,
    getConfig: () => config,
    patchConfig: async (patch) => {
      Object.assign(config, patch)
      patches.push(patch)
      return config
    },
    tracker: () => ({
      stateMessage: () => ({ pose: 'WORKING', stage: '干活中', detail: '测试' }),
      tasksMessage: () => ({ items: [{ id: 't1', title: '任务', state: 'running', tools: 2 }] }),
      usageMessage: () => ({ input: 12, output: 34, dayInput: 12, dayOutput: 34, turns: 1 }),
    }),
    reloadPacks: () => packs.reload(),
  })
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]))
  return { config, patches, director, say, tools, byName }
}

test('every tool declares the shape the registry enforces', () => {
  const { tools } = harness()
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['pet_act', 'pet_say', 'pet_skin', 'pet_status', 'pet_wear'])
  for (const tool of tools) {
    assert.equal(typeof tool.name, 'string')
    assert.ok(tool.description.length > 10, `${tool.name} needs a real description`)
    assert.equal(tool.parameters.type, 'object')
    assert.equal(typeof tool.parameters.properties, 'object')
    assert.equal(tool.output.schema.type, 'object')
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(typeof tool.execute, 'function')
    const blocks = tool.output.render({}, { ok: true })
    assert.equal(blocks[0].type, 'text')
    assert.match(blocks[0].text, /ok/)
  }
})

test('pet_status exposes the catalog the model needs to pick gear', async () => {
  const { byName } = harness()
  const result = await byName.pet_status.execute({ detail: 'full' })

  assert.equal(result.ok, true)
  assert.equal(result.state.pose, 'WORKING')
  assert.equal(result.skin.id, 'paopao')
  assert.equal(result.accessories.length, 4)
  assert.ok(result.accessories.some((item) => item.id === 'cat-ears' && item.slot === 'head'))
  assert.equal(result.actions.length, 8)
  assert.equal(result.tasks.length, 1, 'full detail includes the task ledger')
  assert.equal(result.usage.turns, 1)
  assert.deepEqual(result.worn, [])

  const brief = await byName.pet_status.execute({})
  assert.equal(brief.tasks, undefined, 'brief detail stays small')
})

test('pet_act forwards to the director and reports the label', async () => {
  const { byName, director } = harness()
  const result = await byName.pet_act.execute({ action: 'jump', text: '看我的' })

  assert.equal(result.ok, true)
  assert.equal(result.label, '跳一下')
  assert.equal(director.active.action, 'jump')
  assert.equal(director.active.text, '看我的')

  const bad = await byName.pet_act.execute({ action: 'fly' })
  assert.equal(bad.ok, false)
})

test('pet_say puts one line in the bubble and reports its TTL', async () => {
  const { byName } = harness()
  const result = await byName.pet_say.execute({ text: '吃饭时间到', durationMs: 3000 })
  assert.equal(result.ok, true)
  assert.equal(result.text, '吃饭时间到')
  assert.ok(result.until > Date.now())

  const cleared = await byName.pet_say.execute({ text: '' })
  assert.equal(cleared.ok, true)
  assert.equal(cleared.text, '')
})

test('pet_wear writes through the same slot rules as the settings page', async () => {
  const { byName, patches } = harness()

  const first = await byName.pet_wear.execute({ op: 'wear', item: 'cat-ears' })
  assert.equal(first.ok, true)
  assert.deepEqual(first.worn, ['cat-ears'])
  assert.deepEqual(patches.at(-1), { worn: ['cat-ears'] })

  const second = await byName.pet_wear.execute({ op: 'wear', item: 'ribbon' })
  assert.deepEqual(second.worn, ['cat-ears', 'ribbon'])

  const replaced = await byName.pet_wear.execute({ op: 'wear', item: 'round-glasses' })
  assert.deepEqual(replaced.worn, ['cat-ears', 'ribbon', 'round-glasses'])

  const removed = await byName.pet_wear.execute({ op: 'remove', item: 'ribbon' })
  assert.deepEqual(removed.worn, ['cat-ears', 'round-glasses'])

  const cleared = await byName.pet_wear.execute({ op: 'clear' })
  assert.deepEqual(cleared.worn, [])

  const ghost = await byName.pet_wear.execute({ op: 'wear', item: 'ghost' })
  assert.equal(ghost.ok, false)
  assert.match(ghost.reason, /没有这个挂件/)
})

test('pet_skin reads and switches, refusing unknown ids', async () => {
  const { byName, config } = harness()
  const read = await byName.pet_skin.execute({})
  assert.equal(read.skinId, 'paopao')
  assert.equal(read.available.length, 1)

  const missing = await byName.pet_skin.execute({ id: 'ghost' })
  assert.equal(missing.ok, false)
  assert.equal(config.skinId, 'paopao')

  const switched = await byName.pet_skin.execute({ id: 'paopao' })
  assert.equal(switched.ok, true)
  assert.equal(switched.skinId, 'paopao')
})

test('registration degrades quietly when the harness has no tools service', () => {
  const warnings = []
  const dispose = registerPetTools({}, harness(), { warn: (note) => warnings.push(note) })
  assert.equal(typeof dispose, 'function')
  dispose()
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /tools/)
})

test('registration hands every definition to ctx.tools and disposes them', () => {
  const { tools } = harness()
  const registered = []
  const disposed = []
  const ctx = {
    tools: {
      register(definition) {
        registered.push(definition.name)
        return () => disposed.push(definition.name)
      },
    },
  }
  const dispose = registerPetTools(ctx, {
    packs: new PackRegistry({ root: repoPacks }),
    director: new PetDirector({ emit: () => {} }),
    getConfig: () => ({ skinId: 'paopao', worn: [] }),
    patchConfig: async () => ({ skinId: 'paopao', worn: [] }),
  })
  assert.deepEqual(registered.sort(), tools.map((tool) => tool.name).sort())
  dispose()
  assert.equal(disposed.length, registered.length)
})
