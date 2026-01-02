import { createSignal, Show } from "solid-js";
import { supabase } from "../lib/supabase";

export default function AuthForm() {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [mode, setMode] = createSignal<"login" | "signup">("login");
  const [message, setMessage] = createSignal("");

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      if (mode() === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email(),
          password: password(),
        });
        if (error) throw error;
        // Set cookies before redirect
        if (data.session) {
          document.cookie = `sb-access-token=${data.session.access_token}; path=/; max-age=3600`;
          document.cookie = `sb-refresh-token=${data.session.refresh_token}; path=/; max-age=604800`;
        }
        window.location.href = "/dashboard";
      } else {
        const { error } = await supabase.auth.signUp({
          email: email(),
          password: password(),
        });
        if (error) throw error;
        setMessage("Check your email for the confirmation link!");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="w-full max-w-md mx-auto">
      <div class="bg-surface0 border border-surface1 rounded-2xl p-8">
        <h2 class="text-2xl font-bold text-center mb-6">
          {mode() === "login" ? "Welcome Back" : "Create Account"}
        </h2>

        <Show when={error()}>
          <div class="bg-red/10 border border-red/30 text-red rounded-lg p-3 mb-4 text-sm">
            {error()}
          </div>
        </Show>

        <Show when={message()}>
          <div class="bg-green/10 border border-green/30 text-green rounded-lg p-3 mb-4 text-sm">
            {message()}
          </div>
        </Show>

        <form onSubmit={handleSubmit} class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-subtext1 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              required
              class="w-full px-4 py-2 bg-surface1 border border-surface2 rounded-lg text-text placeholder-overlay0 focus:outline-none focus:ring-2 focus:ring-mauve focus:border-transparent"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-subtext1 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              required
              minLength={6}
              class="w-full px-4 py-2 bg-surface1 border border-surface2 rounded-lg text-text placeholder-overlay0 focus:outline-none focus:ring-2 focus:ring-mauve focus:border-transparent"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading()}
            class="w-full py-2 px-4 bg-mauve hover:bg-mauve/90 text-crust font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading()
              ? "Loading..."
              : mode() === "login"
              ? "Sign In"
              : "Sign Up"}
          </button>
        </form>

        <div class="mt-6 text-center">
          <button
            type="button"
            onClick={() => setMode(mode() === "login" ? "signup" : "login")}
            class="text-sm text-subtext0 hover:text-mauve transition-colors"
          >
            {mode() === "login"
              ? "Don't have an account? Sign up"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
