import {
  createSignal,
  createResource,
  For,
  Show,
  Switch,
  Match,
} from "solid-js";

type Signal = {
  id: string;
  keyword: string;
  ticker: string;
  action: "BUY_WATCH" | "SELL_WATCH";
  newsTitle: string;
  newsUrl: string;
  newsSource: string | null;
  newsPubDate: string | null;
  impactType: "SUPPLY_SHOCK" | "DEMAND_SHOCK" | "REGULATORY";
  sentiment: "BULLISH" | "BEARISH";
  confidence: number;
  reasoning: string;
  validationTicker: string | null;
  currentPrice: number | null;
  priceChangePercent: number | null;
  volumeRatio: number | null;
  volumeSpike: boolean | null;
  status: "active" | "pending_market_open" | "acted" | "expired" | "dismissed";
  actedAt: string | null;
  notes: string | null;
  createdAt: string;
  expiresAt: string | null;
};

type MetricsStats = {
  overall: {
    total: number;
    goodCalls: number;
    badCalls: number;
    neutral: number;
    pending: number;
    accuracy: string;
  };
  byKeyword: Array<{
    keyword: string;
    total: number;
    goodCalls: number;
    badCalls: number;
    avgConfidence: number;
  }>;
  byCheckpoint: {
    after1hr: {
      total: number;
      goodCalls: number;
      badCalls: number;
      neutral: number;
      accuracy: string;
    };
    nextSession: {
      total: number;
      goodCalls: number;
      badCalls: number;
      neutral: number;
      accuracy: string;
    };
    after24hr: {
      total: number;
      goodCalls: number;
      badCalls: number;
      neutral: number;
      accuracy: string;
    };
  };
};

type WatchlistItem = {
  id: string;
  keyword: string;
  ticker: string | null;
  assetType: "COMMODITY" | "EQUITY" | "ETF" | "CURRENCY" | "GLOBAL";
  globalValidationTicker: string | null;
  relatedTickers: string | null;
  enabled: boolean;
  notes: string | null;
  createdAt: string;
};

type PotentialCatalyst = {
  id: string;
  predictedImpact: string;
  affectedSymbols: string[];
  watchCriteria: {
    metric: "PRICE" | "VOLUME";
    direction: "UP" | "DOWN";
    thresholdPercent: number;
    timeoutHours: number;
  };
  relatedArticleIds: string[];
  sourceCitations?: Array<{
    index: number;
    title: string;
    url: string;
    source: string;
    pubDate: string;
  }>;
  // Pass 2 thesis fields
  primaryTicker: string | null;
  shortTermThesis: string | null;
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL" | null;
  potentialScore: number | null; // -10 to +10
  confidence: number | null; // 1-10
  // Status
  status: "monitoring" | "confirmed" | "invalidated" | "expired";
  validationLog: Array<{
    time: string;
    ticker: string;
    price: number;
    change: number;
    met: boolean;
  }>;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
};

type CatalystSuggestion = {
  id: string;
  symbol: string;
  stockName: string | null;
  action: "BUY" | "SELL" | "HOLD" | "WATCH" | "RAISE_CASH";
  rationale: string;
  confidence: number | null;
  quantity: number | null;
  allocationAmount: number | null;
  targetPrice: number | null;
  currentPrice: number | null;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
  // Catalyst-specific fields
  stopLoss: number | null;
  maxHoldDays: number | null;
  riskRewardRatio: number | null;
  trailingStop: boolean | null;
  entryTrigger: string | null;
  exitCondition: string | null;
  volatilityAtEntry: number | null;
  catalystId: string | null;
};

