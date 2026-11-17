/** Monotonically identifies requests so obsolete responses cannot replace current UI state. */
export class RequestSequence {
  private revision = 0;

  next() {
    this.revision += 1;
    return this.revision;
  }

  isCurrent(revision: number) {
    return revision === this.revision;
  }

  invalidate() {
    this.revision += 1;
  }
}
