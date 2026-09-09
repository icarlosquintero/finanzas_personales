// Memory-only reads. No financial data is persisted by this cache.
export function createRequestCache(ttl = 10000) {
  const entries = new Map()
  let generation = 0
  return {
    clear() { generation++; entries.clear() },
    async read(key, loader) {
      const existing = entries.get(key)
      if (existing && existing.expires > Date.now()) return structuredClone(await existing.promise)
      const version = generation
      const entry = { expires: Infinity, promise: null }
      entry.promise = Promise.resolve().then(loader).then(value => {
        if (version === generation) entry.expires = Date.now() + ttl
        return value
      }).catch(error => {
        if (entries.get(key) === entry) entries.delete(key)
        throw error
      })
      entries.set(key, entry)
      return structuredClone(await entry.promise)
    }
  }
}
