const defaultSymbols = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "TSLA"];
const knownStocks = [
  ["AAPL", "Apple Inc."],
  ["MSFT", "Microsoft Corp."],
  ["NVDA", "NVIDIA Corp."],
  ["AMZN", "Amazon.com, Inc."],
  ["GOOGL", "Alphabet Inc."],
  ["TSLA", "Tesla, Inc."],
  ["META", "Meta Platforms, Inc."],
  ["AMD", "Advanced Micro Devices"],
  ["NFLX", "Netflix, Inc."],
  ["AVGO", "Broadcom Inc."],
  ["JPM", "JPMorgan Chase"],
  ["V", "Visa Inc."],
  ["WMT", "Walmart Inc."],
  ["UNH", "UnitedHealth Group"],
];

const state = {
  activeTab: "Markets",
  symbols: JSON.parse(localStorage.getItem("marketLensSymbols") || "null") || defaultSymbols,
  sentiment: "All",
  marketRange: "6mo",
  markets: null,
  portfolio: [],
  histories: {},
  news: [],
  marketNews: [],
  activeSymbol: "",
  newsCategory: "All News",
  theme: localStorage.getItem("marketLensTheme") || "light",
  modal: "",
  searchMessage: "",
  loading: true,
  error: "",
};

const app = document.querySelector("#app");

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
let searchTimer;

function relativeTime(dateValue) {
  if (!dateValue) return "--";
  const diff = Date.now() - new Date(dateValue).getTime();
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours} hr ago`;
  return `Updated ${Math.round(hours / 24)} day ago`;
}

function icon(name) {
  const icons = {
    search: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
    sun: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`,
    bell: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.34 1.88V22a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.6 20a1.7 1.7 0 0 0-1.88-.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.88-.34H2a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.6 4.6 1.7 1.7 0 0 0 9.6 4a1.7 1.7 0 0 0 .34-1.88V2a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 8.6a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.88.34H22a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 20 15Z"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>`,
  };
  return icons[name];
}

function signed(value, suffix = "") {
  if (value == null || Number.isNaN(value)) return "--";
  return `${value >= 0 ? "+" : ""}${fmt.format(value)}${suffix}`;
}

function marketSession() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  const weekday = values.weekday;
  const weekdayOpen = !["Sat", "Sun"].includes(weekday);
  const regularOpen = weekdayOpen && minutes >= 9 * 60 + 30 && minutes < 16 * 60;
  return regularOpen ? "Market Open" : "Market Closed";
}

