/**
 * Circuit Breaker Pattern for News Sources
 *
 * Prevents repeated calls to failing sources, saving time and resources.
 * A source enters "open" state after too many failures and won't be called
 * until a timeout period passes.
 */

interface CircuitState {
  status: "CLOSED" | "OPEN" | "HALF_OPEN";
  failureCount: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
}

interface CircuitBreakerConfig {
  failureThreshold: number; // Open circuit after N failures
  resetTimeoutMs: number; // Try again after this duration
  halfOpenMaxAttempts: number; // Max attempts in half-open state
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3, // Open after 3 failures
  resetTimeoutMs: 5 * 60 * 1000, // Try again after 5 minutes
  halfOpenMaxAttempts: 1,
};

/**
 * Circuit breaker state for each source
 */
const CIRCUIT_STATES = new Map<string, CircuitState>();

/**
 * Initialize a circuit breaker for a source
 */
function getCircuitState(sourceId: string): CircuitState {
  if (!CIRCUIT_STATES.has(sourceId)) {
    CIRCUIT_STATES.set(sourceId, {
      status: "CLOSED",
      failureCount: 0,
      lastFailureTime: null,
      lastSuccessTime: null,
    });
  }
  return CIRCUIT_STATES.get(sourceId)!;
}

/**
 * Check if a source is available (circuit is closed or half-open)
 */
export function isSourceAvailable(
  sourceId: string,
  config: Partial<CircuitBreakerConfig> = {}
): boolean {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const state = getCircuitState(sourceId);

  if (state.status === "CLOSED") {
    return true;
  }

  if (state.status === "OPEN") {
    // Check if enough time has passed to try again
    const now = Date.now();
    if (
      state.lastFailureTime &&
      now - state.lastFailureTime >= cfg.resetTimeoutMs
    ) {
      // Move to half-open state
      state.status = "HALF_OPEN";
      console.log(`[CircuitBreaker] ${sourceId}: OPEN → HALF_OPEN (timeout expired)`);
      return true;
    }
    return false;
  }

  if (state.status === "HALF_OPEN") {
    return true;
  }

  return false;
}

/**
 * Record a successful fetch
 */
export function recordSuccess(sourceId: string): void {
  const state = getCircuitState(sourceId);
  state.lastSuccessTime = Date.now();
  state.failureCount = 0;

  if (state.status !== "CLOSED") {
    console.log(`[CircuitBreaker] ${sourceId}: ${state.status} → CLOSED (success)`);
    state.status = "CLOSED";
  }
}

/**
 * Record a failed fetch
 */
export function recordFailure(
  sourceId: string,
  config: Partial<CircuitBreakerConfig> = {}
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const state = getCircuitState(sourceId);

  state.failureCount++;
  state.lastFailureTime = Date.now();

  if (state.status === "HALF_OPEN") {
    // Any failure in half-open state reopens the circuit
    state.status = "OPEN";
    console.warn(`[CircuitBreaker] ${sourceId}: HALF_OPEN → OPEN (failure)`);
    return;
  }

  if (state.status === "CLOSED" && state.failureCount >= cfg.failureThreshold) {
    state.status = "OPEN";
    console.warn(
      `[CircuitBreaker] ${sourceId}: CLOSED → OPEN (${state.failureCount} failures)`
    );
  }
}

/**
 * Get circuit breaker status for all sources
 */
export function getCircuitBreakerStats(): Record<
  string,
  {
    status: string;
    failureCount: number;
    lastFailureAgo: string | null;
    lastSuccessAgo: string | null;
  }
> {
  const now = Date.now();
  const stats: Record<string, any> = {};

  for (const [sourceId, state] of CIRCUIT_STATES.entries()) {
    stats[sourceId] = {
      status: state.status,
      failureCount: state.failureCount,
      lastFailureAgo: state.lastFailureTime
        ? `${Math.round((now - state.lastFailureTime) / 1000)}s ago`
        : null,
      lastSuccessAgo: state.lastSuccessTime
        ? `${Math.round((now - state.lastSuccessTime) / 1000)}s ago`
        : null,
    };
  }

  return stats;
}

/**
 * Reset circuit breaker for a source (useful for manual recovery)
 */
export function resetCircuitBreaker(sourceId: string): void {
  const state = getCircuitState(sourceId);
  state.status = "CLOSED";
  state.failureCount = 0;
  state.lastFailureTime = null;
  console.log(`[CircuitBreaker] ${sourceId}: Manually reset to CLOSED`);
}

/**
 * Reset all circuit breakers
 */
export function resetAllCircuitBreakers(): void {
  CIRCUIT_STATES.clear();
  console.log("[CircuitBreaker] All circuits reset");
}
