# Deploy Market Lens For Free

Use Render Free Web Service for a permanent public URL.

## Steps

1. Create a GitHub repository and push this project.
2. Go to Render: https://render.com
3. Click **New +** -> **Web Service**.
4. Connect your GitHub repository.
5. Use these settings:
   - Runtime: `Python`
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn server:app --host 0.0.0.0 --port $PORT`
   - Instance Type: `Free`
6. Deploy.

Render will give you a permanent URL like:

```text
https://market-lens-dashboard.onrender.com
```

## Free Plan Notes

Render's free web services can spin down after inactivity, so the first visit after a quiet period may take about a minute to load. This app does not require a database, so the free ephemeral filesystem limitation is fine.

Market Lens uses `yfinance` for free delayed quote data and Google News RSS for headlines. For true real-time or tick-level market data, add a paid provider key such as Polygon.io and route the provider calls through `server.py`.
