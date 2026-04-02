// Controls whether the engine is allowed to surface a thought during the
// current user turn. Resets to open on each new user message; closes once
// a thought is claimed for surfacing, so at most one per turn is shown.
export class SurfacingGate {
  constructor() {
    this._open = false;
  }

  // Call when a new user message arrives.
  reset() {
    this._open = true;
  }

  // Atomically check-and-close. Returns true if a thought may be surfaced.
  tryAcquire() {
    if (!this._open) return false;
    this._open = false;
    return true;
  }
}
