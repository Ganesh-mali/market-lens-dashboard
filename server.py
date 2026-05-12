from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

import numpy as np
import pandas as pd
import requests
import statsmodels.api as sm
import yfinance as yf
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from scipy import stats


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"

app = FastAPI(title="Market Lens")

PORTFOLIO_NAMES = {
    "AAPL": "Apple Inc.",
    "MSFT": "Microsoft Corp.",
    "NVDA": "NVIDIA Corp.",
    "AMZN": "Amazon.com, Inc.",
    "GOOGL": "Alphabet Inc.",
    "TSLA": "Tesla, Inc.",
    "META": "Meta Platforms, Inc.",
}


def safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def yahoo_symbol(symbol: str) -> str:
    return symbol.upper().replace(".SPX", "^GSPC").replace(".IXIC", "^IXIC")


def history_frame(symbol: str, period: str = "1d", interval: str = "5m") -> pd.DataFrame:
    frame = yf.download(
        yahoo_symbol(symbol),
        period=period,
        interval=interval,
        progress=False,
        auto_adjust=False,
        threads=False,
    )
    if isinstance(frame.columns, pd.MultiIndex):
        frame.columns = frame.columns.get_level_values(0)
    return frame.dropna(how="all")


def close_values(frame: pd.DataFrame) -> list[float]:
    closes = [safe_float(value) for value in frame.get("Close", pd.Series(dtype=float)).tolist()]
    return [value for value in closes if value is not None]


def frame_timestamps(frame: pd.DataFrame) -> list[int]:
    return [
        int(ts.to_pydatetime().replace(tzinfo=timezone.utc).timestamp())
        for ts in frame.index
        if hasattr(ts, "to_pydatetime")
    ]


def analytics_for(closes: list[float], price: float | None) -> dict[str, float | None]:
    series = pd.Series(closes, dtype="float64").dropna()
    if len(series) < 3:
        return {
            "meanReturn": None,
            "volatility": None,
            "zScore": None,
            "trendSlope": None,
            "rSquared": None,
        }

    returns = series.pct_change().dropna()
    x = np.arange(len(series), dtype=float)
    slope, _, r_value, _, _ = stats.linregress(x, series.to_numpy())
    model = sm.OLS(series.to_numpy(), sm.add_constant(x)).fit()
    z_score = None
    if price is not None and series.std():
        z_score = (price - series.mean()) / series.std()

    return {
        "meanReturn": safe_float(returns.mean() * 100),
        "volatility": safe_float(returns.std() * 100),
        "zScore": safe_float(z_score),
        "trendSlope": safe_float(slope),
        "rSquared": safe_float(max(r_value * r_value, model.rsquared)),
    }


def normalize_quote(symbol: str) -> dict[str, Any]:
    clean_symbol = symbol.upper()
    ticker = yf.Ticker(yahoo_symbol(clean_symbol))
    try:
        info = ticker.fast_info or {}
    except Exception:
        info = {}

    intraday = history_frame(clean_symbol, "1d", "5m")
    daily = history_frame(clean_symbol, "6mo", "1d")
    intraday_closes = close_values(intraday)
    daily_closes = close_values(daily)
    closes = intraday_closes or daily_closes[-72:]
    timestamps = (frame_timestamps(intraday) if intraday_closes else frame_timestamps(daily))[-72:]

    price = safe_float(info.get("last_price")) or (closes[-1] if closes else None)
    previous = safe_float(info.get("previous_close"))
    if previous is None and len(daily_closes) >= 2:
        previous = daily_closes[-2]
    if previous is None and closes:
        previous = closes[0]
    change = price - previous if price is not None and previous is not None else None
    change_percent = (change / previous) * 100 if change is not None and previous else None

    display_name = PORTFOLIO_NAMES.get(clean_symbol, clean_symbol)
    exchange = ""
    try:
        metadata = ticker.get_info()
        display_name = metadata.get("longName") or metadata.get("shortName") or display_name
        exchange = metadata.get("exchange") or metadata.get("fullExchangeName") or ""
    except Exception:
        pass

    return {
        "symbol": clean_symbol,
        "displayName": display_name,
        "exchangeName": exchange,
        "price": price,
        "previousClose": previous,
        "change": safe_float(change),
        "changePercent": safe_float(change_percent),
        "open": safe_float(info.get("open")),
        "dayHigh": safe_float(info.get("day_high")),
        "dayLow": safe_float(info.get("day_low")),
        "range52Week": [safe_float(info.get("year_low")), safe_float(info.get("year_high"))],
        "marketTime": datetime.now(timezone.utc).isoformat(),
        "isStale": not bool(intraday_closes),
        "dataMode": "intraday" if intraday_closes else "last close",
        "points": closes[-72:],
        "timestamps": timestamps,
        "analytics": analytics_for((daily_closes or closes)[-72:], price),
    }


