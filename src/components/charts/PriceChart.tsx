/**
 * PriceChart Component
 *
 * Displays stock price chart with volume, 50 DMA, and 200 DMA overlays.
 * Uses lightweight-charts v5 (TradingView) library.
 */

import { createSignal, onMount, onCleanup, createEffect } from "solid-js";
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";

interface PriceChartProps {
  symbol: string;
}

interface ChartQuote {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface MAPoint {
  time: string;
  value: number;
}

interface ChartData {
  symbol: string;
  range: string;
  data: ChartQuote[];
  sma50: MAPoint[];
  sma200: MAPoint[];
}

type RangeOption = "1m" | "6m" | "1y";

export default function PriceChart(props: PriceChartProps) {
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [range, setRange] = createSignal<RangeOption>("1y");

  let chartContainer: HTMLDivElement | undefined;
  let chart: IChartApi | undefined;
  let candlestickSeries: ISeriesApi<"Candlestick"> | undefined;
  let volumeSeries: ISeriesApi<"Histogram"> | undefined;
  let sma50Series: ISeriesApi<"Line"> | undefined;
  let sma200Series: ISeriesApi<"Line"> | undefined;

  const fetchChartData = async (selectedRange: RangeOption) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/chart-data?symbol=${props.symbol}&range=${selectedRange}`
      );

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to fetch chart data");
      }

      const data: ChartData & { message?: string } = await response.json();

      // Handle empty data for recent IPOs
      if (!data.data || data.data.length === 0) {
        setError(data.message || "No data found, symbol may be delisted.");
        return;
      }

      if (candlestickSeries && volumeSeries && sma50Series && sma200Series) {
        // Update candlestick data
        candlestickSeries.setData(
          data.data.map((d) => ({
            time: d.time,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
          }))
        );

        // Update volume data
        volumeSeries.setData(
          data.data.map((d) => ({
            time: d.time,
            value: d.volume,
            color:
              d.close >= d.open
                ? "rgba(166, 227, 161, 0.5)"
                : "rgba(243, 139, 168, 0.5)",
          }))
        );

        // Update moving averages
        sma50Series.setData(data.sma50);
        sma200Series.setData(data.sma200);

        // Fit content to visible range
        chart?.timeScale().fitContent();
      }
    } catch (err) {
      console.error("Chart data fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to load chart");
    } finally {
      setLoading(false);
    }
  };

  const initChart = () => {
    if (!chartContainer) return;

    chart = createChart(chartContainer, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a6adc8", // subtext0
      },
      grid: {
        vertLines: { color: "#313244" }, // surface1
        horzLines: { color: "#313244" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: "#45475a", // surface2
      },
      timeScale: {
        borderColor: "#45475a",
        timeVisible: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
      },
      handleScroll: {
        vertTouchDrag: false,
      },
    });

    // Candlestick series (main price) - v5 API
    candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#a6e3a1", // green
      downColor: "#f38ba8", // red
      borderUpColor: "#a6e3a1",
      borderDownColor: "#f38ba8",
      wickUpColor: "#a6e3a1",
      wickDownColor: "#f38ba8",
    });

    // Volume histogram - v5 API
    volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: {
        type: "volume",
      },
      priceScaleId: "volume",
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    // 50 DMA line (orange) - v5 API
    sma50Series = chart.addSeries(LineSeries, {
      color: "#fab387", // peach
      lineWidth: 2,
      title: "50 DMA",
    });

    // 200 DMA line (gray/lavender) - v5 API
    sma200Series = chart.addSeries(LineSeries, {
      color: "#9399b2", // overlay2
      lineWidth: 2,
      title: "200 DMA",
    });

    // Handle resize
    const handleResize = () => {
      if (chart && chartContainer) {
        chart.applyOptions({ width: chartContainer.clientWidth });
      }
    };

    window.addEventListener("resize", handleResize);

    onCleanup(() => {
      window.removeEventListener("resize", handleResize);
      chart?.remove();
    });

    // Fetch initial data
    fetchChartData(range());
  };

  onMount(() => {
    initChart();
  });

  // Refetch when range changes
  createEffect(() => {
    const currentRange = range();
    if (chart) {
      fetchChartData(currentRange);
    }
  });

  const handleRangeChange = (newRange: RangeOption) => {
    setRange(newRange);
  };

  return (
    <div class="bg-surface0 border border-surface1 rounded-xl p-4">
      {/* Header with time range buttons */}
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-medium text-subtext0">Price & Volume</h3>
        <div class="flex gap-1">
          {(["1m", "6m", "1y"] as RangeOption[]).map((r) => (
            <button
              onClick={() => handleRangeChange(r)}
              class={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                range() === r
                  ? "bg-mauve text-crust"
                  : "bg-surface1 text-subtext0 hover:bg-surface2 hover:text-text"
              }`}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Chart container */}
      <div class="relative" style={{ height: "350px" }}>
        {loading() && (
          <div class="absolute inset-0 flex items-center justify-center bg-surface0/80 z-10">
            <div class="text-subtext1 text-sm">Loading chart...</div>
          </div>
        )}
        {error() && (
          <div class="absolute inset-0 flex items-center justify-center bg-surface0/80 z-10">
            <div class="text-red text-sm">{error()}</div>
          </div>
        )}
        <div
          ref={chartContainer}
          style={{ width: "100%", height: "100%" }}
        ></div>
      </div>

      {/* Legend */}
      <div class="flex items-center gap-4 mt-3 text-xs text-subtext1">
        <div class="flex items-center gap-1.5">
          <span
            class="w-3 h-0.5 rounded"
            style={{ "background-color": "#fab387" }}
          ></span>
          <span>50 DMA</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span
            class="w-3 h-0.5 rounded"
            style={{ "background-color": "#9399b2" }}
          ></span>
          <span>200 DMA</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span
            class="w-3 h-2 rounded"
            style={{ "background-color": "rgba(166, 227, 161, 0.5)" }}
          ></span>
          <span>Volume</span>
        </div>
      </div>
    </div>
  );
}
