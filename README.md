# ML2P benchmark dashboard

A static Bootstrap dashboard for viewing public ML2P benchmark results. It is
served directly by GitHub Pages and has no backend or build step.

## Files

```text
index.html
assets/dashboard.js
assets/style.css
dashboard-data.json
data/all_models_summary.csv
data/all_models_summary.json
```

`dashboard-data.json` is a minimized snapshot containing only aggregate metrics
used by the page. The files under `data/` contain the fuller aggregate GPU, CPU,
DRAM, and system measurements for 15 models across baseline, training, and
inference phases. The current sweep used 20 warmup iterations, 200 training
iterations, 200 inference iterations, and a five-second idle baseline on an
NVIDIA RTX A6000.

The private ML2P implementation, raw time-series, repository history, logs, and
secrets are not included.

## Updating the data

Replace `dashboard-data.json` and the aggregate files under `data/` with a new
public-safe snapshot, then commit and push it to `main`:

```sh
git add dashboard-data.json data/
git commit -m "Update dashboard data"
git push
```

GitHub Pages publishes changes from the repository root.

## Local preview

Because the dashboard fetches its JSON file, preview it through a local static
server rather than opening `index.html` with a `file://` URL:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
