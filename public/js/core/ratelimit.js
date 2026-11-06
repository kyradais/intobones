/* js/core/ratelimit.js — Per-role request queue: requests/minute, concurrency, minimum delay, retry with backoff.
 * State: reads S.limits.vision and S.limits.image live (changes apply to queued work immediately)
 * Gotchas: only errors with err.retryable === true are retried (429/5xx). The clock is injectable so tests can
 *          use fake timers. cancelAll() rejects queued jobs and aborts in-flight fetches via the task's signal.
 *
 * @auto-deps-begin
 * Defines: Limiters, RateLimiter, makeAbortError
 * Uses: S
 * @auto-deps-end
 */
function makeAbortError() {
  const err = new Error('Cancelled');
  err.name = 'AbortError';
  return err;
}

class RateLimiter {
  constructor(cfg, clock) {
    this.cfg = cfg;
    this.clock = clock || { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms) };
    this.queue = [];
    this.active = 0;
    this.starts = [];
    this.lastStart = -Infinity;
    this.timer = null;
    this.ctrl = new AbortController();
    this.listeners = [];
  }

  config() {
    const c = typeof this.cfg === 'function' ? this.cfg() : this.cfg;
    return {
      rpm: Math.max(1, Number(c.rpm) || 1),
      concurrency: Math.max(1, Number(c.concurrency) || 1),
      minDelayMs: Math.max(0, Number(c.minDelayMs) || 0),
      retries: Math.max(0, Number(c.retries) || 0)
    };
  }

  status() {
    return { pending: this.queue.length, active: this.active };
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  emit() {
    const st = this.status();
    this.listeners.forEach((fn) => fn(st));
  }

  schedule(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.emit();
      this.pump();
    });
  }

  pump() {
    if (this.timer) return;
    const c = this.config();
    while (this.queue.length && this.active < c.concurrency) {
      const now = this.clock.now();
      this.starts = this.starts.filter((t) => now - t < 60000);
      let wait = c.minDelayMs - (now - this.lastStart);
      if (this.starts.length >= c.rpm) wait = Math.max(wait, 60000 - (now - this.starts[0]));
      if (wait > 0) {
        this.timer = this.clock.setTimeout(() => {
          this.timer = null;
          this.pump();
        }, Math.ceil(wait));
        return;
      }
      this.begin(this.queue.shift(), now);
    }
  }

  begin(job, now) {
    this.starts.push(now);
    this.lastStart = now;
    this.active += 1;
    this.emit();
    this.run(job);
  }

  sleep(ms) {
    return new Promise((resolve) => this.clock.setTimeout(resolve, ms));
  }

  async run(job) {
    const c = this.config();
    let attempt = 0;
    try {
      for (;;) {
        try {
          job.resolve(await job.task({ attempt, signal: this.ctrl.signal }));
          return;
        } catch (err) {
          const canRetry = err && err.retryable && attempt < c.retries && !this.ctrl.signal.aborted;
          if (!canRetry) throw err;
          const delay = err.retryAfterMs || Math.min(30000, 1000 * 2 ** attempt);
          attempt += 1;
          await this.sleep(delay);
        }
      }
    } catch (err) {
      job.reject(err);
    } finally {
      this.active -= 1;
      this.emit();
      this.pump();
    }
  }

  cancelAll() {
    this.queue.splice(0).forEach((job) => job.reject(makeAbortError()));
    this.ctrl.abort();
    this.ctrl = new AbortController();
    this.emit();
  }
}

const Limiters = {
  vision: new RateLimiter(() => S.limits.vision),
  image: new RateLimiter(() => S.limits.image)
};