function linePath(values, width, height, pad = 4) {
  if (!values?.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((value, index) => {
      const x = pad + (index / Math.max(values.length - 1, 1)) * (width - pad * 2);
      const y = height - pad - ((value - min) / span) * (height - pad * 2);
      return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function spark(values, positive = true, className = "sparkline") {
  const color = positive ? "#087d31" : "#cf1f2f";
  const fill = positive ? "#dff5e7" : "#fde2e4";
  const path = linePath(values, 260, 78);
  return `<svg class="${className}" viewBox="0 0 260 78" preserveAspectRatio="none">
    <path d="${path} L256 74 L4 74 Z" fill="${fill}" opacity=".72"></path>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2.2"></path>
  </svg>`;
}

function comparisonChart() {
  const sp = (state.histories["^GSPC"] || []).map((point) => point.close);
  const nd = (state.histories["^IXIC"] || []).map((point) => point.close);
  const normalize = (values) => values.map((value) => ((value - values[0]) / values[0]) * 100);
  const spN = sp.length ? normalize(sp) : [];
  const ndN = nd.length ? normalize(nd) : [];
  const all = [...spN, ...ndN];
  const min = Math.min(-5, ...all);
  const max = Math.max(20, ...all);
  const pathFor = (values, width = 920, height = 248) =>
    values.map((value, index) => {
      const x = 18 + (index / Math.max(values.length - 1, 1)) * (width - 36);
      const y = height - 24 - ((value - min) / (max - min || 1)) * (height - 44);
      return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");

  return `<svg class="chart" viewBox="0 0 920 248" preserveAspectRatio="none">
    ${[0, 5, 10, 15, 20].map((tick) => {
      const y = 224 - ((tick - min) / (max - min || 1)) * 204;
      return `<path d="M18 ${y}H902" stroke="#e1e7f0"/><text x="0" y="${y + 4}" font-size="11" fill="#63718a">${tick}%</text>`;
    }).join("")}
    <path d="M18 224H902" stroke="#11192c" stroke-dasharray="3 4"/>
    <path d="${pathFor(spN)}" fill="none" stroke="#2d8a43" stroke-width="2.4"/>
    <path d="${pathFor(ndN)}" fill="none" stroke="#1976e8" stroke-width="2.4"/>
  </svg>`;
}

function stockPath(values, width = 920, height = 230) {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map((value, index) => {
    const x = 16 + (index / Math.max(values.length - 1, 1)) * (width - 32);
    const y = height - 18 - ((value - min) / span) * (height - 34);
    return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

function stockAnalysisChart(quote) {
  const values = quote?.points || [];
  const positive = (quote?.change || 0) >= 0;
  const color = positive ? "#087d31" : "#cf1f2f";
  const fill = positive ? "#dff5e7" : "#fde2e4";
  const path = stockPath(values);
  return `<svg class="analysis-chart" viewBox="0 0 920 230" preserveAspectRatio="none">
    ${[0, 1, 2, 3].map((tick) => `<path d="M16 ${18 + tick * 62}H904" stroke="#e1e7f0"/>`).join("")}
    <path d="${path} L904 212 L16 212 Z" fill="${fill}" opacity=".75"></path>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2.6"></path>
  </svg>`;
}

function newsForSymbol(symbol) {
  return state.news.filter((item) => item.ticker === symbol);
}

function stockSignal(quote) {
  const values = quote?.points || [];
  const recent = values.slice(-8);
  const prior = values.slice(-24, -8);
  const avg = (items) => items.reduce((sum, value) => sum + value, 0) / Math.max(items.length, 1);
  const recentAvg = avg(recent);
  const priorAvg = avg(prior);
  const momentumPct = priorAvg ? ((recentAvg - priorAvg) / priorAvg) * 100 : 0;
  const intradayPct = quote?.changePercent || 0;
  const high = Math.max(...values, quote?.price || 0);
  const low = Math.min(...values, quote?.price || 0);
  const volatilityPct = quote?.analytics?.volatility ?? (quote?.price ? ((high - low) / quote.price) * 100 : 0);
  const range = quote?.range52Week?.every(Boolean) ? quote.range52Week : null;
  const rangePosition = range ? ((quote.price - range[0]) / (range[1] - range[0] || 1)) * 100 : 50;
  const related = newsForSymbol(quote.symbol);
  const positiveNews = related.filter((item) => item.sentiment === "Positive").length;
  const negativeNews = related.filter((item) => item.sentiment === "Negative").length;
  const newsScore = positiveNews - negativeNews;
  const technicalScore =
    Math.max(-2, Math.min(2, intradayPct / 1.25)) +
    Math.max(-2, Math.min(2, momentumPct / 0.35)) +
    (rangePosition > 92 ? -0.45 : rangePosition < 35 ? 0.45 : 0);
  const total = technicalScore + Math.max(-1.5, Math.min(1.5, newsScore * 0.6));
  let label = "Hold";
  if (total >= 2.1 && newsScore >= 0) label = "Buy";
  else if (total >= 0.75) label = "Strong Hold";
  else if (total <= -1.8) label = "Sell";
  else if (total < -0.45 || volatilityPct > 3.6 || (positiveNews > 0 && negativeNews > 0)) label = "Watch Closely";

  return {
    label,
    total,
    intradayPct,
    momentumPct,
    volatilityPct,
    rangePosition,
    positiveNews,
    negativeNews,
    relatedCount: related.length,
    reasons: [
      `Day move: ${signed(intradayPct, "%")}`,
      `Short momentum: ${signed(momentumPct, "%")}`,
      `News balance: ${positiveNews} positive / ${negativeNews} negative`,
      `Volatility: ${fmt.format(volatilityPct)}%`,
      quote.analytics?.rSquared != null ? `Trend confidence: ${Math.round(quote.analytics.rSquared * 100)}%` : "Trend confidence: N/A",
    ],
  };
}

function metricValue(label, value) {
  if ((label === "Open" || label.includes("Open")) && (value == null || value === "--")) return "N/A";
  return typeof value === "number" ? fmt.format(value) : value || "--";
}

function analysisNotes(quote) {
  if (!quote) return [];
  const positive = (quote.change || 0) >= 0;
  const signal = stockSignal(quote);
  const range = quote.range52Week?.every(Boolean) ? quote.range52Week : null;
  const rangePosition = range ? ((quote.price - range[0]) / (range[1] - range[0] || 1)) * 100 : null;
  return [
    positive
      ? `${quote.symbol} is trading higher on the latest live feed, up ${signed(quote.change)} or ${signed(quote.changePercent, "%")}.`
      : `${quote.symbol} is trading lower on the latest live feed, down ${fmt.format(Math.abs(quote.change || 0))} or ${fmt.format(Math.abs(quote.changePercent || 0))}%.`,
    rangePosition == null
      ? "52-week range context is not available from the quote feed right now."
      : `The current price sits near ${Math.round(rangePosition)}% of its 52-week range.`,
    quote.analytics?.zScore == null
      ? "Statistical deviation is not available yet for this ticker."
      : `Statistical deviation is ${quote.analytics.zScore.toFixed(2)} standard deviations from its recent mean.`,
    positive
      ? "Short-term momentum is constructive; watch whether follow-through holds above the previous close."
      : "Short-term momentum is under pressure; watch whether buyers defend the day low and previous close.",
    `Current signal: ${signal.label}, based on technical momentum, volatility, 52-week position, and matched live headlines.`,
  ];
}

function stockAnalysisPanel() {
  const quote = state.portfolio.find((item) => item.symbol === state.activeSymbol);
  if (!quote) return "";
  const positive = (quote.change || 0) >= 0;
  const relatedNews = newsForSymbol(quote.symbol).slice(0, 4);
  const range = quote.range52Week?.every(Boolean) ? quote.range52Week : [quote.price * 0.75, quote.price * 1.15];
  const pos = Math.max(0, Math.min(100, ((quote.price - range[0]) / (range[1] - range[0] || 1)) * 100));
  const signal = stockSignal(quote);

  return `<section class="panel analysis-panel" id="stockAnalysis">
    <div class="analysis-head">
      <div>
        <div class="breadcrumb"><button class="back-button" id="closeAnalysis">Dashboard</button><span>/</span><span>${quote.symbol} Analysis</span></div>
        <h2>${quote.symbol} Analysis</h2>
        <div class="muted">${quote.displayName} ${quote.exchangeName ? `| ${quote.exchangeName}` : ""} ${quote.isStale ? "| Showing last close data" : ""}</div>
      </div>
      <div class="analysis-price">
        <div>${quote.price ? fmt.format(quote.price) : "--"}</div>
        <span class="${positive ? "positive" : "negative"}">${signed(quote.change)} (${signed(quote.changePercent, "%")})</span>
        <strong class="signal-badge ${signal.label.replaceAll(" ", "-").toLowerCase()}">${signal.label}</strong>
      </div>
    </div>
    <div class="analysis-grid">
      <div class="analysis-main">
        ${stockAnalysisChart(quote)}
        <div class="analysis-metrics">
          ${[
            ["Open", quote.open],
            ["Day High", quote.dayHigh],
            ["Day Low", quote.dayLow],
            ["Previous Close", quote.previousClose],
            ["52W Low", range[0]],
            ["52W High", range[1]],
          ].map(([label, value]) => `<div><span>${label}</span><strong>${metricValue(label, value)}</strong></div>`).join("")}
        </div>
      </div>
      <aside class="analysis-side">
        <div class="range-card">
          <div class="panel-title">52-Week Position</div>
          <div class="range-big"><span>${Math.round(pos)}%</span><small>of yearly range</small></div>
          <div class="range-track"><span style="width:${pos}%"></span></div>
          <div class="range-labels"><span>${fmt.format(range[0])}</span><span>${fmt.format(range[1])}</span></div>
        </div>
        <div class="signal-card">
          <div class="panel-title">Signal Inputs</div>
          <div class="signal-reasons">${signal.reasons.map((reason) => `<p>${reason}</p>`).join("")}</div>
        </div>
        <div class="notes-card">
          <div class="panel-title">Readout</div>
          ${analysisNotes(quote).map((note) => `<p>${note}</p>`).join("")}
        </div>
      </aside>
    </div>
    <div class="analysis-news">
      <div class="panel-head"><h3 class="panel-title">${quote.symbol} Related Headlines</h3><button class="small-button selected" data-tab="News">Open News Tab</button></div>
      ${relatedNews.length ? relatedNews.map((item) => `<article class="compact-news">
        <a href="${item.link}" target="_blank" rel="noreferrer">${item.title}</a>
        <span>${item.source} | ${item.sentiment}</span>
      </article>`).join("") : `<div class="empty">No recent portfolio headlines matched ${quote.symbol} yet.</div>`}
    </div>
  </section>`;
}

function header() {
  return `<header class="topbar">
    <div class="brand">Market Lens</div>
    <form class="symbol-form" id="symbolForm">
      <input id="symbolInput" list="symbolSuggestions" placeholder="Type any ticker or company (e.g., IBM, JPM, BABA)" aria-label="Search or add portfolio symbol" autocomplete="off" />
      <datalist id="symbolSuggestions">${knownStocks.map(([symbol, name]) => `<option value="${symbol}">${name}</option>`).join("")}</datalist>
      <button title="Add symbol" aria-label="Add symbol">${icon("search")}</button>
    </form>
    <nav class="tabs" aria-label="Primary">
      ${["Markets", "Portfolio", "News"].map((tab) => `<button class="tab ${state.activeTab === tab ? "active" : ""}" data-tab="${tab}">${tab}</button>`).join("")}
    </nav>
    <div class="top-actions">
      <button class="icon-button ${state.theme === "dark" ? "selected-icon" : ""}" title="Toggle light/dark theme" aria-label="Theme" data-action="theme">${icon("sun")}</button>
      <button class="icon-button" title="View portfolio alerts" aria-label="Alerts" data-action="alerts">${icon("bell")}</button>
      <button class="icon-button" title="Open settings" aria-label="Settings" data-action="settings">${icon("settings")}</button>
    </div>
  </header>`;
}

function marketStrip() {
  const m = state.markets || {};
  const quotes = [
    ["S&P 500", m.sp500],
    ["Nasdaq", m.nasdaq],
    ["DJIA", m.dow],
    ["VIX", m.vix],
  ];
  const session = marketSession();
  return `<div class="market-strip">
    <div class="market-open"><span class="dot ${session === "Market Closed" ? "off" : ""}"></span><strong>${session}</strong></div>
    ${quotes.map(([name, q]) => `<div class="strip-quote" title="${q?.isStale ? "Market is closed or intraday feed is unavailable; showing last close data." : "Live intraday feed"}"><span class="strip-name">${name}</span><span>${q?.price ? fmt.format(q.price) : "--"}</span><span class="${(q?.change || 0) >= 0 ? "positive" : "negative"}">${signed(q?.change)} (${signed(q?.changePercent, "%")})</span></div>`).join("")}
  </div>`;
}

function indexCard(title, symbol, quote, color) {
  const positive = (quote?.change || 0) >= 0;
  return `<section class="panel index-card">
    <div class="index-head">
      <h2 class="index-title">${title} <span class="muted">${symbol}</span></h2>
      <span class="live ${quote?.isStale ? "stale" : ""}"><span class="dot ${quote?.isStale ? "off" : ""}"></span>${quote?.isStale ? "LAST CLOSE" : "LIVE FEED"}</span>
    </div>
    <div class="big-price">${quote?.price ? fmt.format(quote.price) : "--"}</div>
    <div class="${positive ? "positive" : "negative"}">${signed(quote?.change)} (${signed(quote?.changePercent, "%")})</div>
    ${spark(quote?.points || [], positive)}
    <div class="metric-grid">
      ${[
        ["Open", quote?.open],
        ["High", quote?.dayHigh],
        ["Low", quote?.dayLow],
        ["Prev Close", quote?.previousClose],
        ["52W Range", quote?.range52Week?.every(Boolean) ? `${fmt.format(quote.range52Week[0])} - ${fmt.format(quote.range52Week[1])}` : "--"],
      ].map(([label, value]) => `<div><div class="metric-label">${label}</div><div class="metric-value">${metricValue(label, value)}</div></div>`).join("")}
    </div>
  </section>`;
}

function marketPerformance() {
  const ranges = [["1d", "1D"], ["5d", "5D"], ["1mo", "1M"], ["3mo", "3M"], ["6mo", "YTD"], ["1y", "1Y"], ["3y", "3Y"], ["5y", "5Y"]];
  return `<section class="panel chart-panel">
    <div class="panel-head">
      <h2 class="panel-title">Market Performance</h2>
      <div class="range-tabs">${ranges.map(([value, label]) => `<button class="${state.marketRange === value ? "selected" : ""}" data-range="${value}">${label}</button>`).join("")}</div>
    </div>
    <div class="legend-row">
      <span class="legend"><span class="legend-dot" style="background:#2d8a43"></span>S&P 500 (.SPX)</span>
      <span class="legend"><span class="legend-dot" style="background:#1976e8"></span>Nasdaq (.IXIC)</span>
    </div>
    ${comparisonChart()}
    <div class="status-line" title="Latest chart refresh time">${relativeTime(new Date())} | ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
  </section>`;
}

function sectors() {
  const data = [
    ["Technology", 1.32], ["Comm. Services", 1.12], ["Consumer Cyc.", 0.74], ["Financials", 0.55], ["Industrials", 0.28],
    ["Real Estate", 0.12], ["Consumer Staples", -0.10], ["Utilities", -0.21], ["Health Care", -0.32], ["Energy", -0.88],
  ];
  return `<section class="panel sectors">
    <div class="panel-head"><h2 class="panel-title">S&P 500 Sectors</h2><span class="muted" style="font-size:12px">Performance is day change %</span></div>
    <div class="sector-row">${data.map(([name, value]) => `<div class="sector ${value < 0 ? "bad" : ""}">${name}<br><span class="${value < 0 ? "negative" : "positive"}">${value < 0 ? "↓" : "↑"} ${signed(value, "%")}</span></div>`).join("")}</div>
  </section>`;
}

function watchlist() {
  return `<section class="panel watchlist">
    <div class="watch-head"><div><h2 class="panel-title">My Watchlist</h2><div class="scroll-hint">Swipe or scroll sideways to see all columns</div></div><button class="small-button" id="refreshBtn">Refresh</button></div>
    <div class="table-scroll" tabindex="0" aria-label="Scrollable watchlist table">
    <table>
      <thead><tr><th>Symbol</th><th>Signal</th><th>Company</th><th>Price</th><th>Change</th><th>% Change</th><th>Day Chart</th><th>Updated</th><th>Remove</th></tr></thead>
      <tbody>
        ${state.portfolio.map((q) => {
          const positive = (q.change || 0) >= 0;
          const signal = stockSignal(q);
          return `<tr class="stock-row" data-symbol="${q.symbol}" tabindex="0" aria-label="Open ${q.symbol} analysis">
            <td><button class="ticker ticker-button" data-symbol="${q.symbol}">${q.symbol}</button></td>
            <td><span class="signal-badge compact ${signal.label.replaceAll(" ", "-").toLowerCase()}">${signal.label}</span></td>
            <td>${q.displayName}</td>
            <td>${q.price ? fmt.format(q.price) : "--"}</td>
            <td class="${positive ? "positive" : "negative"}">${signed(q.change)}</td>
            <td class="${positive ? "positive" : "negative"}">${signed(q.changePercent, "%")}</td>
            <td>${spark(q.points || [], positive, "mini-chart")}</td>
            <td>${q.marketTime ? new Date(q.marketTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "--"}</td>
            <td><button class="remove-row" data-remove="${q.symbol}" title="Remove ${q.symbol} from watchlist" aria-label="Remove ${q.symbol}">×</button></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    </div>
  </section>`;
}

function newsRows(limit = 8) {
  let source = state.news;
  if (state.newsCategory === "Market News") source = state.marketNews;
  if (state.newsCategory === "Portfolio News" || state.newsCategory === "Watchlist News") {
    source = state.news.filter((item) => state.symbols.includes(item.ticker));
  }
  const filtered = source.filter((item) => state.sentiment === "All" || item.sentiment === state.sentiment).slice(0, limit);
  if (!filtered.length) return `<div class="empty">No matching headlines yet.</div>`;
  return filtered.map((item) => `<article class="news-row">
    <div class="time">${item.publishedAt ? new Date(item.publishedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "--"}</div>
    <div>
      <a class="news-title" href="${item.link}" target="_blank" rel="noreferrer">${item.title}</a>
      <div class="news-meta">${item.source} &nbsp; | &nbsp; <button class="ticker ticker-button inline" data-symbol="${item.ticker}">${item.ticker}</button></div>
    </div>
    <span class="sentiment ${item.sentiment}">${item.sentiment}</span>
  </article>`).join("");
}

function newsPanel() {
  const categories = ["All News", "Portfolio News", "Market News", "Watchlist News"];
  return `<aside class="side-rail">
    <section class="panel news-panel">
      <div class="news-head">
        <div class="panel-head" style="margin:0"><h2 class="panel-title">Top News</h2><button class="icon-button" title="Open news settings" aria-label="News settings" data-action="news-settings">${icon("settings")}</button></div>
        <div class="news-tabs">${categories.map((category) => `<button class="${state.newsCategory === category ? "active" : ""}" data-news-category="${category}">${category}</button>`).join("")}</div>
      </div>
      <div class="news-list">${newsRows(8)}</div>
      <div style="padding:14px 16px"><button class="small-button selected" data-tab="News">View more news</button></div>
    </section>
    <section class="panel filters">
      <div class="panel-head"><h2 class="panel-title">Portfolio News Filters</h2><button class="small-button" id="clearFilters">Clear</button></div>
      <div class="muted" style="font-size:13px">My Portfolio Symbols (${state.symbols.length})</div>
      <div class="filter-bar">${["All", "Positive", "Neutral", "Negative"].map((filter) => `<button class="${state.sentiment === filter ? "selected" : ""}" data-sentiment="${filter}">${filter === "All" ? "All Sentiment" : filter}</button>`).join("")}</div>
    </section>
  </aside>`;
}

function marketsView() {
  const m = state.markets || {};
  return `<main class="main-grid">
    <div class="content-stack">
      ${stockAnalysisPanel()}
      <div class="index-grid">
        ${indexCard("S&P 500", ".SPX", m.sp500, "green")}
        ${indexCard("Nasdaq Composite", ".IXIC", m.nasdaq, "blue")}
      </div>
      ${marketPerformance()}
      ${sectors()}
      ${watchlist()}
    </div>
    ${newsPanel()}
  </main>`;
}

function oldNewsView() {
  return `<main class="main-grid">
    <div class="news-page">
      <section class="panel portfolio-editor">
        <h2 class="panel-title">Portfolio Symbols</h2>
        <div class="symbol-chip-list">${state.symbols.map((symbol) => `<span class="chip">${symbol}<button data-remove="${symbol}" title="Remove ${symbol}">×</button></span>`).join("")}</div>
        <div class="filter-bar">${["All", "Positive", "Neutral", "Negative"].map((filter) => `<button class="${state.sentiment === filter ? "selected" : ""}" data-sentiment="${filter}">${filter}</button>`).join("")}</div>
      </section>
      <section class="panel news-panel">
        <div class="news-head"><h2 class="panel-title">Portfolio News</h2><div class="status-line">Headlines matched to ${state.symbols.join(", ")}</div></div>
        ${stockAnalysisPanel()}
        ${newsRows(18)}
      </section>
    </div>
  </main>`;
}

function newsView() {
  const categories = ["All News", "Portfolio News", "Market News", "Watchlist News"];
  return `<main class="main-grid">
    <div class="news-page">
      <section class="panel portfolio-editor">
        <h2 class="panel-title">Portfolio Symbols</h2>
        <div class="symbol-chip-list">${state.symbols.map((symbol) => `<span class="chip"><button class="ticker-button inline" data-symbol="${symbol}">${symbol}</button><button data-remove="${symbol}" title="Remove ${symbol}" aria-label="Remove ${symbol}">&times;</button></span>`).join("")}</div>
        <div class="portfolio-help">Use the search bar above to add any valid exchange ticker, then remove it here or in the watchlist.</div>
        <div class="filter-bar">${categories.map((category) => `<button class="${state.newsCategory === category ? "selected" : ""}" data-news-category="${category}">${category}</button>`).join("")}</div>
        <div class="filter-bar">${["All", "Positive", "Neutral", "Negative"].map((filter) => `<button class="${state.sentiment === filter ? "selected" : ""}" data-sentiment="${filter}">${filter}</button>`).join("")}</div>
      </section>
      <section class="panel news-panel">
        <div class="news-head"><h2 class="panel-title">${state.newsCategory}</h2><div class="status-line">Portfolio: ${state.symbols.join(", ")}</div></div>
        ${stockAnalysisPanel()}
        <div class="news-list full">${newsRows(18)}</div>
      </section>
    </div>
  </main>`;
}

function portfolioView() {
  return `<main class="main-grid"><div class="content-stack">${stockAnalysisPanel()}${watchlist()}${marketPerformance()}</div>${newsPanel()}</main>`;
}

function modalPanel() {
  if (!state.modal) return "";
  const content = {
    alerts: {
      title: "Alerts",
      body: `<p>Price and news alerts are active for ${state.symbols.join(", ")}.</p><p>The strongest current watch signal is ${state.portfolio.map((quote) => `${quote.symbol}: ${stockSignal(quote).label}`).slice(0, 4).join(" | ") || "loading"}.</p>`,
    },
    settings: {
      title: "Settings",
      body: `<p>Theme: ${state.theme === "dark" ? "Dark" : "Light"}</p><p>Portfolio symbols are saved locally in this browser.</p><p>Signals combine technical movement, 52-week position, volatility, and live headline sentiment. This is decision support, not financial advice.</p>`,
    },
    "news-settings": {
      title: "News Settings",
      body: `<p>Current feed: ${state.newsCategory}</p><p>Sentiment filter: ${state.sentiment}</p><p>Portfolio news is matched to ${state.symbols.join(", ")} and market news is pulled from broad S&P 500/Nasdaq market headlines.</p>`,
    },
  }[state.modal];
  return `<div class="modal-backdrop" role="presentation">
    <section class="modal" role="dialog" aria-modal="true" aria-label="${content.title}">
      <div class="panel-head"><h2 class="panel-title">${content.title}</h2><button class="icon-button" id="closeModal" title="Close" aria-label="Close">&times;</button></div>
      <div class="modal-body">${content.body}</div>
    </section>
  </div>`;
}

function render() {
  document.body.dataset.theme = state.theme;
  app.innerHTML = `<div class="app-shell">${header()}${state.searchMessage ? `<div class="toast">${state.searchMessage}</div>` : ""}${marketStrip()}${state.error ? `<div class="empty">${state.error}</div>` : ""}${state.loading ? `<div class="empty">Loading live market data...</div>` : state.activeTab === "News" ? newsView() : state.activeTab === "Portfolio" ? portfolioView() : marketsView()}${modalPanel()}</div>`;
  bindEvents();
}

async function loadData() {
  state.loading = true;
  render();
  try {
    const symbols = state.symbols.join(",");
    const [markets, portfolio, spHistory, ndHistory, news, marketNews] = await Promise.all([
      fetch("/api/markets").then((r) => r.json()),
      fetch(`/api/portfolio?symbols=${encodeURIComponent(symbols)}`).then((r) => r.json()),
      fetch(`/api/history?symbol=${encodeURIComponent("^GSPC")}&range=${state.marketRange}`).then((r) => r.json()),
      fetch(`/api/history?symbol=${encodeURIComponent("^IXIC")}&range=${state.marketRange}`).then((r) => r.json()),
      fetch(`/api/news?symbols=${encodeURIComponent(symbols)}`).then((r) => r.json()),
      fetch("/api/news?type=market").then((r) => r.json()),
    ]);
    if (markets.error || portfolio.error || news.error || marketNews.error) throw new Error(markets.error || portfolio.error || news.error || marketNews.error);
    state.markets = markets;
    state.portfolio = portfolio.quotes || [];
    if (state.activeSymbol && !state.portfolio.some((quote) => quote.symbol === state.activeSymbol)) {
      state.searchMessage = `${state.activeSymbol} could not be loaded. Check the ticker symbol and try again.`;
      state.activeSymbol = "";
    }
    state.histories = { "^GSPC": spHistory, "^IXIC": ndHistory };
    state.news = news.news || [];
    state.marketNews = marketNews.news || [];
    state.error = "";
  } catch (error) {
    state.error = `${error.message} The dashboard will retry when you refresh.`;
  } finally {
    state.loading = false;
    render();
  }
}

function saveSymbols() {
  localStorage.setItem("marketLensSymbols", JSON.stringify(state.symbols));
}

async function updateSearchSuggestions(query) {
  const list = document.querySelector("#symbolSuggestions");
  if (!list || query.trim().length < 2) return;
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
    const data = await response.json();
    const results = data.results || [];
    const merged = [
      ...results.map((item) => [item.symbol, `${item.name}${item.exchange ? ` | ${item.exchange}` : ""}`]),
      ...knownStocks,
    ];
    const seen = new Set();
    list.innerHTML = merged
      .filter(([symbol]) => {
        if (!symbol || seen.has(symbol)) return false;
        seen.add(symbol);
        return true;
      })
      .slice(0, 12)
      .map(([symbol, name]) => `<option value="${symbol}">${name}</option>`)
      .join("");
  } catch {
    list.innerHTML = knownStocks.map(([symbol, name]) => `<option value="${symbol}">${name}</option>`).join("");
  }
}

function removeSymbol(symbol) {
  state.symbols = state.symbols.filter((item) => item !== symbol);
  if (state.activeSymbol === symbol) state.activeSymbol = "";
  state.searchMessage = `${symbol} removed from portfolio.`;
  saveSymbols();
  loadData();
}

function openStockAnalysis(symbol) {
  const normalized = symbol?.toUpperCase();
  if (!normalized || !state.portfolio.some((quote) => quote.symbol === normalized)) return;
  state.activeSymbol = normalized;
  render();
  document.querySelector("#stockAnalysis")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      render();
    });
  });
  document.querySelectorAll("[data-sentiment]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sentiment = button.dataset.sentiment;
      render();
    });
  });
  document.querySelectorAll("[data-news-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.newsCategory = button.dataset.newsCategory;
      render();
    });
  });
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "theme") {
        state.theme = state.theme === "dark" ? "light" : "dark";
        localStorage.setItem("marketLensTheme", state.theme);
      } else {
        state.modal = action;
      }
      render();
    });
  });
  document.querySelectorAll("[data-range]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.marketRange = button.dataset.range;
      state.histories["^GSPC"] = await fetch(`/api/history?symbol=${encodeURIComponent("^GSPC")}&range=${state.marketRange}`).then((r) => r.json());
      state.histories["^IXIC"] = await fetch(`/api/history?symbol=${encodeURIComponent("^IXIC")}&range=${state.marketRange}`).then((r) => r.json());
      render();
    });
  });
  document.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      removeSymbol(button.dataset.remove);
    });
  });
  document.querySelectorAll("[data-symbol]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      openStockAnalysis(element.dataset.symbol);
    });
  });
  document.querySelectorAll(".stock-row").forEach((row) => {
    row.addEventListener("click", () => openStockAnalysis(row.dataset.symbol));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openStockAnalysis(row.dataset.symbol);
      }
    });
  });
  document.querySelector("#closeAnalysis")?.addEventListener("click", () => {
    state.activeSymbol = "";
    render();
  });
  document.querySelector("#closeModal")?.addEventListener("click", () => {
    state.modal = "";
    render();
  });
  document.querySelector(".modal-backdrop")?.addEventListener("click", (event) => {
    if (event.target.classList.contains("modal-backdrop")) {
      state.modal = "";
      render();
    }
  });
  document.querySelector("#symbolForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#symbolInput");
    const symbol = input.value.trim().toUpperCase().replace(/[^A-Z.]/g, "");
    if (symbol && !state.symbols.includes(symbol)) {
      state.symbols = [symbol, ...state.symbols].slice(0, 12);
      state.activeSymbol = symbol;
      state.searchMessage = `Adding ${symbol} to portfolio...`;
      saveSymbols();
      input.value = "";
      loadData();
    } else if (symbol) {
      state.activeSymbol = symbol;
      state.searchMessage = `${symbol} is already in your portfolio.`;
      input.value = "";
      render();
    }
  });
  document.querySelector("#symbolInput")?.addEventListener("input", (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => updateSearchSuggestions(event.target.value), 250);
  });
  document.querySelector("#refreshBtn")?.addEventListener("click", loadData);
  document.querySelector("#clearFilters")?.addEventListener("click", () => {
    state.sentiment = "All";
    render();
  });
}

render();
loadData();
