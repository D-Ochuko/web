import { nextPollDelay, POLL_INTERVAL_MS, JITTER_RATIO } from "../lib/alertPolling";

describe("nextPollDelay jitter", () => {
  const base = POLL_INTERVAL_MS;
  const min = base * (1 - JITTER_RATIO);
  const max = base * (1 + JITTER_RATIO);

  it("stays within ±20% of the base interval", () => {
    for (let i = 0; i < 1000; i++) {
      const delay = nextPollDelay(base);
      expect(delay).toBeGreaterThanOrEqual(min);
      expect(delay).toBeLessThanOrEqual(max);
    }
  });

  it("applies jitter to a backoff base as well", () => {
    const backoff = base * 4;
    for (let i = 0; i < 1000; i++) {
      const delay = nextPollDelay(backoff);
      expect(delay).toBeGreaterThanOrEqual(backoff * (1 - JITTER_RATIO));
      expect(delay).toBeLessThanOrEqual(backoff * (1 + JITTER_RATIO));
    }
  });

  it("produces varied delays so loops are not aligned", () => {
    const samples = new Set<number>();
    for (let i = 0; i < 50; i++) {
      samples.add(nextPollDelay(base));
    }
    expect(samples.size).toBeGreaterThan(1);
  });
});