def history_points(symbol: str, range_name: str) -> list[dict[str, Any]]:
    period = {
        "1d": "1d",
        "5d": "5d",
        "1mo": "1mo",
        "3mo": "3mo",
        "6mo": "ytd",
        "1y": "1y",
        "3y": "3y",
        "5y": "5y",
    }.get(range_name, "ytd")
    interval = "5m" if range_name == "1d" else "1d"
    frame = history_frame(symbol, period, interval)
    if frame.empty and range_name == "1d":
        frame = history_frame(symbol, "5d", "1d")
    closes = frame.get("Close", pd.Series(dtype=float))
    points = []
    for ts, close in closes.items():
        value = safe_float(close)
        if value is not None and hasattr(ts, "to_pydatetime"):
            points.append({"time": int(ts.to_pydatetime().replace(tzinfo=timezone.utc).timestamp()), "close": value})
    return points


def classify_sentiment(title: str) -> str:
    lower = title.lower()
    positive = ["beats", "surge", "rally", "gain", "record", "raises", "upgrade", "strong", "growth"]
    negative = ["miss", "falls", "drop", "lawsuit", "recall", "probe", "cut", "warn", "slump", "down"]
    if any(word in lower for word in positive):
        return "Positive"
    if any(word in lower for word in negative):
        return "Negative"
    return "Neutral"


def infer_ticker(title: str, symbols: list[str]) -> str:
    upper = title.upper()
    company_aliases = {
        "AAPL": ["APPLE"],
        "MSFT": ["MICROSOFT"],
        "NVDA": ["NVIDIA"],
        "AMZN": ["AMAZON"],
        "GOOGL": ["ALPHABET", "GOOGLE"],
        "TSLA": ["TESLA"],
        "META": ["META", "FACEBOOK"],
    }
    for symbol in symbols:
        aliases = company_aliases.get(symbol, [PORTFOLIO_NAMES.get(symbol, symbol).split(" ")[0].upper()])
        if symbol in upper or any(alias in upper for alias in aliases):
            return symbol
    return symbols[0] if symbols else "MARKET"


def decode_news_item(item: ElementTree.Element, symbols: list[str]) -> dict[str, str]:
    title = item.findtext("title", default="")
    return {
        "title": title,
        "link": item.findtext("link", default=""),
        "source": item.findtext("source", default="Google News"),
        "publishedAt": item.findtext("pubDate", default=""),
        "ticker": infer_ticker(title, symbols),
        "sentiment": classify_sentiment(title),
    }


def news_for(symbols: list[str]) -> list[dict[str, str]]:
    terms = " OR ".join(f"{symbol} stock" for symbol in symbols) if symbols else "stock market"
    url = f"https://news.google.com/rss/search?q={requests.utils.quote(terms)}&hl=en-US&gl=US&ceid=US:en"
    response = requests.get(url, timeout=10, headers={"user-agent": "MarketLens/1.0"})
    response.raise_for_status()
    root = ElementTree.fromstring(response.content)
    return [decode_news_item(item, symbols) for item in root.findall("./channel/item")[:18]]


@app.get("/api/markets")
def markets() -> dict[str, Any]:
    try:
        return {
            "sp500": normalize_quote("^GSPC"),
            "nasdaq": normalize_quote("^IXIC"),
            "dow": normalize_quote("^DJI"),
            "vix": normalize_quote("^VIX"),
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Live data is temporarily unavailable: {exc}") from exc


@app.get("/api/portfolio")
def portfolio(symbols: str = Query("AAPL,MSFT,NVDA,AMZN,GOOGL,TSLA")) -> dict[str, Any]:
    requested = [symbol.strip().upper() for symbol in symbols.split(",") if symbol.strip()][:12]
    quotes = []
    for symbol in requested:
        try:
            quotes.append(normalize_quote(symbol))
        except Exception:
            continue
    return {"quotes": quotes}


@app.get("/api/history")
def history(symbol: str = Query("^GSPC"), range: str = Query("6mo")) -> list[dict[str, Any]]:
    try:
        return history_points(symbol, range)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"History is temporarily unavailable: {exc}") from exc


@app.get("/api/news")
def news(symbols: str = Query("AAPL,MSFT,NVDA,AMZN,GOOGL,TSLA"), type: str | None = None) -> dict[str, Any]:
    requested = [] if type == "market" else [symbol.strip().upper() for symbol in symbols.split(",") if symbol.strip()][:12]
    try:
        return {"news": news_for(requested)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"News is temporarily unavailable: {exc}") from exc


@app.get("/api/search")
def search(q: str = Query(..., min_length=1)) -> dict[str, Any]:
    response = requests.get(
        "https://query1.finance.yahoo.com/v1/finance/search",
        params={"q": q, "quotesCount": 8, "newsCount": 0},
        timeout=10,
        headers={"user-agent": "MarketLens/1.0"},
    )
    response.raise_for_status()
    results = []
    for quote in response.json().get("quotes", []):
        if quote.get("symbol") and quote.get("quoteType") in {"EQUITY", "ETF", "INDEX"}:
            results.append({
                "symbol": quote.get("symbol"),
                "name": quote.get("shortname") or quote.get("longname") or quote.get("symbol"),
                "exchange": quote.get("exchange"),
            })
    return {"results": results}


app.mount("/assets", StaticFiles(directory=PUBLIC), name="assets")


@app.get("/{path:path}")
def static_app(path: str) -> FileResponse:
    target = (PUBLIC / path).resolve()
    if path and target.is_file() and PUBLIC in target.parents:
        return FileResponse(target)
    return FileResponse(PUBLIC / "index.html")