export default function CatalystPage() {
  const [activeTab, setActiveTab] = createSignal<
    "potentials" | "signals" | "suggestions" | "metrics" | "watchlist"
  >("potentials");
  const [statusFilter, setStatusFilter] = createSignal<string>("active");
  const [potentialFilter, setPotentialFilter] =
    createSignal<string>("monitoring");

  // Helper to render text with clickable citations
  const renderTextWithCitations = (
    text: string,
    citations?: Array<{
      index: number;
      title: string;
      url: string;
      source: string;
      pubDate: string;
    }>
  ) => {
    if (!citations || citations.length === 0) {
      return text;
    }

    // Split text by citation pattern [1], [2], etc.
    const parts: Array<{
      type: "text" | "citation";
      content: string;
      index?: number;
    }> = [];
    let lastIndex = 0;
    const citationRegex = /\[(\d+)\]/g;
    let match;

    while ((match = citationRegex.exec(text)) !== null) {
      // Add text before citation
      if (match.index > lastIndex) {
        parts.push({
          type: "text",
          content: text.slice(lastIndex, match.index),
        });
      }
      // Add citation
      const citationIndex = parseInt(match[1], 10);
      parts.push({ type: "citation", content: match[0], index: citationIndex });
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push({ type: "text", content: text.slice(lastIndex) });
    }

    return (
      <span>
        <For each={parts}>
          {(part) => (
            <>
              {part.type === "text" ? (
                part.content
              ) : (
                <Show
                  when={citations.find((c) => c.index === part.index)}
                  fallback={<span class="text-yellow">{part.content}</span>}
                >
                  {(citation) => (
                    <a
                      href={citation().url}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-mauve hover:text-mauve/80 underline decoration-dotted cursor-pointer"
                      title={`${citation().source}: ${citation().title}`}
                    >
                      {part.content}
                    </a>
                  )}
                </Show>
              )}
            </>
          )}
        </For>
      </span>
    );
  };

  // Get the base URL for API calls (works in both browser and SSR)
  const getBaseUrl = () => {
    if (typeof window !== "undefined") {
      return window.location.origin;
    }
    return ""; // Return empty string during SSR, resources won't fetch
  };

  // Fetch signals
  const [signals, { refetch: refetchSignals }] = createResource(
    () => ({ filter: statusFilter(), enabled: typeof window !== "undefined" }),
    async ({ filter, enabled }) => {
      if (!enabled) return [];
      const url = filter
        ? `${getBaseUrl()}/api/catalyst/signals?status=${filter}`
        : `${getBaseUrl()}/api/catalyst/signals`;
      const res = await fetch(url);
      const data = await res.json();
      return data.signals as Signal[];
    }
  );

  // Fetch metrics
  const [metrics] = createResource(
    () => ({ enabled: typeof window !== "undefined" }),
    async ({ enabled }) => {
      if (!enabled) return null;
      const res = await fetch(`${getBaseUrl()}/api/catalyst/metrics`);
      const data = await res.json();
      return data as MetricsStats;
    }
  );

  // Fetch watchlist
  const [watchlist, { refetch: refetchWatchlist }] = createResource(
    () => ({ enabled: typeof window !== "undefined" }),
    async ({ enabled }) => {
      if (!enabled) return [];
      const res = await fetch(`${getBaseUrl()}/api/catalyst/watchlist`);
      const data = await res.json();
      return data.watchlist as WatchlistItem[];
    }
  );

  // Fetch potential catalysts
  const [potentials, { refetch: refetchPotentials }] = createResource(
    () => ({
      filter: potentialFilter(),
      enabled: typeof window !== "undefined",
    }),
    async ({ filter, enabled }) => {
      if (!enabled) return [];
      const url = filter
        ? `${getBaseUrl()}/api/catalyst/potentials?status=${filter}`
        : `${getBaseUrl()}/api/catalyst/potentials`;
      const res = await fetch(url);
      const data = await res.json();
      return data as PotentialCatalyst[];
    }
  );

  // Fetch catalyst suggestions (from Pass 3)
  const [catalystSuggestions, { refetch: refetchSuggestions }] = createResource(
    () => ({ enabled: typeof window !== "undefined" }),
    async ({ enabled }) => {
      if (!enabled) return [];
      const res = await fetch(`${getBaseUrl()}/api/catalyst/suggestions`);
      const data = await res.json();
      return data.suggestions as CatalystSuggestion[];
    }
  );

  const updateSignalStatus = async (id: string, status: string) => {
    await fetch(`${getBaseUrl()}/api/catalyst/signals`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    refetchSignals();
  };

  const toggleWatchlistItem = async (id: string, enabled: boolean) => {
    await fetch(`${getBaseUrl()}/api/catalyst/watchlist`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    });
    refetchWatchlist();
  };

  const confirmPotential = async (id: string) => {
    await fetch(`${getBaseUrl()}/api/catalyst/potentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "confirm" }),
    });
    refetchPotentials();
  };

  const dismissPotential = async (id: string) => {
    await fetch(`${getBaseUrl()}/api/catalyst/potentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "invalidate" }),
    });
    refetchPotentials();
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));

    if (hours < 1) {
      const minutes = Math.floor(diff / (1000 * 60));
      return `${minutes}m ago`;
    } else if (hours < 24) {
      return `${hours}h ago`;
    } else {
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    }
  };

  const getImpactColor = (impactType: string) => {
    switch (impactType) {
      case "SUPPLY_SHOCK":
        return "text-red";
      case "DEMAND_SHOCK":
        return "text-blue";
      case "REGULATORY":
        return "text-yellow";
      default:
        return "text-text";
    }
  };

  const getSentimentColor = (sentiment: string) => {
    return sentiment === "BULLISH" ? "text-green" : "text-red";
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      active: "bg-green/20 text-green",
      pending_market_open: "bg-yellow/20 text-yellow",
      acted: "bg-blue/20 text-blue",
      expired: "bg-overlay0/50 text-subtext0",
      dismissed: "bg-overlay0/50 text-subtext0",
    };
    return styles[status as keyof typeof styles] || styles.expired;
  };

  return (
    <div class="max-w-7xl mx-auto px-4 py-6">
      {/* Page Header */}
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-text mb-2">Catalyst Catcher</h1>
        <p class="text-subtext0">
          AI-powered swing trading signals based on market-moving news events
        </p>
      </div>

      {/* Tabs */}
      <div class="flex gap-2 mb-6 border-b border-surface1">
        <button
          onClick={() => setActiveTab("potentials")}
          class={`px-4 py-2 font-medium transition-colors ${
            activeTab() === "potentials"
              ? "text-mauve border-b-2 border-mauve"
              : "text-subtext0 hover:text-text"
          }`}
        >
          Discoveries
          <Show when={potentials() && potentials()!.length > 0}>
            <span class="ml-2 px-2 py-0.5 text-xs bg-mauve/20 text-mauve rounded-full">
              {potentials()!.length}
            </span>
          </Show>
        </button>
        <button
          onClick={() => setActiveTab("signals")}
          class={`px-4 py-2 font-medium transition-colors ${
            activeTab() === "signals"
              ? "text-mauve border-b-2 border-mauve"
              : "text-subtext0 hover:text-text"
          }`}
        >
          Signals
        </button>
        <button
          onClick={() => setActiveTab("suggestions")}
          class={`px-4 py-2 font-medium transition-colors ${
            activeTab() === "suggestions"
              ? "text-mauve border-b-2 border-mauve"
              : "text-subtext0 hover:text-text"
          }`}
        >
          Suggestions
          <Show
            when={
              catalystSuggestions() &&
              catalystSuggestions()!.filter((s) => s.status === "pending")
                .length > 0
            }
          >
            <span class="ml-2 px-2 py-0.5 text-xs bg-green/20 text-green rounded-full">
              {
                catalystSuggestions()!.filter((s) => s.status === "pending")
                  .length
              }
            </span>
          </Show>
        </button>
        <button
          onClick={() => setActiveTab("metrics")}
          class={`px-4 py-2 font-medium transition-colors ${
            activeTab() === "metrics"
              ? "text-mauve border-b-2 border-mauve"
              : "text-subtext0 hover:text-text"
          }`}
        >
          Metrics
        </button>
        <button
          onClick={() => setActiveTab("watchlist")}
          class={`px-4 py-2 font-medium transition-colors ${
            activeTab() === "watchlist"
              ? "text-mauve border-b-2 border-mauve"
              : "text-subtext0 hover:text-text"
          }`}
        >
          Watchlist
        </button>
      </div>

      {/* Tab Content */}
      <Switch>
        <Match when={activeTab() === "potentials"}>
          <div class="space-y-4">
            {/* Filter */}
            <div class="flex gap-2">
              <button
                onClick={() => setPotentialFilter("monitoring")}
                class={`px-3 py-1 text-sm rounded-lg transition-colors ${
                  potentialFilter() === "monitoring"
                    ? "bg-mauve/20 text-mauve"
                    : "bg-surface1 text-subtext0 hover:text-text"
                }`}
              >
                Monitoring
              </button>
              <button
                onClick={() => setPotentialFilter("confirmed")}
                class={`px-3 py-1 text-sm rounded-lg transition-colors ${
                  potentialFilter() === "confirmed"
                    ? "bg-mauve/20 text-mauve"
                    : "bg-surface1 text-subtext0 hover:text-text"
                }`}
              >
                Confirmed
              </button>
              <button
                onClick={() => setPotentialFilter("all")}
                class={`px-3 py-1 text-sm rounded-lg transition-colors ${
                  potentialFilter() === "all"
                    ? "bg-mauve/20 text-mauve"
                    : "bg-surface1 text-subtext0 hover:text-text"
                }`}
              >
                All
              </button>
            </div>

            {/* Potentials List */}
            <Show
              when={!potentials.loading}
              fallback={<div class="text-subtext0">Loading discoveries...</div>}
            >
              <Show
                when={potentials() && potentials()!.length > 0}
                fallback={
                  <div class="text-subtext0">
                    No catalyst discoveries yet. The AI will analyze news and
                    identify market-moving events.
                  </div>
                }
              >
                <div class="space-y-6">
                  {/* Group potentials by ticker */}
                  <For
                    each={(() => {
                      // Group by ticker
                      const grouped = new Map<string, PotentialCatalyst[]>();
                      potentials()?.forEach((p) => {
                        p.affectedSymbols.forEach((ticker) => {
                          if (!grouped.has(ticker)) {
                            grouped.set(ticker, []);
                          }
                          grouped.get(ticker)!.push(p);
                        });
                      });
                      return Array.from(grouped.entries());
                    })()}
                  >
                    {([ticker, tickerPotentials]) => (
                      <div class="border border-surface1 rounded-xl overflow-hidden">
                        {/* Ticker Header */}
                        <div class="bg-surface1 px-5 py-3 border-b border-surface2">
                          <div class="flex items-center justify-between">
                            <div>
                              <h3 class="text-lg font-bold text-mauve">
                                {ticker}
                              </h3>
                              <p class="text-xs text-subtext0">
                                {tickerPotentials.length} catalyst
                                {tickerPotentials.length > 1 ? "s" : ""}{" "}
                                discovered
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Catalysts for this ticker */}
                        <div class="divide-y divide-surface1">
                          <For each={tickerPotentials}>
                            {(potential) => {
                              // Calculate progress from latest validation check FOR THIS TICKER ONLY
                              // Filter validation log to only show entries for the current ticker
                              const tickerValidationLog =
                                potential.validationLog &&
                                potential.validationLog.length > 0
                                  ? potential.validationLog.filter(
                                      (entry: any) => entry.ticker === ticker
                                    )
                                  : [];

                              const latestCheck =
                                tickerValidationLog.length > 0
                                  ? tickerValidationLog[
                                      tickerValidationLog.length - 1
                                    ]
                                  : null;

                              // Calculate progress - only show positive progress toward target
                              const progressPercent =
                                latestCheck && potential.watchCriteria
                                  ? (() => {
                                      const change = latestCheck.change;
                                      const threshold =
                                        potential.watchCriteria
                                          .thresholdPercent;
                                      const direction =
                                        potential.watchCriteria.direction;

                                      // For UP direction: positive change = progress, negative = 0
                                      if (direction === "UP") {
                                        return change > 0
                                          ? (change / threshold) * 100
                                          : 0;
                                      }
                                      // For DOWN direction: negative change = progress, positive = 0
                                      else {
                                        return change < 0
                                          ? (-change / threshold) * 100
                                          : 0;
                                      }
                                    })()
                                  : 0;

                              // Check if moving in wrong direction
                              const wrongDirection =
                                latestCheck && potential.watchCriteria
                                  ? (potential.watchCriteria.direction ===
                                      "UP" &&
                                      latestCheck.change < 0) ||
                                    (potential.watchCriteria.direction ===
                                      "DOWN" &&
                                      latestCheck.change > 0)
                                  : false;

                              const ageInHours = () => {
                                const created = new Date(potential.createdAt);
                                const now = new Date();
                                return Math.floor(
                                  (now.getTime() - created.getTime()) /
                                    (1000 * 60 * 60)
                                );
                              };

                              const timeLeft = potential.watchCriteria
                                ? Math.max(
                                    0,
                                    potential.watchCriteria.timeoutHours -
                                      ageInHours()
                                  )
                                : 0;

                              return (
                                <div class="bg-surface0 p-5 hover:bg-surface0/80 transition-all">
                                  {/* Header */}
                                  <div class="flex items-start justify-between mb-3">
                                    <div class="flex-1">
                                      <div class="flex items-center gap-2 mb-2">
                                        <span
                                          class={`px-2 py-1 text-xs rounded ${
                                            potential.status === "monitoring"
                                              ? "bg-blue/20 text-blue"
                                              : potential.status === "confirmed"
                                              ? "bg-green/20 text-green"
                                              : "bg-overlay0 text-subtext0"
                                          }`}
                                        >
                                          {potential.status}
                                        </span>
                                        <span class="text-xs text-subtext1">
                                          {formatDate(potential.createdAt)}
                                        </span>
                                        <Show
                                          when={
                                            potential.status === "monitoring" &&
                                            timeLeft > 0
                                          }
                                        >
                                          <span class="text-xs text-yellow">
                                            {timeLeft}h left
                                          </span>
                                        </Show>
                                      </div>
                                      {/* Thesis Section - Show prominently if available */}
                                      <Show when={potential.shortTermThesis}>
                                        <div class="mb-3 p-3 bg-surface1/70 rounded-lg border-l-4 border-mauve">
                                          <div class="flex items-center gap-2 mb-2">
                                            {/* Potential Score Badge */}
                                            <span
                                              class={`px-2 py-1 text-sm font-bold rounded ${
                                                (potential.potentialScore ||
                                                  0) >= 5
                                                  ? "bg-green/20 text-green"
                                                  : (potential.potentialScore ||
                                                      0) <= -5
                                                  ? "bg-red/20 text-red"
                                                  : (potential.potentialScore ||
                                                      0) > 0
                                                  ? "bg-green/10 text-green"
                                                  : (potential.potentialScore ||
                                                      0) < 0
                                                  ? "bg-red/10 text-red"
                                                  : "bg-overlay0 text-subtext0"
                                              }`}
                                            >
                                              {(potential.potentialScore || 0) >
                                              0
                                                ? "+"
                                                : ""}
                                              {potential.potentialScore || 0}
                                            </span>
                                            {/* Sentiment */}
                                            <span
                                              class={`text-xs font-medium ${
                                                potential.sentiment ===
                                                "BULLISH"
                                                  ? "text-green"
                                                  : potential.sentiment ===
                                                    "BEARISH"
                                                  ? "text-red"
                                                  : "text-subtext0"
                                              }`}
                                            >
                                              {potential.sentiment || "NEUTRAL"}
                                            </span>
                                            {/* Confidence */}
                                            <span class="text-xs text-subtext1">
                                              Confidence:{" "}
                                              {potential.confidence || 5}/10
                                            </span>
                                          </div>
                                          <p class="text-text text-sm leading-relaxed">
                                            {potential.shortTermThesis}
                                          </p>
                                        </div>
                                      </Show>
                                      {/* Original predicted impact - show as secondary info if thesis exists */}
                                      <Show when={!potential.shortTermThesis}>
                                        <p class="text-text leading-relaxed">
                                          {renderTextWithCitations(
                                            potential.predictedImpact,
                                            potential.sourceCitations
                                          )}
                                        </p>
                                      </Show>
                                      <Show
                                        when={
                                          potential.shortTermThesis &&
                                          potential.predictedImpact !==
                                            potential.shortTermThesis
                                        }
                                      >
                                        <p class="text-subtext0 text-sm leading-relaxed mt-2">
                                          {renderTextWithCitations(
                                            potential.predictedImpact,
                                            potential.sourceCitations
                                          )}
                                        </p>
                                      </Show>
                                    </div>
                                  </div>

                                  {/* Watch Criteria */}
                                  <Show when={potential.watchCriteria}>
                                    <div class="mb-3 p-3 bg-surface1 rounded-lg">
                                      <div class="text-xs text-subtext1 mb-1">
                                        Watching for:{" "}
                                        {potential.watchCriteria.metric}{" "}
                                        {potential.watchCriteria.direction}{" "}
                                        {potential.watchCriteria.direction ===
                                        "UP"
                                          ? "+"
                                          : "-"}
                                        {
                                          potential.watchCriteria
                                            .thresholdPercent
                                        }
                                        %
                                      </div>
                                      <Show when={latestCheck}>
                                        <Show when={wrongDirection}>
                                          <div class="flex items-center gap-2 p-2 bg-red/10 rounded mt-2">
                                            <span class="text-xs text-red">
                                              ⚠️ Moving opposite direction:{" "}
                                              {latestCheck!.ticker}{" "}
                                              {latestCheck!.change > 0
                                                ? "+"
                                                : ""}
                                              {latestCheck!.change.toFixed(2)}%
                                            </span>
                                          </div>
                                        </Show>
                                        <Show when={!wrongDirection}>
                                          <div class="flex items-center gap-3 mt-2">
                                            <div class="flex-1">
                                              <div class="text-xs text-subtext0 mb-1">
                                                {latestCheck!.ticker}:{" "}
                                                {latestCheck!.change > 0
                                                  ? "+"
                                                  : ""}
                                                {latestCheck!.change.toFixed(2)}
                                                %
                                              </div>
                                              <div class="h-2 bg-surface0 rounded-full overflow-hidden">
                                                <div
                                                  class={`h-full transition-all ${
                                                    progressPercent >= 100
                                                      ? "bg-green"
                                                      : progressPercent >= 50
                                                      ? "bg-yellow"
                                                      : "bg-blue"
                                                  }`}
                                                  style={{
                                                    width: `${Math.min(
                                                      Math.max(
                                                        progressPercent,
                                                        0
                                                      ),
                                                      100
                                                    )}%`,
                                                  }}
                                                />
                                              </div>
                                            </div>
                                            <div
                                              class={`text-sm font-medium ${
                                                progressPercent >= 100
                                                  ? "text-green"
                                                  : progressPercent >= 50
                                                  ? "text-yellow"
                                                  : "text-subtext0"
                                              }`}
                                            >
                                              {progressPercent.toFixed(0)}%
                                            </div>
                                          </div>
                                        </Show>
                                        <div class="text-xs text-subtext1 mt-1">
                                          Last checked:{" "}
                                          {formatDate(latestCheck!.time)}
                                        </div>
                                      </Show>
                                    </div>
                                  </Show>

                                  {/* Citations Reference Section */}
                                  <Show
                                    when={
                                      potential.sourceCitations &&
                                      potential.sourceCitations.length > 0
                                    }
                                  >
                                    {/* Only show sources that are actually cited in the text */}
                                    {(() => {
                                      // Extract cited indices from text
                                      const textToCheck = `${
                                        potential.predictedImpact || ""
                                      } ${potential.shortTermThesis || ""}`;
                                      const citedIndices = new Set<number>();
                                      const matches =
                                        textToCheck.matchAll(/\[(\d+)\]/g);
                                      for (const match of matches) {
                                        citedIndices.add(
                                          parseInt(match[1], 10)
                                        );
                                      }

                                      const citedSources =
                                        potential.sourceCitations?.filter((c) =>
                                          citedIndices.has(c.index)
                                        ) || [];

                                      if (citedSources.length === 0)
                                        return null;

                                      return (
                                        <div class="mt-3 p-3 bg-surface1/50 rounded-lg border-l-2 border-mauve/30">
                                          <div class="text-xs font-semibold text-subtext1 mb-2">
                                            📚 Sources ({citedSources.length}{" "}
                                            cited)
                                          </div>
                                          <div class="space-y-1">
                                            <For each={citedSources}>
                                              {(citation) => (
                                                <div class="text-xs text-subtext0">
                                                  <span class="text-mauve font-medium">
                                                    [{citation.index}]
                                                  </span>{" "}
                                                  <a
                                                    href={citation.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    class="text-text hover:text-mauve underline decoration-dotted"
                                                  >
                                                    {citation.title}
                                                  </a>{" "}
                                                  <span class="text-subtext1">
                                                    - {citation.source}
                                                  </span>
                                                </div>
                                              )}
                                            </For>
                                          </div>
                                        </div>
                                      );
                                    })()}
                                  </Show>

                                  {/* Actions */}
                                  <div class="flex gap-2 pt-3 border-t border-surface1">
                                    <Show
                                      when={potential.status === "monitoring"}
                                    >
                                      <button
                                        onClick={() =>
                                          confirmPotential(potential.id)
                                        }
                                        class="px-3 py-1.5 text-sm bg-green/20 text-green hover:bg-green/30 rounded-lg transition-colors"
                                      >
                                        ✓ Confirm
                                      </button>
                                      <button
                                        onClick={() =>
                                          dismissPotential(potential.id)
                                        }
                                        class="px-3 py-1.5 text-sm bg-red/20 text-red hover:bg-red/30 rounded-lg transition-colors"
                                      >
                                        ✗ Dismiss
                                      </button>
                                    </Show>
                                  </div>
                                </div>
                              );
                            }}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </Match>

        <Match when={activeTab() === "signals"}>
          <div class="space-y-4">
            {/* Filter */}
            <div class="flex gap-2">
              <button
                onClick={() => setStatusFilter("active")}
                class={`px-3 py-1 rounded-lg text-sm transition-colors ${
                  statusFilter() === "active"
                    ? "bg-green/20 text-green"
                    : "bg-surface1 text-subtext0 hover:bg-surface2"
                }`}
              >
                Active
              </button>
              <button
                onClick={() => setStatusFilter("pending_market_open")}
                class={`px-3 py-1 rounded-lg text-sm transition-colors ${
                  statusFilter() === "pending_market_open"
                    ? "bg-yellow/20 text-yellow"
                    : "bg-surface1 text-subtext0 hover:bg-surface2"
                }`}
              >
                Pending Market Open
              </button>
              <button
                onClick={() => setStatusFilter("")}
                class={`px-3 py-1 rounded-lg text-sm transition-colors ${
                  !statusFilter()
                    ? "bg-mauve/20 text-mauve"
                    : "bg-surface1 text-subtext0 hover:bg-surface2"
                }`}
              >
                All
              </button>
            </div>

            {/* Signals List */}
            <Show
              when={!signals.loading}
              fallback={<div class="text-subtext0">Loading signals...</div>}
            >
              <Show
                when={signals()?.length ?? 0 > 0}
                fallback={<div class="text-subtext0">No signals found</div>}
              >
                <div class="space-y-6">
                  {/* Group signals by ticker */}
                  <For
                    each={(() => {
                      // Group by ticker
                      const grouped = new Map<string, Signal[]>();
                      signals()?.forEach((s) => {
                        if (!grouped.has(s.ticker)) {
                          grouped.set(s.ticker, []);
                        }
                        grouped.get(s.ticker)!.push(s);
                      });
                      return Array.from(grouped.entries());
                    })()}
                  >
                    {([ticker, tickerSignals]) => (
                      <div class="border border-surface1 rounded-xl overflow-hidden">
                        {/* Ticker Header */}
                        <div class="bg-surface1 px-5 py-3 border-b border-surface2">
                          <div class="flex items-center justify-between">
                            <div>
                              <h3 class="text-lg font-bold text-mauve">
                                {ticker}
                              </h3>
                              <p class="text-xs text-subtext0">
                                {tickerSignals.length} signal
                                {tickerSignals.length > 1 ? "s" : ""}
                              </p>
                            </div>
                            {/* Show latest price if available */}
                            <Show when={tickerSignals[0]?.currentPrice}>
                              <div class="text-right">
                                <div class="text-sm font-medium text-text">
                                  ₹{tickerSignals[0].currentPrice?.toFixed(2)}
                                </div>
                                <div
                                  class={`text-xs ${
                                    tickerSignals[0].priceChangePercent &&
                                    tickerSignals[0].priceChangePercent > 0
                                      ? "text-green"
                                      : "text-red"
                                  }`}
                                >
                                  {tickerSignals[0].priceChangePercent &&
                                  tickerSignals[0].priceChangePercent > 0
                                    ? "+"
                                    : ""}
                                  {tickerSignals[0].priceChangePercent?.toFixed(
                                    2
                                  )}
                                  %
                                </div>
                              </div>
                            </Show>
                          </div>
                        </div>

                        {/* Signals for this ticker */}
                        <div class="divide-y divide-surface1">
                          <For each={tickerSignals}>
                            {(signal) => (
                              <div class="bg-surface0 p-5 hover:bg-surface0/80 transition-all">
                                <div class="flex items-start justify-between mb-3">
                                  <div class="flex-1">
                                    <div class="flex items-center gap-2 mb-1">
                                      <span class="font-semibold text-text">
                                        {signal.keyword}
                                      </span>
                                      <span
                                        class={`text-sm font-medium ${getSentimentColor(
                                          signal.sentiment
                                        )}`}
                                      >
                                        {signal.action}
                                      </span>
                                      <span
                                        class={`px-2 py-0.5 rounded text-xs ${getStatusBadge(
                                          signal.status
                                        )}`}
                                      >
                                        {signal.status.replace(/_/g, " ")}
                                      </span>
                                    </div>
                                    <div class="flex items-center gap-3 text-sm text-subtext0 mb-2">
                                      <span
                                        class={getImpactColor(
                                          signal.impactType
                                        )}
                                      >
                                        {signal.impactType}
                                      </span>
                                      <span>
                                        Confidence: {signal.confidence}/10
                                      </span>
                                      <span>
                                        {formatDate(signal.createdAt)}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <a
                                  href={signal.newsUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  class="text-mauve hover:text-mauve/80 font-medium mb-2 block"
                                >
                                  {signal.newsTitle}
                                </a>

                                <p class="text-sm text-subtext1 mb-3">
                                  {signal.reasoning}
                                </p>

                                <Show when={signal.volumeSpike}>
                                  <div class="inline-flex items-center gap-1 px-2 py-1 bg-yellow/20 text-yellow rounded text-xs mb-3">
                                    <span>📊</span> Volume Spike!
                                  </div>
                                </Show>

                                <div class="flex gap-2">
                                  <Show
                                    when={
                                      signal.status === "active" ||
                                      signal.status === "pending_market_open"
                                    }
                                  >
                                    <button
                                      onClick={() =>
                                        updateSignalStatus(signal.id, "acted")
                                      }
                                      class="px-3 py-1 bg-green/20 text-green rounded-lg text-sm hover:bg-green/30 transition-colors"
                                    >
                                      Mark Acted
                                    </button>
                                    <button
                                      onClick={() =>
                                        updateSignalStatus(
                                          signal.id,
                                          "dismissed"
                                        )
                                      }
                                      class="px-3 py-1 bg-red/20 text-red rounded-lg text-sm hover:bg-red/30 transition-colors"
                                    >
                                      Dismiss
                                    </button>
                                  </Show>
                                </div>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </Match>

        <Match when={activeTab() === "suggestions"}>
          <div class="space-y-4">
            <Show
              when={!catalystSuggestions.loading}
              fallback={<div class="text-subtext0">Loading suggestions...</div>}
            >
              <Show
                when={
                  catalystSuggestions() && catalystSuggestions()!.length > 0
                }
                fallback={
                  <div class="text-subtext0">
                    No catalyst suggestions yet. Run catalyst analysis to
                    generate trade recommendations.
                  </div>
                }
              >
                <div class="space-y-4">
                  <For each={catalystSuggestions()}>
                    {(suggestion) => (
                      <div class="bg-surface0 border border-surface1 rounded-xl p-5">
                        <div class="flex items-start justify-between mb-3">
                          <div>
                            <div class="flex items-center gap-2 mb-1">
                              <span class="text-lg font-bold text-mauve">
                                {suggestion.symbol}
                              </span>
                              <span
                                class={`px-2 py-0.5 text-sm font-medium rounded ${
                                  suggestion.action === "BUY"
                                    ? "bg-green/20 text-green"
                                    : suggestion.action === "SELL"
                                    ? "bg-red/20 text-red"
                                    : suggestion.action === "WATCH"
                                    ? "bg-blue/20 text-blue"
                                    : "bg-overlay0 text-subtext0"
                                }`}
                              >
                                {suggestion.action}
                              </span>
                              <span
                                class={`px-2 py-0.5 text-xs rounded ${
                                  suggestion.status === "pending"
                                    ? "bg-yellow/20 text-yellow"
                                    : suggestion.status === "approved"
                                    ? "bg-green/20 text-green"
                                    : suggestion.status === "rejected"
                                    ? "bg-red/20 text-red"
                                    : "bg-overlay0 text-subtext0"
                                }`}
                              >
                                {suggestion.status}
                              </span>
                            </div>
                            <Show when={suggestion.stockName}>
                              <p class="text-sm text-subtext0">
                                {suggestion.stockName}
                              </p>
                            </Show>
                          </div>
                          <div class="text-right">
                            <Show when={suggestion.currentPrice}>
                              <div class="text-sm font-medium text-text">
                                ₹
                                {suggestion.currentPrice?.toLocaleString(
                                  "en-IN"
                                )}
                              </div>
                            </Show>
                            <Show when={suggestion.confidence}>
                              <div class="text-xs text-subtext0">
                                Confidence: {suggestion.confidence}/10
                              </div>
                            </Show>
                          </div>
                        </div>

                        <p class="text-text mb-3">{suggestion.rationale}</p>

                        {/* Catalyst-specific risk management display */}
                        <div class="grid grid-cols-2 gap-3 mb-3">
                          <Show when={suggestion.stopLoss}>
                            <div class="bg-surface1 rounded-lg p-2">
                              <div class="text-xs text-subtext1">Stop Loss</div>
                              <div class="text-sm font-medium text-red">
                                ₹{suggestion.stopLoss?.toLocaleString("en-IN")}
                              </div>
                            </div>
                          </Show>
                          <Show when={suggestion.riskRewardRatio}>
                            <div class="bg-surface1 rounded-lg p-2">
                              <div class="text-xs text-subtext1">
                                Risk:Reward
                              </div>
                              <div
                                class={`text-sm font-medium ${
                                  (suggestion.riskRewardRatio || 0) >= 2.0
                                    ? "text-green"
                                    : "text-yellow"
                                }`}
                              >
                                1:{suggestion.riskRewardRatio?.toFixed(1)}
                              </div>
                            </div>
                          </Show>
                          <Show when={suggestion.maxHoldDays}>
                            <div class="bg-surface1 rounded-lg p-2">
                              <div class="text-xs text-subtext1">Max Hold</div>
                              <div class="text-sm font-medium text-text">
                                {suggestion.maxHoldDays} days
                              </div>
                            </div>
                          </Show>
                          <Show when={suggestion.trailingStop !== null}>
                            <div class="bg-surface1 rounded-lg p-2">
                              <div class="text-xs text-subtext1">
                                Stop Type
                              </div>
                              <div class="text-sm font-medium text-text">
                                {suggestion.trailingStop
                                  ? "Trailing"
                                  : "Fixed"}
                              </div>
                            </div>
                          </Show>
                        </div>

                        {/* Entry and exit conditions */}
                        <Show when={suggestion.entryTrigger}>
                          <div class="mb-2 p-2 bg-blue/10 rounded-lg border-l-2 border-blue">
                            <div class="text-xs text-blue font-medium mb-1">
                              Entry Trigger
                            </div>
                            <div class="text-sm text-text">
                              {suggestion.entryTrigger}
                            </div>
                          </div>
                        </Show>
                        <Show when={suggestion.exitCondition}>
                          <div class="mb-2 p-2 bg-yellow/10 rounded-lg border-l-2 border-yellow">
                            <div class="text-xs text-yellow font-medium mb-1">
                              Exit Condition
                            </div>
                            <div class="text-sm text-text">
                              {suggestion.exitCondition}
                            </div>
                          </div>
                        </Show>

                        <div class="flex flex-wrap gap-4 text-sm text-subtext0">
                          <Show when={suggestion.targetPrice}>
                            <span>
                              Target: ₹
                              {suggestion.targetPrice?.toLocaleString("en-IN")}
                            </span>
                          </Show>
                          <Show when={suggestion.allocationAmount}>
                            <span>
                              Allocation: ₹
                              {suggestion.allocationAmount?.toLocaleString(
                                "en-IN"
                              )}
                            </span>
                          </Show>
                          <Show when={suggestion.volatilityAtEntry}>
                            <span>ATR: {suggestion.volatilityAtEntry}</span>
                          </Show>
                          <span>
                            Created: {formatDate(suggestion.createdAt)}
                          </span>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </Match>

        <Match when={activeTab() === "metrics"}>
          <Show
            when={!metrics.loading}
            fallback={<div class="text-subtext0">Loading metrics...</div>}
          >
            <Show when={metrics()}>
              <div class="space-y-6">
                {/* Overall Stats */}
                <div class="bg-surface0 rounded-lg p-6 border border-surface1">
                  <h2 class="text-xl font-bold text-text mb-4">
                    Overall Accuracy
                  </h2>
                  <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div>
                      <div class="text-3xl font-bold text-mauve">
                        {metrics()!.overall.accuracy}%
                      </div>
                      <div class="text-sm text-subtext0">Accuracy</div>
                    </div>
                    <div>
                      <div class="text-3xl font-bold text-text">
                        {metrics()!.overall.total}
                      </div>
                      <div class="text-sm text-subtext0">Total</div>
                    </div>
                    <div>
                      <div class="text-3xl font-bold text-green">
                        {metrics()!.overall.goodCalls}
                      </div>
                      <div class="text-sm text-subtext0">Good Calls</div>
                    </div>
                    <div>
                      <div class="text-3xl font-bold text-red">
                        {metrics()!.overall.badCalls}
                      </div>
                      <div class="text-sm text-subtext0">Bad Calls</div>
                    </div>
                    <div>
                      <div class="text-3xl font-bold text-yellow">
                        {metrics()!.overall.pending}
                      </div>
                      <div class="text-sm text-subtext0">Pending</div>
                    </div>
                  </div>
                </div>

                {/* By Checkpoint */}
                <div class="bg-surface0 rounded-lg p-6 border border-surface1">
                  <h2 class="text-xl font-bold text-text mb-4">
                    Accuracy by Timeframe
                  </h2>
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <div class="text-2xl font-bold text-mauve">
                        {metrics()!.byCheckpoint.after1hr.accuracy}%
                      </div>
                      <div class="text-sm text-subtext0 mb-2">After 1 Hour</div>
                      <div class="text-xs text-subtext1">
                        {metrics()!.byCheckpoint.after1hr.goodCalls} /{" "}
                        {metrics()!.byCheckpoint.after1hr.total}
                      </div>
                    </div>
                    <div>
                      <div class="text-2xl font-bold text-mauve">
                        {metrics()!.byCheckpoint.nextSession.accuracy}%
                      </div>
                      <div class="text-sm text-subtext0 mb-2">Next Session</div>
                      <div class="text-xs text-subtext1">
                        {metrics()!.byCheckpoint.nextSession.goodCalls} /{" "}
                        {metrics()!.byCheckpoint.nextSession.total}
                      </div>
                    </div>
                    <div>
                      <div class="text-2xl font-bold text-mauve">
                        {metrics()!.byCheckpoint.after24hr.accuracy}%
                      </div>
                      <div class="text-sm text-subtext0 mb-2">
                        After 24 Hours
                      </div>
                      <div class="text-xs text-subtext1">
                        {metrics()!.byCheckpoint.after24hr.goodCalls} /{" "}
                        {metrics()!.byCheckpoint.after24hr.total}
                      </div>
                    </div>
                  </div>
                </div>

                {/* By Keyword */}
                <div class="bg-surface0 rounded-lg p-6 border border-surface1">
                  <h2 class="text-xl font-bold text-text mb-4">
                    Accuracy by Keyword
                  </h2>
                  <Show
                    when={metrics()!.byKeyword.length > 0}
                    fallback={
                      <div class="text-subtext0">No data available</div>
                    }
                  >
                    <div class="space-y-2">
                      <For each={metrics()!.byKeyword}>
                        {(item) => (
                          <div class="flex items-center justify-between p-3 bg-surface1 rounded-lg">
                            <div class="flex-1">
                              <div class="font-medium text-text">
                                {item.keyword}
                              </div>
                              <div class="text-xs text-subtext0">
                                Avg Confidence: {item.avgConfidence.toFixed(1)}
                                /10
                              </div>
                            </div>
                            <div class="text-right">
                              <div class="text-lg font-bold text-mauve">
                                {item.total > 0
                                  ? (
                                      (item.goodCalls / item.total) *
                                      100
                                    ).toFixed(1)
                                  : "0.0"}
                                %
                              </div>
                              <div class="text-xs text-subtext0">
                                {item.goodCalls} / {item.total}
                              </div>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>
            </Show>
          </Show>
        </Match>

        <Match when={activeTab() === "watchlist"}>
          <Show
            when={!watchlist.loading}
            fallback={<div class="text-subtext0">Loading watchlist...</div>}
          >
            <Show
              when={watchlist()?.length ?? 0 > 0}
              fallback={<div class="text-subtext0">No watchlist items</div>}
            >
              <div class="space-y-3">
                <For each={watchlist()}>
                  {(item) => (
                    <div class="bg-surface0 rounded-lg p-4 border border-surface1 flex items-center justify-between">
                      <div class="flex-1">
                        <div class="flex items-center gap-3 mb-1">
                          <span class="font-semibold text-text">
                            {item.keyword}
                          </span>
                          <span class="px-2 py-0.5 bg-surface2 text-subtext0 rounded text-xs">
                            {item.assetType}
                          </span>
                          <Show when={item.ticker}>
                            <span class="text-sm text-subtext1">
                              {item.ticker}
                            </span>
                          </Show>
                        </div>
                        <Show when={item.globalValidationTicker}>
                          <div class="text-sm text-subtext0">
                            Global Ticker: {item.globalValidationTicker}
                          </div>
                        </Show>
                        <Show when={item.notes}>
                          <div class="text-sm text-subtext1 mt-1">
                            {item.notes}
                          </div>
                        </Show>
                      </div>
                      <button
                        onClick={() =>
                          toggleWatchlistItem(item.id, !item.enabled)
                        }
                        class={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          item.enabled
                            ? "bg-green/20 text-green hover:bg-green/30"
                            : "bg-surface1 text-subtext0 hover:bg-surface2"
                        }`}
                      >
                        {item.enabled ? "Enabled" : "Disabled"}
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Match>
      </Switch>
    </div>
  );
}
