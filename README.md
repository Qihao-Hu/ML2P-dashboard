# ML2P benchmark dashboard

A static, CSV-backed dashboard for viewing ML2P benchmark results. It is designed
to be served directly by GitHub Pages and has no backend or build step.

## Files

```text
index.html
assets/dashboard.js
assets/style.css
data/results.csv
```

The page uses Bootstrap for layout, Chart.js for charts, and PapaParse to read
the CSV in the browser. It reloads `data/results.csv` every 60 seconds with a
cache-busting query parameter.

## Update the dashboard

1. Open `data/results.csv`.
2. Add one new experiment per row. Keep the header row unchanged.
3. Commit and push the change to `main`:

   ```sh
   git add data/results.csv
   git commit -m "Add benchmark results"
   git push
   ```

GitHub Pages will publish the update automatically. An open dashboard tab checks
for a new CSV every 60 seconds.

## CSV columns

The dashboard recognizes these columns:

```text
timestamp,run_id,model_family,model,dataset,task,device,framework,cpu_model,
num_threads,batch_size,epochs,energy_j,energy_per_sample_j,runtime_s,
avg_power_w,accuracy,notes
```

Only `data/results.csv` is required. Columns may be omitted: the related card,
chart, or filter will show an unavailable/empty state while the remaining data
continues to render. Additional columns are included automatically in the
sortable experiment table.

Use ISO 8601 timestamps such as `2026-07-05T14:30:00Z`. Numeric measurement
columns should contain plain numbers without units; the dashboard adds units for
display.

## Local preview

Browsers do not allow the CSV request from a `file://` page. Start a local static
server from the repository root instead:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

This public repository contains dashboard assets and aggregate result data only.
It does not contain the private ML2P implementation, raw measurements, or secrets.
