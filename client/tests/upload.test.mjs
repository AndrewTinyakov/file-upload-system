import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'

const source = readFileSync(new URL('../src/upload.ts', import.meta.url), 'utf8')
const compiled = stripTypeScriptTypes(source)

async function scenario({ count = 12, failPart, missingEtag, abortPart, failSession, uploads = 1, cancelSession, holdSession, single = false } = {}) {
  const progress = []
  const sent = []
  const signed = []
  let active = 0
  let peak = 0
  let completion
  let sessionNumber = 0
  const completions = []
  const settledAt = []
  const finishedAt = []
  const activeBySession = new Map()
  const api = {
    CreateUploadSessionRequest: { handlingMode: { DOCUMENT: 'DOCUMENT' } },
    UploadSessionResponse: { strategy: { SINGLE: 'SINGLE' } },
    FileAssetResponse: { status: { READY: 'READY' } },
    UploadSessionControllerService: {
      create: async () => {
        const sessionId = String(++sessionNumber)
        return { sessionId, strategy: single ? 'SINGLE' : 'MULTIPART', partSize: 4, partCount: count, upload: { method: 'PUT', url: `${sessionId}/1`, headers: {} } }
      },
      presignParts: async (_owner, id, { partNumbers }) => {
        signed.push(partNumbers)
        return { parts: partNumbers.map(partNumber => ({ partNumber, upload: { method: 'PUT', url: `${id}/${partNumber}`, headers: {} } })) }
      },
      complete: async (_owner, id, body) => {
        assert.equal(activeBySession.get(id) ?? 0, 0)
        completion = body
        completions.push({ id, body })
        return { assetId: 'asset', status: 'READY' }
      },
    },
    FileAssetControllerService: { getAsset: async () => ({ assetId: 'asset', status: 'READY' }) },
  }
  class Request {
    upload = {}
    open(_method, url) {
      const [session, part] = url.split('/')
      this.session = session
      this.part = Number(part)
    }
    setRequestHeader() {}
    getResponseHeader() { return this.part === missingEtag ? null : `etag-${this.part}` }
    send(body) {
      this.finished = false
      active++
      activeBySession.set(this.session, (activeBySession.get(this.session) ?? 0) + 1)
      peak = Math.max(peak, active)
      sent.push({ session: this.session, part: this.part, bytes: body.size })
      this.upload.onprogress?.({ lengthComputable: true, loaded: body.size / 2 })
      this.timer = setTimeout(() => {
        if (this.finished) return
        this.finished = true
        finishedAt.push({ session: this.session, at: performance.now() - started })
        active--
        activeBySession.set(this.session, activeBySession.get(this.session) - 1)
        if (this.part === abortPart) return this.onabort()
        if (this.part === failPart && (!failSession || this.session === String(failSession))) return this.onerror()
        this.upload.onprogress?.({ lengthComputable: true, loaded: body.size })
        this.status = 200
        this.onload()
      }, this.session === String(holdSession) ? 80 : 15 + (this.part % 3) * 5)
    }
    abort() {
      if (this.finished) return
      this.finished = true
      clearTimeout(this.timer)
      active--
      activeBySession.set(this.session, activeBySession.get(this.session) - 1)
      this.onabort()
    }
  }
  const context = vm.createContext({ XMLHttpRequest: Request, crypto, localStorage: { getItem: () => 'owner' }, window: { setTimeout } })
  const module = new vm.SourceTextModule(compiled, { context })
  const dependency = new vm.SyntheticModule(Object.keys(api), function () {
    for (const [name, value] of Object.entries(api)) this.setExport(name, value)
  }, { context })
  await module.link(() => dependency)
  await module.evaluate()
  const started = performance.now()
  const results = await Promise.allSettled(Array.from({ length: uploads }, (_, index) => {
    const controller = new AbortController()
    if (index + 1 === cancelSession) setTimeout(() => controller.abort(), 10)
    return module.namespace.uploadFile({ file: new File([new Uint8Array(count * 4 - 1)], 'test.bin'), signal: controller.signal, onAsset() {}, onEvent() {}, onPhase() {}, onProgress: value => progress.push(value) })
      .finally(() => { settledAt[index] = performance.now() - started })
  }))
  const error = results.find(result => result.status === 'rejected')?.reason
  return { progress, sent, signed, peak, active, completion, completions, error, results, settledAt, finishedAt, elapsed: performance.now() - started }
}

