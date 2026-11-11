import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'

const source = readFileSync(new URL('../src/upload.ts', import.meta.url), 'utf8')
const compiled = stripTypeScriptTypes(source)

async function scenario({ count = 12, failPart, missingEtag, abortPart, single = false } = {}) {
  const progress = []
  const sent = []
  const signed = []
  let active = 0
  let peak = 0
  let completion
  const api = {
    CreateUploadSessionRequest: { handlingMode: { DOCUMENT: 'DOCUMENT' } },
    UploadSessionResponse: { strategy: { SINGLE: 'SINGLE' } },
    FileAssetResponse: { status: { READY: 'READY' } },
    UploadSessionControllerService: {
      create: async () => ({ sessionId: 'session', strategy: single ? 'SINGLE' : 'MULTIPART', partSize: 4, partCount: count, upload: { method: 'PUT', url: '1', headers: {} } }),
      presignParts: async (_owner, _id, { partNumbers }) => {
        signed.push(partNumbers)
        return { parts: partNumbers.map(partNumber => ({ partNumber, upload: { method: 'PUT', url: String(partNumber), headers: {} } })) }
      },
      complete: async (_owner, _id, body) => {
        assert.equal(active, 0)
        completion = body
        return { assetId: 'asset', status: 'READY' }
      },
    },
    FileAssetControllerService: { getAsset: async () => ({ assetId: 'asset', status: 'READY' }) },
  }
  class Request {
    upload = {}
    open(_method, url) { this.part = Number(url) }
    setRequestHeader() {}
    getResponseHeader() { return this.part === missingEtag ? null : `etag-${this.part}` }
    send(body) {
      active++
      peak = Math.max(peak, active)
      sent.push({ part: this.part, bytes: body.size })
      this.upload.onprogress?.({ lengthComputable: true, loaded: body.size / 2 })
      setTimeout(() => {
        active--
        if (this.part === abortPart) return this.onabort()
        if (this.part === failPart) return this.onerror()
        this.upload.onprogress?.({ lengthComputable: true, loaded: body.size })
        this.status = 200
        this.onload()
      }, 15 + (this.part % 3) * 5)
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
  let error
  try {
    await module.namespace.uploadFile({ file: new File([new Uint8Array(count * 4 - 1)], 'test.bin'), onAsset() {}, onEvent() {}, onPhase() {}, onProgress: value => progress.push(value) })
  } catch (caught) { error = caught }
  return { progress, sent, signed, peak, active, completion, error, elapsed: performance.now() - started }
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
  assert.deepEqual(result.sent.at(-1), { part: 101, bytes: 3 })
})

test('single uploads still send one PUT with an empty completion list', async () => {
  const result = await scenario({ count: 1, single: true })
  assert.equal(result.error, undefined)
  assert.equal(result.peak, 1)
  assert.equal(result.completion.parts.length, 0)
  assert.deepEqual(result.signed, [])
})
