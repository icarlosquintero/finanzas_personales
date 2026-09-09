import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const loadModule = async path => import('data:text/javascript,' + encodeURIComponent(await readFile(new URL(path, import.meta.url), 'utf8')))
const { createRequestCache } = await loadModule('../src/lib/requestCache.js')
const work = await loadModule('../src/lib/workState.js')
test('simultaneous reads share a request without sharing mutable results', async () => {
  const cache = createRequestCache(); let calls = 0
  const loader = async () => { calls++; return { items: [1] } }
  const [a, b] = await Promise.all([cache.read('key', loader), cache.read('key', loader)])
  a.items.push(2)
  assert.equal(calls, 1); assert.deepEqual(b.items, [1])
})
test('a read completed after invalidation cannot repopulate the cache', async () => {
  const cache = createRequestCache(); let resolve
  const previous = cache.read('key', () => new Promise(r => { resolve = r }))
  await Promise.resolve(); cache.clear(); resolve('old'); await previous
  assert.equal(await cache.read('key', async () => 'new'), 'new')
})
test('a failed read can be retried', async () => {
  const cache = createRequestCache()
  await assert.rejects(cache.read('key', async () => { throw Error('offline') }))
  assert.equal(await cache.read('key', async () => 42), 42)
})
test('form and nested writes protect work until every operation ends', () => {
  const form = Symbol('test'); work.markForm(form, true)
  work.beginWrite(); work.beginWrite(); work.markForm(form, false)
  work.endWrite(false); assert.equal(work.hasUnsavedWork(), true)
  work.endWrite(true); assert.equal(work.hasUnsavedWork(), false)
  work.endWrite(false); assert.equal(work.hasUnsavedWork(), false)
})
