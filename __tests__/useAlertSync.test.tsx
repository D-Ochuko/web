import { renderHook, act, waitFor } from '@testing-library/react';
import { useAlertSync } from '../hooks/useAlertSync';

const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => [],
  });
  (global as any).fetch = mockFetch;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useAlertSync', () => {
  it('polls /alerts while the contract is enabled', async () => {
    renderHook(() =>
      useAlertSync({ id: 'c1', enabled: true } as any, { intervalMs: 1000 } as any)
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const callsAfterStart = mockFetch.mock.calls.length;

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() =>
      expect(mockFetch.mock.calls.length).toBeGreaterThan(callsAfterStart)
    );
  });

  it('does not poll when the contract is paused', async () => {
    renderHook(() =>
      useAlertSync({ id: 'c1', enabled: false } as any, { intervalMs: 1000 } as any)
    );

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('stops polling when paused and resumes when re-enabled', async () => {
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useAlertSync({ id: 'c1', enabled } as any, { intervalMs: 1000 } as any),
      { initialProps: { enabled: true } }
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    rerender({ enabled: false });
    const callsAtPause = mockFetch.mock.calls.length;

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(mockFetch.mock.calls.length).toBe(callsAtPause);

    rerender({ enabled: true });

    await waitFor(() =>
      expect(mockFetch.mock.calls.length).toBeGreaterThan(callsAtPause)
    );
  });
});
