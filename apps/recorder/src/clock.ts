/**
 * Maps CDP monotonic timestamps (seconds) to epoch milliseconds. A websocket
 * handshake carries both clocks and fixes the offset exactly. Until one is
 * seen, the offset is the smallest (receipt time - monotonic time) so far,
 * which is the estimate least inflated by delivery delay.
 */
export function createClock() {
  let offset = Infinity
  let exact = false
  return {
    calibrate(monotonicSec: number, wallSec: number) {
      offset = (wallSec - monotonicSec) * 1000
      exact = true
    },
    toEpoch(monotonicSec: number, receivedAt: number): number {
      if (!exact) offset = Math.min(offset, receivedAt - monotonicSec * 1000)
      return monotonicSec * 1000 + offset
    },
  }
}
export type Clock = ReturnType<typeof createClock>
