import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const port = Number(process.env.PORT || 4173);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const indexSymbols = {
  sp500: "%5EGSPC",
  nasdaq: "%5EIXIC",
  dow: "%5EDJI",
  vix: "%5EVIX",
};

const portfolioNames = {
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corp.",
  NVDA: "NVIDIA Corp.",
  AMZN: "Amazon.com, Inc.",
  GOOGL: "Alphabet Inc.",
  TSLA: "Tesla, Inc.",
  META: "Meta Platforms, Inc.",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(body);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "MarketLens/1.0" },
  });
  if (!response.ok) throw new Error(`Upstream ${response.status}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "MarketLens/1.0" },
  });
  if (!response.ok) throw new Error(`Upstream ${response.status}`);
  return response.text();
}

function chartUrl(symbol, range = "1d", interval = "5m") {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`;
}

function normalizeQuote(symbol, result) {
  const meta = result?.chart?.result?.[0]?.meta || {};
  const quote = result?.chart?.result?.[0]?.indicators?.quote?.[0] || {};
  const timestamps = result?.chart?.result?.[0]?.timestamp || [];
  const closes = (quote.close || []).filter((value) => typeof value === "number");
  const price = meta.regularMarketPrice ?? closes.at(-1) ?? null;
  const previous = meta.chartPreviousClose ?? meta.previousClose ?? closes[0] ?? null;
  const change = price != null && previous != null ? price - previous : null;
  const changePercent = change != null && previous ? (change / previous) * 100 : null;

  return {
    symbol,
    displayName: meta.longName || meta.shortName || portfolioNames[symbol] || symbol,
    exchangeName: meta.exchangeName || "",
    price,
    previousClose: previous,
    change,
    changePercent,
    open: meta.regularMarketOpen ?? null,
    dayHigh: meta.regularMarketDayHigh ?? null,
    dayLow: meta.regularMarketDayLow ?? null,
    range52Week: [meta.fiftyTwoWeekLow ?? null, meta.fiftyTwoWeekHigh ?? null],
    marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    points: closes.slice(-72),
    timestamps: timestamps.slice(-72),
  };
}

async function getQuote(symbol) {
  const data = await fetchJson(chartUrl(encodeURIComponent(symbol), "1d", "5m"));
  return normalizeQuote(symbol.replaceAll("%5E", "^"), data);
}

async function getHistory(symbol, range = "6mo") {
  const interval = range === "1d" ? "5m" : "1d";
  const data = await fetchJson(chartUrl(encodeURIComponent(symbol), range, interval));
  const result = data?.chart?.result?.[0] || {};
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  return timestamps
    .map((time, index) => ({ time, close: closes[index] }))
    .filter((point) => typeof point.close === "number");
}

function decodeEntities(text) {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function classifySentiment(title) {
  const lower = title.toLowerCase();
  const positive = ["beats", "surge", "rally", "gain", "record", "raises", "upgrade", "strong", "growth"];
  const negative = ["miss", "falls", "drop", "lawsuit", "recall", "probe", "cut", "warn", "slump", "down"];
  if (positive.some((word) => lower.includes(word))) return "Positive";
  if (negative.some((word) => lower.includes(word))) return "Negative";
  return "Neutral";
}

function inferTicker(title, symbols) {
  const upper = title.toUpperCase();
  const companyAliases = {
    AAPL: ["APPLE"],
    MSFT: ["MICROSOFT"],
    NVDA: ["NVIDIA"],
    AMZN: ["AMAZON"],
    GOOGL: ["ALPHABET", "GOOGLE"],
    TSLA: ["TESLA"],
    META: ["META", "FACEBOOK"],
  };
  return symbols.find((symbol) => {
    const aliases = companyAliases[symbol] || [portfolioNames[symbol]?.split(/[,. ]/)[0]?.toUpperCase()].filter(Boolean);
    return upper.includes(symbol) || aliases.some((alias) => upper.includes(alias));
  }) || symbols[0] || "MARKET";
}

async function getNews(symbols) {
  const terms = symbols.length ? symbols.map((symbol) => `${symbol} stock`).join(" OR ") : "stock market";
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(terms)}&hl=en-US&gl=US&ceid=US:en`;
  const xml = await fetchText(rssUrl);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 18);

  return items.map(([, item]) => {
    const title = decodeEntities(item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/)?.[1] || item.match(/<title>(.*?)<\/title>/)?.[1] || "");
    const link = decodeEntities(item.match(/<link>(.*?)<\/link>/)?.[1] || "");
    const publishedAt = decodeEntities(item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "");
    const source = decodeEntities(item.match(/<source[^>]*>(.*?)<\/source>/)?.[1] || "Google News");
    const ticker = inferTicker(title, symbols);
    return {
      title,
      link,
      source,
      publishedAt,
      ticker,
      sentiment: classifySentiment(title),
    };
  });
}

async function api(req, res, url) {
  try {
    if (url.pathname === "/api/markets") {
      const [sp500, nasdaq, dow, vix] = await Promise.all([
        getQuote("^GSPC"),
        getQuote("^IXIC"),
        getQuote("^DJI"),
        getQuote("^VIX"),
      ]);
      send(res, 200, JSON.stringify({ sp500, nasdaq, dow, vix }));
      return true;
    }

    if (url.pathname === "/api/history") {
      const symbol = url.searchParams.get("symbol") || "^GSPC";
      const range = url.searchParams.get("range") || "6mo";
      send(res, 200, JSON.stringify(await getHistory(symbol, range)));
      return true;
    }

    if (url.pathname === "/api/portfolio") {
      const symbols = (url.searchParams.get("symbols") || "AAPL,MSFT,NVDA,AMZN,GOOGL,TSLA")
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 12);
      const quotes = await Promise.all(symbols.map((symbol) => getQuote(symbol)));
      send(res, 200, JSON.stringify({ quotes }));
      return true;
    }

    if (url.pathname === "/api/news") {
      if (url.searchParams.get("type") === "market") {
        send(res, 200, JSON.stringify({ news: await getNews([]) }));
        return true;
      }
      const symbols = (url.searchParams.get("symbols") || "AAPL,MSFT,NVDA,AMZN,GOOGL,TSLA")
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 12);
      send(res, 200, JSON.stringify({ news: await getNews(symbols) }));
      return true;
    }
  } catch (error) {
    send(res, 502, JSON.stringify({ error: "Live data is temporarily unavailable.", detail: error.message }));
    return true;
  }
  return false;
}

async function staticFile(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(join(publicDir, requested));
  if (!safePath.startsWith(publicDir)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }
  try {
    const body = await readFile(safePath);
    send(res, 200, body, mime[extname(safePath)] || "application/octet-stream");
  } catch {
    const fallback = await readFile(join(publicDir, "index.html"));
    send(res, 200, fallback, mime[".html"]);
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/") && (await api(req, res, url))) return;
  await staticFile(req, res, url);
}).listen(port, "0.0.0.0", () => {
  console.log(`Market Lens running at http://localhost:${port}`);
});
