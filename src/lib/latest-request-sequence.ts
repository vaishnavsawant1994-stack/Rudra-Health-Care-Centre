export class LatestRequestSequence {
  private active: AbortController | null = null;

  begin(): AbortController {
    this.active?.abort();
    const controller = new AbortController();
    this.active = controller;
    return controller;
  }

  isCurrent(controller: AbortController): boolean {
    return this.active === controller && !controller.signal.aborted;
  }

  cancel(): void {
    this.active?.abort();
    this.active = null;
  }
}
