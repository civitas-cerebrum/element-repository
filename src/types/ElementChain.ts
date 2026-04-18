import { Element } from './Element';

/**
 * Thenable fluent builder for performing sequenced actions on an {@link Element}.
 *
 * Created via `element.action(timeout?)`. Methods queue actions synchronously;
 * the full queue is executed in order when the chain is `await`ed.
 *
 * `ElementChain` is an **action sequencer**, not a verification engine. It
 * exposes interaction primitives (click, fill, hover, etc.) and terminal
 * extractions (getText, getAttribute). Smart verification logic — retry
 * semantics, matcher composition, error formatting — belongs in consumer
 * packages (`@civitas-cerebrum/element-interactions`,
 * `@civitas-cerebrum/singularity-engine`).
 *
 * @example
 * ```ts
 * // Interaction chain
 * await element.action(5000)
 *   .waitForState('visible')
 *   .click({ withoutScrolling: true })
 *
 * // Extraction (terminal — returns value)
 * const text = await element.action().getText()
 * ```
 */
export class ElementChain implements PromiseLike<Element> {
  private queue: (() => Promise<any>)[] = [];

  /**
   * @param element - The element to act on.
   * @param timeout - Optional timeout in ms applied to all wait/action calls in this chain.
   */
  constructor(private element: Element, private timeout?: number) {}

  // ── Waiting ──────────────────────────────────────────────────

  /** Wait for the element to reach the specified DOM state. */
  waitForState(state: 'visible' | 'attached' | 'hidden' | 'detached' = 'visible'): this {
    this.queue.push(async () => {
      await this.element.waitFor({ state, timeout: this.timeout });
    });
    return this;
  }

  // ── Interactions ─────────────────────────────────────────────

  /** Wait for visible, then click. Use `{ withoutScrolling: true }` to dispatch a native click event. */
  click(options?: { withoutScrolling?: boolean }): this {
    this.queue.push(async () => {
      if (options?.withoutScrolling) {
        await this.element.waitFor({ state: 'attached', timeout: this.timeout });
        await this.element.dispatchEvent('click');
      } else {
        await this.element.waitFor({ state: 'visible', timeout: this.timeout });
        await this.element.click({ timeout: this.timeout });
      }
    });
    return this;
  }

  /** Click only if the element is visible. Skips silently otherwise. */
  clickIfPresent(options?: { withoutScrolling?: boolean }): this {
    this.queue.push(async () => {
      if (await this.element.isVisible()) {
        if (options?.withoutScrolling) {
          await this.element.dispatchEvent('click');
        } else {
          await this.element.click({ timeout: this.timeout });
        }
      }
    });
    return this;
  }

  /** Wait for visible, then hover. */
  hover(): this {
    this.queue.push(async () => {
      await this.element.waitFor({ state: 'visible', timeout: this.timeout });
      await this.element.hover({ timeout: this.timeout });
    });
    return this;
  }

  /** Wait for visible, then clear and fill with text. */
  fill(text: string): this {
    this.queue.push(async () => {
      await this.element.waitFor({ state: 'visible', timeout: this.timeout });
      await this.element.fill(text, { timeout: this.timeout });
    });
    return this;
  }

  /** Wait for visible, then clear the input value. */
  clear(): this {
    this.queue.push(async () => {
      await this.element.waitFor({ state: 'visible', timeout: this.timeout });
      await this.element.clear({ timeout: this.timeout });
    });
    return this;
  }

  /** Wait for visible, then check a checkbox/radio. */
  check(): this {
    this.queue.push(async () => {
      await this.element.waitFor({ state: 'visible', timeout: this.timeout });
      await this.element.check({ timeout: this.timeout });
    });
    return this;
  }

  /** Wait for visible, then uncheck a checkbox. */
  uncheck(): this {
    this.queue.push(async () => {
      await this.element.waitFor({ state: 'visible', timeout: this.timeout });
      await this.element.uncheck({ timeout: this.timeout });
    });
    return this;
  }

  /** Wait for visible, then double-click. */
  doubleClick(): this {
    this.queue.push(async () => {
      await this.element.waitFor({ state: 'visible', timeout: this.timeout });
      await this.element.doubleClick({ timeout: this.timeout });
    });
    return this;
  }

  /** Wait for attached, then scroll into view. */
  scrollIntoView(): this {
    this.queue.push(async () => {
      await this.element.waitFor({ state: 'attached', timeout: this.timeout });
      await this.element.scrollIntoView({ timeout: this.timeout });
    });
    return this;
  }

  /** Wait for visible, then type text character by character. */
  pressSequentially(text: string, delay?: number): this {
    this.queue.push(async () => {
      await this.element.waitFor({ state: 'visible', timeout: this.timeout });
      await this.element.pressSequentially(text, delay, { timeout: this.timeout });
    });
    return this;
  }

  /** Dispatch a DOM event on the element. */
  dispatchEvent(event: string): this {
    this.queue.push(async () => {
      await this.element.waitFor({ state: 'attached', timeout: this.timeout });
      await this.element.dispatchEvent(event);
    });
    return this;
  }

  /** Check whether the element is currently visible. Terminal — executes the queue first. */
  async isPresent(): Promise<boolean> {
    await this.execute();
    return this.element.isVisible();
  }

  // ── Extractions (terminal) ───────────────────────────────────

  /** Execute queued actions, then return text content. */
  async getText(): Promise<string | null> {
    await this.execute();
    await this.element.waitFor({ state: 'attached', timeout: this.timeout }).catch(() => {});
    const text = await this.element.textContent();
    return text?.trim() ?? null;
  }

  /** Execute queued actions, then return an attribute value. */
  async getAttribute(name: string): Promise<string | null> {
    await this.execute();
    await this.element.waitFor({ state: 'attached', timeout: this.timeout }).catch(() => {});
    return this.element.getAttribute(name);
  }

  /** Execute queued actions, then return the input value. */
  async getInputValue(): Promise<string> {
    await this.execute();
    await this.element.waitFor({ state: 'attached', timeout: this.timeout }).catch(() => {});
    return this.element.inputValue();
  }

  /** Execute queued actions, then return the element count. */
  async getCount(): Promise<number> {
    await this.execute();
    return this.element.count();
  }

  /** Execute queued actions, then return the raw selector. */
  async getRaw(): Promise<string | null> {
    await this.execute();
    return this.element.raw();
  }

  // ── Thenable ─────────────────────────────────────────────────

  then<TResult1 = Element, TResult2 = never>(
    resolve?: ((value: Element) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(resolve, reject);
  }

  /** Execute all queued actions in sequence and return the element. */
  private async execute(): Promise<Element> {
    for (const action of this.queue) {
      await action();
    }
    this.queue = [];
    return this.element;
  }
}