test('multipart transfers overlap within a bound and preserve completion and progress', async t => {
  const result = await scenario()
  t.diagnostic(`12 parts, 15-25 ms simulated storage latency: ${result.elapsed.toFixed(1)} ms, peak PUTs ${result.peak}`)
  assert.equal(result.error, undefined)
  assert.ok(result.peak > 1)
  assert.ok(result.peak <= 4)
  assert.deepEqual(Array.from(result.completion.parts, part => ({ ...part })), Array.from({ length: 12 }, (_, index) => ({ partNumber: index + 1, etag: `etag-${index + 1}` })))
  assert.equal(result.sent.reduce((sum, part) => sum + part.bytes, 0), 47)
  assert.deepEqual(result.progress.slice(0, 4), [2 / 47, 4 / 47, 6 / 47, 8 / 47])
  assert.equal(result.progress.at(-1), 1)
  assert.ok(result.progress.every((value, index) => value >= 0 && value <= 1 && (index === 0 || value >= result.progress[index - 1])))
})

for (const fault of [{ failPart: 2 }, { missingEtag: 2 }, { abortPart: 2 }]) {
  test(`failed part ${JSON.stringify(fault)} stops scheduling and never completes`, { timeout: 2000 }, async () => {
    const result = await scenario(fault)
    assert.ok(result.error)
    assert.equal(result.completion, undefined)
    assert.equal(result.active, 0)
    assert.ok(result.sent.length < 12)
  })
}

test('multipart signing retains 100-part batches and uploads the final short part', async () => {
  const result = await scenario({ count: 101 })
  assert.equal(result.error, undefined)
  assert.deepEqual(result.signed.map(batch => batch.length), [100, 1])
  assert.equal(result.completion.parts.length, 101)
  assert.deepEqual(result.sent.at(-1), { session: '1', part: 101, bytes: 3 })
})

test('single uploads still send one PUT with an empty completion list', async () => {
  const result = await scenario({ count: 1, single: true })
  assert.equal(result.error, undefined)
  assert.equal(result.peak, 1)
  assert.equal(result.completion.parts.length, 0)
  assert.deepEqual(result.signed, [])
})

for (const single of [false, true]) {
  test(`simultaneous ${single ? 'single' : 'multipart'} uploads share four transfer slots`, { timeout: 3000 }, async () => {
    const result = await scenario({ uploads: 8, single, count: single ? 1 : 12 })
    assert.equal(result.error, undefined)
    assert.equal(result.completions.length, 8)
    assert.equal(result.active, 0)
    assert.ok(result.peak > 1)
    assert.ok(result.peak <= 4, `Observed ${result.peak} simultaneous PUTs`)
    for (const { body } of result.completions) assert.equal(body.parts.length, single ? 0 : 12)
  })
}

test('a failed upload releases shared slots and skips its queued parts while other uploads finish', { timeout: 3000 }, async () => {
  const result = await scenario({ uploads: 3, failPart: 2, failSession: 1 })
  assert.equal(result.results.filter(value => value.status === 'rejected').length, 1)
  assert.match(result.error.message, /Storage upload failed/)
  assert.equal(result.completions.length, 2)
  assert.ok(result.completions.every(value => value.id !== '1'))
  assert.equal(result.sent.filter(value => value.session === '1').length, 4)
  assert.equal(result.active, 0)
  assert.ok(result.peak <= 4)
})

test('a queued upload settles on abort without sending later or consuming shared slots', { timeout: 3000 }, async () => {
  const result = await scenario({ uploads: 2, cancelSession: 2, holdSession: 1 })
  assert.equal(result.results[1].status, 'rejected')
  assert.ok(result.settledAt[1] < result.finishedAt.find(value => value.session === '1').at)
  assert.equal(result.sent.filter(value => value.session === '2').length, 0)
  assert.equal(result.completions.length, 1)
  assert.equal(result.completions[0].id, '1')
  assert.equal(result.active, 0)
})

test('aborting active transfers releases all shared slots and never completes the session', { timeout: 3000 }, async () => {
  const result = await scenario({ cancelSession: 1, holdSession: 1 })
  assert.equal(result.results[0].status, 'rejected')
  assert.equal(result.sent.length, 4)
  assert.equal(result.completions.length, 0)
  assert.equal(result.active, 0)
})
