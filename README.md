# ML2P benchmark dashboard

A static Bootstrap dashboard for viewing public ML2P benchmark results. It is
served directly by GitHub Pages and has no backend or build step.

## Files

```text
index.html
assets/dashboard.js
assets/style.css
dashboard-data.json
```

`dashboard-data.json` is a minimized snapshot containing only aggregate metrics
used by the page. The private ML2P implementation, raw measurements, repository
history, and secrets are not included.

## Updating the data

Replace `dashboard-data.json` with a new public-safe aggregate snapshot, then
commit and push it to `main`:

```sh
git add dashboard-data.json
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
