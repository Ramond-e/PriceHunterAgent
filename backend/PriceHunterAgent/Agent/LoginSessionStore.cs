using System.Collections.Concurrent;

namespace PriceHunterAgent.Agent;

/// <summary>
/// Singleton store that coordinates login-pause/resume between:
///   - PriceHunterAgentService (waits for user login)
///   - AgentController.Resume  (signals login is complete)
/// </summary>
public class LoginSessionStore
{
    private readonly ConcurrentDictionary<string, TaskCompletionSource<bool>> _pending = new();

    /// <summary>
    /// Blocks asynchronously until Resume(taskId) is called or the token is cancelled.
    /// </summary>
    public Task WaitForLoginAsync(string taskId, CancellationToken ct)
    {
        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[taskId] = tcs;
        ct.Register(() => tcs.TrySetCanceled());
        return tcs.Task;
    }

    /// <summary>
    /// Signals that login for the given task is complete.
    /// Returns true if a waiter was found and signalled.
    /// </summary>
    public bool Resume(string taskId)
    {
        if (_pending.TryRemove(taskId, out var tcs))
        {
            tcs.TrySetResult(true);
            return true;
        }
        return false;
    }
}
