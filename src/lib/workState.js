const forms = new Set()
let pending = 0
export const viewMemory = new Map()
export function markForm(token, dirty) { if (dirty) forms.add(token); else forms.delete(token) }
export function hasUnsavedWork() { return forms.size > 0 || pending > 0 }
export function beginWrite() {
  pending++
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('finance-save-state', { detail: { pending } }))
}
export function endWrite(failed) {
  pending = Math.max(0, pending - 1)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('finance-save-state', { detail: { pending, failed } }))
}
export function notify(message, error = false) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('finance-notice', { detail: { message, error } }))
}
