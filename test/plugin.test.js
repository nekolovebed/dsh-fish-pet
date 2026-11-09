/**
 * Host-half wiring smoke test.
 *
 * There is no DSH on the test machine, so this stands in a fake Cordis context:
 * settings scope, an exact-path web server and a tool registry. It cannot prove
 * a real harness behaves the same, but it does prove that `apply()` mounts,
 * registers ten routes and five tools, and that a PATCH flows through the
 * wardrobe rules.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { apply, endpoints } from '../src/plugin.js'
import { repoOnlyPacks } from '../testkit/packs.js'

const TEST_PACKS = repoOnlyPacks()

function fakeContext(initial = {}) {
  let config = { packsDir: TEST_PACKS, ...initial }
  const watchers = new Set()
  const routes = new Map()
  const disposers = []
  const tools = []
  const handlers = new Map()

  const context = {
    logger: { info() {}, warn() {}, error() {} },
    settings: {
      register: () => ({
        get: () => config,
        watch(fn) {
          watchers.add(fn)
          return () => watchers.delete(fn)
        },
        async update(next) {
          config = next
          for (const fn of watchers) fn(config)
          return config
        },
      }),
    },
    on(event, fn) {
      handlers.set(event, fn)
      return () => handlers.delete(event)
    },
    get: () => undefined,
    effect(factory) {
      const result = typeof factory === 'function' ? factory() : undefined
      if (typeof result === 'function') disposers.push(result)
      return result
    },
    inject(deps, callback) {
      if (deps.includes('webServer')) {
        callback({
          webServer: {
            register({ path, handler }) {
              routes.set(path, handler)
              return () => routes.delete(path)
            },
          },
          effect: context.effect,
        })
      }
      if (deps.includes('tools')) {
        callback({
          tools: {
            register(definition) {
              tools.push(definition)
              return () => {
                const index = tools.indexOf(definition)
                if (index >= 0) tools.splice(index, 1)
              }
            },
          },
        })
      }
    },
  }

  return { context, routes, tools, handlers, disposers, getConfig: () => config }
}

function fakeRequest({ method = 'GET', url = '/', body = null } = {}) {
  const listeners = new Map()
  const request = {
    method,
    url,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    on(event, fn) {
      listeners.set(event, fn)
      return request
    },
  }
  if (body !== null) {
    request[Symbol.asyncIterator] = async function* iterate() {
      yield Buffer.from(JSON.stringify(body))
    }
  }
  return request
}

function fakeResponse() {
  const chunks = []
  const response = {
    status: 0,
    headers: null,
    chunks,
    writeHead(status, headers) {
      response.status = status
      response.headers = headers
    },
    write(chunk) {
      chunks.push(String(chunk))
      return true
    },
    end(chunk) {
      if (chunk) chunks.push(String(chunk))
      response.ended = true
    },
    destroy() {},
    on() {},
  }
  return response
}

function streamingResponse() {
  const chunks = []
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk)
      callback()
    },
  })
  sink.status = 0
  sink.headers = null
  sink.chunks = chunks
  sink.writeHead = (status, headers) => {
    sink.status = status
    sink.headers = headers
  }
  return sink
}

function bodyOf(response) {
  const raw = response.chunks.join('')
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

test('mount registers every route and the five agent tools', () => {
  const { context, routes, tools } = fakeContext()
  apply(context, {})

  for (const path of Object.values(endpoints)) {
    assert.ok(routes.has(path), `missing route ${path}`)
  }
  assert.equal(routes.size, 10)
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['pet_act', 'pet_say', 'pet_skin', 'pet_status', 'pet_wear'])
})

test('the pack catalog is served with hydrated asset URLs', () => {
  const { context, routes } = fakeContext()
  apply(context, {})

  const response = fakeResponse()
  routes.get(endpoints.packs)(fakeRequest({ url: endpoints.packs }), response)

  const body = bodyOf(response)
  assert.equal(response.status, 200)
  assert.equal(body.skins.length, 1)
  assert.equal(body.accessories.length, 4)
  assert.match(body.skins[0].layers[0].src, /^\/plugins\/dsh-fish-pet\/asset/)
})

test('asset requests are served, and traversal is refused', async () => {
  const { context, routes } = fakeContext()
  apply(context, {})

  const missing = fakeResponse()
  routes.get(endpoints.asset)(
    fakeRequest({ url: `${endpoints.asset}?pack=paopao&path=..%2F..%2Fpackage.json` }),
    missing,
  )
  assert.equal(missing.status, 404)

  const sink = streamingResponse()
  const request = fakeRequest({ url: `${endpoints.asset}?pack=paopao&path=layers%2Fbody.svg` })
  routes.get(endpoints.asset)(request, sink)
  await new Promise((resolve) => sink.on('finish', resolve))
  assert.equal(sink.status, 200)
  assert.equal(sink.headers['content-type'], 'image/svg+xml')
  assert.match(sink.chunks.join(''), /<svg/)
})

test('a PATCH to worn goes through slot exclusivity before it is stored', async () => {
  const { context, routes, getConfig } = fakeContext()
  apply(context, {})

  const response = fakeResponse()
  await routes.get(endpoints.config)(
    fakeRequest({ method: 'PATCH', body: { worn: ['cat-ears', 'cape'] } }),
    response,
  )
  assert.equal(response.status, 200)
  assert.deepEqual(getConfig().worn, ['cat-ears', 'cape'])

  const replaced = fakeResponse()
  await routes.get(endpoints.config)(
    fakeRequest({ method: 'PATCH', body: { worn: ['cat-ears', 'cape', 'ribbon', 'round-glasses'] } }),
    replaced,
  )
  const body = bodyOf(replaced)
  assert.deepEqual(body.worn, ['cat-ears', 'cape', 'ribbon', 'round-glasses'])

  const conflicted = fakeResponse()
  await routes.get(endpoints.config)(
    fakeRequest({ method: 'PATCH', body: { worn: ['cat-ears', 'ribbon'] } }),
    conflicted,
  )
  assert.equal(bodyOf(conflicted).worn.length, 2)
})

test('the SSE route seeds a client with state, wardrobe, action and catalog', () => {
  const { context, routes } = fakeContext()
  apply(context, {})

  const response = fakeResponse()
  const request = fakeRequest({ url: endpoints.stream })
  routes.get(endpoints.stream)(request, response)

  assert.equal(response.status, 200)
  const frames = response.chunks.join('')
  assert.match(frames, /"kind":"hello"/)
  assert.match(frames, /"kind":"state"/)
  assert.match(frames, /"kind":"wardrobe"/)
  assert.match(frames, /"kind":"catalog"/)
  assert.match(frames, /"kind":"action"/)
})

test('unmounting disposes tools and stops the timers without throwing', () => {
  const { context, tools, disposers } = fakeContext()
  apply(context, {})
  assert.equal(tools.length, 5)

  for (const dispose of disposers.reverse()) {
    assert.doesNotThrow(() => dispose())
  }
  assert.equal(tools.length, 0)
})

test('the say endpoint writes, reads and clears the head bubble', async () => {
  const { context, routes } = fakeContext()
  apply(context, {})

  const posted = fakeResponse()
  await routes.get(endpoints.say)(
    fakeRequest({ method: 'POST', url: endpoints.say, body: { text: '写完啦', durationMs: 4000 } }),
    posted,
  )
  assert.equal(posted.status, 200)
  const said = bodyOf(posted)
  assert.equal(said.ok, true)
  assert.equal(said.text, '写完啦')
  assert.ok(said.until > Date.now())

  const read = fakeResponse()
  await routes.get(endpoints.say)(fakeRequest({ url: endpoints.say }), read)
  assert.equal(bodyOf(read).text, '写完啦', 'GET reflects the live snapshot')

  const cleared = fakeResponse()
  await routes.get(endpoints.say)(fakeRequest({ method: 'DELETE', url: endpoints.say }), cleared)
  assert.equal(bodyOf(cleared).text, '')
})

test("the desktop page carries DSH's session token into its script URL", async () => {
  const { context, routes } = fakeContext()
  apply(context, {})

  const response = fakeResponse()
  await routes.get(endpoints.desktop)(
    fakeRequest({ url: `${endpoints.desktop}?token=abc_123-xyz` }), response,
  )
  assert.equal(response.status, 200)
  const html = response.chunks.join('')
  assert.match(html, /desktop\.js\?token=abc_123-xyz/)
  assert.doesNotMatch(html, /__DSH_TOKEN_QUERY__/)

  const plain = fakeResponse()
  await routes.get(endpoints.desktop)(fakeRequest({ url: endpoints.desktop }), plain)
  const plainHtml = plain.chunks.join('')
  assert.match(plainHtml, /desktop\.js"/, 'without a token the placeholder is simply empty')
  assert.doesNotMatch(plainHtml, /__DSH_TOKEN_QUERY__/)
})
