import { renderHook, act, waitFor } from '@testing-library/react';
import { useAlertSync } from '../hooks/useAlertSync';

describe('useAlertSync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('calls the latest onNew callback after the contract is renamed between polls', async () => {
    const alerts = [{ id: 'a1', contractId: 'c1', label: 'Old Label' }];
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ alerts }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const firstOnNew = jest.fn();
    const renamedOnNew = jest.fn();

    const { rerender } = renderHook(
      ({ onNew }) =>
        useAlertSync({
          contractId: 'c1',
          onNew,
          intervalMs: 1000,
        }),
      { initialProps: { onNew: firstOnNew } },
    );

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => expect(firstOnNew).toHaveBeenCalled());

    // Simulate the user renaming the contract: a new onNew callback is passed.
    rerender({ onNew: renamedOnNew });

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => expect(renamedOnNew).toHaveBeenCalled());
    expect(renamedOnNew.mock.calls.at(-1)?.[0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Old Label' })]),
    );
  });

  it('resets enabled and live when contractId becomes undefined', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ alerts: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const onNew = jest.fn();

    const { result, rerender } = renderHook(
      ({ contractId }) =>
        useAlertSync({
          contractId,
          onNew,
          intervalMs: 1000,
        }),
      { initialProps: { contractId: 'c1' as string | undefined } },
    );

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => expect(result.current.enabled).toBe(true));

    rerender({ contractId: undefined });

    await waitFor(() => expect(result.current.enabled).toBe(false));
    expect(result.current.live).toBe(false);
  });
});
