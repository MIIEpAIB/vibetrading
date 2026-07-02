import { useEffect, useMemo, useRef } from "react";
import type { EquityPoint } from "@/lib/api";
import { getChartTheme } from "@/lib/chart-theme";
import { echarts, CHART_GROUP, connectCharts } from "@/lib/echarts";
import { useDarkMode } from "@/hooks/useDarkMode";
import { useTranslation } from "@/i18n/I18nProvider";

interface Props {
  data: EquityPoint[];
  initialCapital: number;
  height?: number;
}

function finiteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatPct(value: number) {
  return `${value.toFixed(2)}%`;
}

export function StrategyReturnChart({ data, initialCapital, height = 300 }: Props) {
  const { t, language } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const { dark } = useDarkMode();
  const labels = language === "zh-CN"
    ? { returnCurve: "策略收益曲线", drawdown: "回撤", maxDrawdown: "最大回撤" }
    : { returnCurve: "Strategy Return", drawdown: "Drawdown", maxDrawdown: "Max DD" };

  const chartData = useMemo(() => {
    const equity = data.map((point) => finiteNumber(point.equity));
    const fallbackBase = equity.find((value): value is number => value !== null && value > 0) ?? 1;
    const base = Number.isFinite(initialCapital) && initialCapital > 0 ? initialCapital : fallbackBase;
    let peak = fallbackBase;

    return data.map((point, index) => {
      const value = equity[index] ?? fallbackBase;
      peak = Math.max(peak, value);
      const fallbackDrawdownPct = peak > 0 ? ((value - peak) / peak) * 100 : 0;
      const rawDrawdown = finiteNumber(point.drawdown);
      const drawdownPct = rawDrawdown === null
        ? fallbackDrawdownPct
        : -Math.abs(Math.abs(rawDrawdown) <= 1 ? rawDrawdown * 100 : rawDrawdown);

      return {
        time: point.time,
        returnPct: ((value / base) - 1) * 100,
        drawdownPct,
      };
    });
  }, [data, initialCapital]);

  useEffect(() => {
    if (!ref.current || chartData.length === 0) return;
    const theme = getChartTheme();
    const chart = echarts.init(ref.current);
    chart.group = CHART_GROUP;
    connectCharts();

    const dates = chartData.map((point) => point.time);
    const returns = chartData.map((point) => Number(point.returnPct.toFixed(2)));
    const drawdowns = chartData.map((point) => Number(point.drawdownPct.toFixed(2)));
    const minDrawdown = Math.min(...drawdowns);

    chart.setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        textStyle: { color: theme.tooltipText, fontSize: 11 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          if (!Array.isArray(params) || !params.length) return "";
          let html = `<b>${params[0].axisValue}</b>`;
          for (const item of params) {
            html += `<br/>${item.marker} ${item.seriesName}: <b>${formatPct(Number(item.value))}</b>`;
          }
          return html;
        },
      },
      toolbox: {
        feature: {
          saveAsImage: { title: "Save" },
          restore: { title: "Reset" },
        },
        right: 8,
        top: 0,
        iconStyle: { borderColor: theme.textColor },
      },
      legend: {
        data: [labels.returnCurve, labels.drawdown],
        textStyle: { color: theme.textColor, fontSize: 11 },
        right: 60,
        top: 4,
      },
      grid: [
        { left: 8, right: 8, top: 36, height: "56%", containLabel: true },
        { left: 8, right: 8, top: "68%", height: "20%", containLabel: true },
      ],
      xAxis: [
        { type: "category", data: dates, gridIndex: 0, axisLine: { lineStyle: { color: theme.axisColor } }, axisLabel: { color: theme.textColor, fontSize: 10 } },
        { type: "category", data: dates, gridIndex: 1, axisLine: { lineStyle: { color: theme.axisColor } }, axisLabel: { show: false } },
      ],
      yAxis: [
        {
          type: "value",
          gridIndex: 0,
          splitLine: { lineStyle: { color: theme.gridColor } },
          axisLabel: { color: theme.textColor, fontSize: 10, formatter: "{value}%" },
        },
        {
          type: "value",
          gridIndex: 1,
          splitLine: { lineStyle: { color: theme.gridColor } },
          axisLabel: { color: theme.textColor, fontSize: 10, formatter: "{value}%" },
        },
      ],
      dataZoom: [{ type: "inside", xAxisIndex: [0, 1] }],
      series: [
        {
          name: labels.returnCurve,
          type: "line",
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: returns,
          smooth: false,
          symbol: "none",
          lineStyle: { color: theme.infoColor, width: 2 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [{ offset: 0, color: theme.infoColor + "35" }, { offset: 1, color: theme.infoColor + "00" }],
            },
          },
        },
        {
          name: labels.drawdown,
          type: "line",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: drawdowns,
          smooth: false,
          symbol: "none",
          lineStyle: { color: theme.downColor, width: 1 },
          areaStyle: { color: theme.downColor + "25" },
          markLine: {
            silent: true,
            symbol: "none",
            data: [{
              yAxis: minDrawdown,
              label: { formatter: `${labels.maxDrawdown}: ${formatPct(minDrawdown)}`, position: "insideEndTop", fontSize: 10, color: theme.downColor },
            }],
            lineStyle: { color: theme.downColor, type: "dashed", width: 1 },
          },
        },
      ],
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [chartData, dark, labels.drawdown, labels.maxDrawdown, labels.returnCurve]);

  if (data.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">{t("chart.noEquityData")}</div>;
  }

  return <div ref={ref} style={{ height }} />;
}
