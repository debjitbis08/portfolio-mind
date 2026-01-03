import { createSignal, Show } from "solid-js";

/**
 * Simple password login form for single-user mode.
 */
export default function AuthForm() {
  const [password, setPassword] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password() }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Login failed");
      }

      // Redirect to dashboard on success
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="w-full max-w-md mx-auto">
      <div class="bg-surface0 border border-surface1 rounded-2xl p-8">
        <h2 class="text-2xl font-bold text-center mb-6">Welcome Back</h2>

        <Show when={error()}>
          <div class="bg-red/10 border border-red/30 text-red rounded-lg p-3 mb-4 text-sm">
            {error()}
          </div>
        </Show>

        <form onSubmit={handleSubmit} class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-subtext1 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              required
              class="w-full px-4 py-2 bg-surface1 border border-surface2 rounded-lg text-text placeholder-overlay0 focus:outline-none focus:ring-2 focus:ring-mauve focus:border-transparent"
              placeholder="Enter password"
            />
          </div>

          <button
            type="submit"
            disabled={loading()}
            class="w-full py-2 px-4 bg-mauve hover:bg-mauve/90 text-crust font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading() ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
