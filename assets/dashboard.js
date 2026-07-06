"use strict";

const CSV_PATH = "data/results.csv";
const REFRESH_INTERVAL_MS = 60_000;

const FILTER_FIELDS = ["model", "dataset", "task", "device", "framework"];
const PREFERRED_COLUMNS = [
  "timestamp",
  "run_id",
  "model_family",
  "model",
  "dataset",
  "task",
  "device",
  "framework",
  "cpu_model",
  "num_threads",
  "batch_size",
  "epochs",
  "energy_j",
  "energy_per_sample_j",
  "runtime_s",
  "avg_power_w",
  "accuracy",
  "notes",
];

const NUMERIC_COLUMNS = new Set([
  "num_threads",
  "batch_size",
  "epochs",
  "energy_j",
  "energy_per_sample_j",
  "runtime_s",
  "avg_power_w",
  "accuracy",
]);

const CHART_COLORS = ["#206bc4", "#2fb344", "#f59f00", "#d63939", "#6f42c1", "#0ca678", "#ae3ec9"];

const state = {
  rows: [],
  filteredRows: [],
  columns: [],
  filters: Object.fromEntries(FILTER_FIELDS.map((field) => [field, ""])),
  sort: { column: "timestamp", direction: "desc" },
  charts: {},
  loading: false,
  hasLoaded: false,
};

const elements = {};

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeDashboard);
  } else {
    initializeDashboard();
  }
}

function initializeDashboard() {
  Object.assign(elements, {
    status: document.querySelector("#data-status"),
    statusLabel: document.querySelector("#status-label"),
    lastChecked: document.querySelector("#last-checked"),
    refreshButton: document.querySelector("#refresh-button"),
    clearFilters: document.querySelector("#clear-filters"),
    errorAlert: document.querySelector("#error-alert"),
    errorMessage: document.querySelector("#error-message"),
    totalRuns: document.querySelector("#metric-total-runs"),
    totalDetail: document.querySelector("#metric-total-detail"),
    latest: document.querySelector("#metric-latest"),
    latestDetail: document.querySelector("#metric-latest-detail"),
    averageEnergy: document.querySelector("#metric-energy"),
    averageRuntime: document.querySelector("#metric-runtime"),
    efficiency: document.querySelector("#metric-efficiency"),
    efficiencyDetail: document.querySelector("#metric-efficiency-detail"),
    table: document.querySelector("#experiment-table"),
    tableHead: document.querySelector("#table-head"),
    tableBody: document.querySelector("#table-body"),
    tableCount: document.querySelector("#table-count"),
    tableEmpty: document.querySelector("#table-empty"),
  });

  elements.filterSelects = [...document.querySelectorAll("[data-filter]")];

  elements.refreshButton.addEventListener("click", loadCsvData);
  elements.clearFilters.addEventListener("click", clearAllFilters);
  elements.filterSelects.forEach((select) => {
    select.addEventListener("change", () => {
      state.filters[select.dataset.filter] = select.value;
      applyFiltersAndRender();
    });
  });

  configureChartDefaults();

  if (typeof window.Papa === "undefined") {
    handleLoadError(new Error("PapaParse did not load. Check the CDN connection and refresh the page."));
    return;
  }

  loadCsvData();
  window.setInterval(loadCsvData, REFRESH_INTERVAL_MS);
}

function loadCsvData() {
  if (state.loading || typeof window.Papa === "undefined") return;

  setLoading(true);
  hideError();

  const url = `${CSV_PATH}?t=${Date.now()}`;
  window.Papa.parse(url, {
    download: true,
    header: true,
    dynamicTyping: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeColumnName,
    complete: (results) => {
      try {
        const rows = normalizeRows(results.data);
        const columns = collectColumns(results.meta?.fields, rows);

        if (results.errors?.length) {
          console.warn("CSV parsing completed with warnings:", results.errors);
        }

        state.rows = rows;
        state.columns = orderColumns(columns);
        state.hasLoaded = true;

        ensureValidSortColumn();
        populateFilters();
        applyFiltersAndRender();
        setStatus(rows.length ? "live" : "empty", rows.length ? "Data loaded" : "Empty CSV");
        elements.lastChecked.textContent = formatCheckedTime(new Date());
      } catch (error) {
        handleLoadError(error);
      } finally {
        setLoading(false);
      }
    },
    error: (error) => {
      handleLoadError(error);
      setLoading(false);
    },
  });
}

function normalizeColumnName(value, index) {
  const normalized = String(value ?? "")
    .replace(/^\ufeff/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || `column_${Number(index) + 1}`;
}

function normalizeRows(inputRows) {
  if (!Array.isArray(inputRows)) return [];
  return inputRows.filter((row) => {
    if (!row || typeof row !== "object") return false;
    return Object.entries(row).some(([key, value]) => key !== "__parsed_extra" && hasValue(value));
  });
}

function collectColumns(parsedFields, rows) {
  const columns = new Set(
    (Array.isArray(parsedFields) ? parsedFields : [])
      .map((field, index) => normalizeColumnName(field, index))
      .filter((field) => field !== "__parsed_extra"),
  );

  rows.forEach((row) => {
    Object.keys(row).forEach((field) => {
      if (field !== "__parsed_extra") columns.add(field);
    });
  });

  return [...columns];
}

function orderColumns(columns) {
  const available = new Set(columns);
  return [
    ...PREFERRED_COLUMNS.filter((column) => available.has(column)),
    ...columns.filter((column) => !PREFERRED_COLUMNS.includes(column)).sort(),
  ];
}

function populateFilters() {
  elements.filterSelects.forEach((select) => {
    const field = select.dataset.filter;
    const allLabel = `All ${humanize(field, true)}`;
    const values = [...new Set(state.rows.map((row) => displayString(row[field])).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );
    const previousValue = state.filters[field];

    select.replaceChildren();
    select.add(new Option(allLabel, ""));
    values.forEach((value) => select.add(new Option(value, value)));

    const fieldAvailable = state.columns.includes(field);
    select.disabled = !fieldAvailable || values.length === 0;

    if (values.includes(previousValue)) {
      select.value = previousValue;
    } else {
      state.filters[field] = "";
      select.value = "";
    }
  });
}

function clearAllFilters() {
  FILTER_FIELDS.forEach((field) => {
    state.filters[field] = "";
  });
  elements.filterSelects.forEach((select) => {
    select.value = "";
  });
  applyFiltersAndRender();
}

function applyFiltersAndRender() {
  state.filteredRows = state.rows.filter((row) =>
    FILTER_FIELDS.every((field) => {
      const selected = state.filters[field];
      return !selected || displayString(row[field]) === selected;
    }),
  );

  renderOverview();
  renderCharts();
  renderTable();
}

function renderOverview() {
  const rows = state.filteredRows;
  const energyValues = numericValues(rows, "energy_j");
  const runtimeValues = numericValues(rows, "runtime_s");
  const timestampedRows = rows
    .map((row) => ({ row, date: parseDate(row.timestamp) }))
    .filter((entry) => entry.date)
    .sort((a, b) => b.date - a.date);

  elements.totalRuns.textContent = formatInteger(rows.length);
  elements.totalDetail.textContent =
    rows.length === state.rows.length ? `${formatInteger(state.rows.length)} loaded rows` : `${formatInteger(rows.length)} of ${formatInteger(state.rows.length)} rows`;

  const latest = timestampedRows[0]?.date;
  elements.latest.textContent = latest ? formatDate(latest, { dateStyle: "medium" }) : "—";
  elements.latestDetail.textContent = latest ? formatDate(latest, { timeStyle: "short" }) : "No timestamp data";

  elements.averageEnergy.textContent = energyValues.length ? formatEnergy(average(energyValues)) : "—";
  elements.averageRuntime.textContent = runtimeValues.length ? formatDuration(average(runtimeValues)) : "—";

  const efficiencyRows = rows
    .map((row) => ({ row, value: toNumber(row.energy_per_sample_j) }))
    .filter((entry) => entry.value !== null && entry.value >= 0)
    .sort((a, b) => a.value - b.value);

  if (efficiencyRows.length) {
    const best = efficiencyRows[0];
    elements.efficiency.textContent = formatEnergyPerSample(best.value);
    elements.efficiencyDetail.textContent = `${rowLabel(best.row)}${hasValue(best.row.task) ? ` · ${displayString(best.row.task)}` : ""}`;
    return;
  }

  const lowestEnergyRows = rows
    .map((row) => ({ row, value: toNumber(row.energy_j) }))
    .filter((entry) => entry.value !== null && entry.value >= 0)
    .sort((a, b) => a.value - b.value);

  if (lowestEnergyRows.length) {
    const best = lowestEnergyRows[0];
    elements.efficiency.textContent = formatEnergy(best.value);
    elements.efficiencyDetail.textContent = `Lowest-energy run · ${rowLabel(best.row)}`;
  } else {
    elements.efficiency.textContent = "—";
    elements.efficiencyDetail.textContent = "No efficiency data";
  }
}

function configureChartDefaults() {
  if (typeof window.Chart === "undefined") return;
  window.Chart.defaults.color = "#667085";
  window.Chart.defaults.borderColor = "rgba(152, 162, 179, 0.2)";
  window.Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  window.Chart.defaults.font.size = 11;
}

function renderCharts() {
  if (typeof window.Chart === "undefined") {
    showAllChartMessages("Chart.js did not load. Check the CDN connection.");
    return;
  }

  renderModelChart({
    key: "energyByModel",
    canvasId: "energy-by-model-chart",
    emptyId: "energy-by-model-empty",
    field: "energy_j",
    datasetLabel: "Average energy (J)",
    color: CHART_COLORS[0],
  });

  renderModelChart({
    key: "runtimeByModel",
    canvasId: "runtime-by-model-chart",
    emptyId: "runtime-by-model-empty",
    field: "runtime_s",
    datasetLabel: "Average runtime (s)",
    color: CHART_COLORS[1],
  });

  renderEnergyOverTime();
  renderEnergyRuntimeScatter();
}

function renderModelChart({ key, canvasId, emptyId, field, datasetLabel, color }) {
  const grouped = groupAverageByModel(state.filteredRows, field);
  const labels = grouped.map((entry) => entry.label);
  const values = grouped.map((entry) => entry.value);

  replaceChart(key, canvasId, emptyId, values.length, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: datasetLabel,
          data: values,
          backgroundColor: withAlpha(color, 0.82),
          borderColor: color,
          borderWidth: 1,
          borderRadius: 5,
          maxBarThickness: 46,
        },
      ],
    },
    options: {
      ...commonChartOptions(),
      plugins: {
        ...commonChartOptions().plugins,
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => ` ${datasetLabel}: ${formatNumber(context.raw, 3)}`,
          },
        },
      },
      scales: chartScales(),
    },
  });
}

function renderEnergyOverTime() {
  const points = state.filteredRows
    .map((row) => ({ row, date: parseDate(row.timestamp), energy: toNumber(row.energy_j) }))
    .filter((entry) => entry.date && entry.energy !== null)
    .sort((a, b) => a.date - b.date);

  replaceChart("energyOverTime", "energy-over-time-chart", "energy-over-time-empty", points.length, {
    type: "line",
    data: {
      labels: points.map((entry) => formatDate(entry.date, { dateStyle: "short", timeStyle: "short" })),
      datasets: [
        {
          label: "Energy (J)",
          data: points.map((entry) => entry.energy),
          borderColor: CHART_COLORS[2],
          backgroundColor: withAlpha(CHART_COLORS[2], 0.12),
          pointBackgroundColor: CHART_COLORS[2],
          pointRadius: points.length > 80 ? 1.5 : 3,
          pointHoverRadius: 5,
          borderWidth: 2,
          fill: true,
          tension: 0.25,
        },
      ],
    },
    options: {
      ...commonChartOptions(),
      plugins: {
        ...commonChartOptions().plugins,
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const point = points[items[0]?.dataIndex];
              return point ? `${rowLabel(point.row)} · ${formatDate(point.date)}` : "";
            },
            label: (context) => ` Energy: ${formatEnergy(context.raw)}`,
          },
        },
      },
      scales: chartScales(),
    },
  });
}

function renderEnergyRuntimeScatter() {
  const points = state.filteredRows
    .map((row) => ({
      x: toNumber(row.runtime_s),
      y: toNumber(row.energy_j),
      row,
    }))
    .filter((point) => point.x !== null && point.y !== null);

  replaceChart("energyRuntime", "energy-runtime-chart", "energy-runtime-empty", points.length, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Experiments",
          data: points,
          parsing: false,
          pointBackgroundColor: points.map((point) => modelColor(rowLabel(point.row))),
          pointBorderColor: "#ffffff",
          pointBorderWidth: 1.5,
          pointRadius: 5,
          pointHoverRadius: 7,
        },
      ],
    },
    options: {
      ...commonChartOptions(),
      plugins: {
        ...commonChartOptions().plugins,
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => rowLabel(items[0]?.raw?.row || {}),
            label: (context) => [
              ` Runtime: ${formatDuration(context.raw.x)}`,
              ` Energy: ${formatEnergy(context.raw.y)}`,
            ],
          },
        },
      },
      scales: {
        x: {
          ...chartScales().x,
          title: { display: true, text: "Runtime (seconds)", color: "#667085" },
        },
        y: {
          ...chartScales().y,
          title: { display: true, text: "Energy (joules)", color: "#667085" },
        },
      },
    },
  });
}

function replaceChart(key, canvasId, emptyId, dataLength, configuration) {
  state.charts[key]?.destroy();
  delete state.charts[key];

  const canvas = document.querySelector(`#${canvasId}`);
  const empty = document.querySelector(`#${emptyId}`);
  const hasData = dataLength > 0;

  canvas.classList.toggle("d-none", !hasData);
  empty.classList.toggle("d-none", hasData);

  if (hasData) {
    state.charts[key] = new window.Chart(canvas, configuration);
  }
}

function showAllChartMessages(message) {
  document.querySelectorAll(".chart-empty").forEach((element) => {
    element.textContent = message;
    element.classList.remove("d-none");
  });
  document.querySelectorAll(".chart-container canvas").forEach((canvas) => canvas.classList.add("d-none"));
}

function groupAverageByModel(rows, field) {
  const groups = new Map();

  rows.forEach((row) => {
    const value = toNumber(row[field]);
    if (value === null) return;
    const label = rowLabel(row);
    const values = groups.get(label) || [];
    values.push(value);
    groups.set(label, values);
  });

  return [...groups.entries()]
    .map(([label, values]) => ({ label, value: average(values) }))
    .sort((a, b) => b.value - a.value);
}

function commonChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: "nearest", intersect: false },
    plugins: {
      legend: {
        labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8 },
      },
    },
  };
}

function chartScales() {
  return {
    x: {
      grid: { display: false },
      border: { display: false },
      ticks: { maxRotation: 35, minRotation: 0 },
    },
    y: {
      beginAtZero: true,
      border: { display: false },
      grid: { color: "rgba(152, 162, 179, 0.16)" },
      ticks: {
        callback: (value) => formatCompactNumber(value),
      },
    },
  };
}

function renderTable() {
  renderTableHead();

  const sortedRows = sortRows(state.filteredRows);
  const fragment = document.createDocumentFragment();

  sortedRows.forEach((row) => {
    const tableRow = document.createElement("tr");
    state.columns.forEach((column) => {
      const cell = document.createElement("td");
      const rawValue = row[column];
      cell.textContent = formatCellValue(column, rawValue);
      if (hasValue(rawValue)) cell.title = displayString(rawValue);
      tableRow.append(cell);
    });
    fragment.append(tableRow);
  });

  elements.tableBody.replaceChildren(fragment);
  elements.tableCount.textContent = `${formatInteger(sortedRows.length)} of ${formatInteger(state.rows.length)} rows`;

  const hasRows = sortedRows.length > 0;
  const hasColumns = state.columns.length > 0;
  elements.table.classList.toggle("d-none", !hasColumns);
  elements.tableEmpty.classList.toggle("d-none", hasRows);
}

function renderTableHead() {
  const headerRow = document.createElement("tr");

  state.columns.forEach((column) => {
    const header = document.createElement("th");
    header.scope = "col";

    const isActive = state.sort.column === column;
    header.setAttribute("aria-sort", isActive ? (state.sort.direction === "asc" ? "ascending" : "descending") : "none");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "sort-button";
    button.addEventListener("click", () => changeSort(column));

    const label = document.createElement("span");
    label.textContent = humanize(column);

    const indicator = document.createElement("span");
    indicator.className = "sort-indicator";
    indicator.setAttribute("aria-hidden", "true");
    indicator.textContent = isActive ? (state.sort.direction === "asc" ? "▲" : "▼") : "↕";

    button.append(label, indicator);
    header.append(button);
    headerRow.append(header);
  });

  elements.tableHead.replaceChildren(headerRow);
}

function changeSort(column) {
  if (state.sort.column === column) {
    state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
  } else {
    state.sort.column = column;
    state.sort.direction = column === "timestamp" ? "desc" : "asc";
  }
  renderTable();
}

function ensureValidSortColumn() {
  if (state.columns.includes(state.sort.column)) return;
  state.sort.column = state.columns[0] || "";
  state.sort.direction = "asc";
}

function sortRows(rows) {
  const { column, direction } = state.sort;
  if (!column) return [...rows];

  return [...rows].sort((left, right) => {
    const leftValue = left[column];
    const rightValue = right[column];
    const leftMissing = !hasValue(leftValue);
    const rightMissing = !hasValue(rightValue);

    if (leftMissing && rightMissing) return 0;
    if (leftMissing) return 1;
    if (rightMissing) return -1;

    let comparison;
    if (column === "timestamp") {
      comparison = (parseDate(leftValue)?.getTime() || 0) - (parseDate(rightValue)?.getTime() || 0);
    } else {
      const leftNumber = toNumber(leftValue);
      const rightNumber = toNumber(rightValue);
      comparison =
        leftNumber !== null && rightNumber !== null
          ? leftNumber - rightNumber
          : displayString(leftValue).localeCompare(displayString(rightValue), undefined, {
              numeric: true,
              sensitivity: "base",
            });
    }

    return direction === "asc" ? comparison : -comparison;
  });
}

function formatCellValue(column, value) {
  if (!hasValue(value)) return "—";
  if (column === "timestamp") {
    const date = parseDate(value);
    return date ? formatDate(date) : displayString(value);
  }

  const number = toNumber(value);
  if (number === null) return displayString(value);

  if (column === "energy_j") return `${formatNumber(number, 3)} J`;
  if (column === "energy_per_sample_j") return formatEnergyPerSample(number);
  if (column === "runtime_s") return `${formatNumber(number, 3)} s`;
  if (column === "avg_power_w") return `${formatNumber(number, 2)} W`;
  if (column === "accuracy") return number <= 1 ? `${formatNumber(number * 100, 2)}%` : `${formatNumber(number, 2)}%`;
  if (NUMERIC_COLUMNS.has(column) || typeof value === "number") return formatNumber(number, 4);
  return displayString(value);
}

function setLoading(loading) {
  state.loading = loading;
  elements.refreshButton.disabled = loading;
  elements.refreshButton.classList.toggle("is-loading", loading);
  if (loading) setStatus("loading", state.hasLoaded ? "Refreshing" : "Loading");
}

function setStatus(type, text) {
  elements.status.classList.remove("is-live", "is-error", "is-loading");
  if (type === "live") elements.status.classList.add("is-live");
  if (type === "error") elements.status.classList.add("is-error");
  if (type === "loading") elements.status.classList.add("is-loading");

  elements.statusLabel.textContent = text;
}

function handleLoadError(error) {
  const message = error instanceof Error ? error.message : "An unexpected error occurred while loading the CSV file.";
  elements.errorMessage.textContent = ` ${message}`;
  elements.errorAlert.classList.remove("d-none");
  elements.lastChecked.textContent = formatCheckedTime(new Date());
  setStatus("error", state.hasLoaded ? "Refresh failed" : "Load failed");

  if (!state.hasLoaded) {
    state.rows = [];
    state.filteredRows = [];
    state.columns = [];
    applyFiltersAndRender();
  }
}

function hideError() {
  elements.errorAlert.classList.add("d-none");
  elements.errorMessage.textContent = "";
}

function numericValues(rows, field) {
  return rows.map((row) => toNumber(row[field])).filter((value) => value !== null);
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function displayString(value) {
  return hasValue(value) ? String(value).trim() : "";
}

function parseDate(value) {
  if (!hasValue(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function rowLabel(row) {
  return displayString(row.model) || displayString(row.model_family) || displayString(row.run_id) || "Unnamed run";
}

function humanize(value, plural = false) {
  const label = String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  return plural && !label.endsWith("s") ? `${label}s` : label;
}

function formatNumber(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatEnergy(value) {
  if (value >= 1_000_000) return `${formatNumber(value / 1_000_000, 2)} MJ`;
  if (value >= 1_000) return `${formatNumber(value / 1_000, 2)} kJ`;
  return `${formatNumber(value, 2)} J`;
}

function formatEnergyPerSample(value) {
  if (value < 0.001) return `${formatNumber(value * 1_000_000, 3)} µJ/sample`;
  if (value < 1) return `${formatNumber(value * 1_000, 3)} mJ/sample`;
  return `${formatNumber(value, 4)} J/sample`;
}

function formatDuration(value) {
  if (value >= 3600) return `${formatNumber(value / 3600, 2)} h`;
  if (value >= 60) return `${formatNumber(value / 60, 2)} min`;
  return `${formatNumber(value, 2)} s`;
}

function formatDate(date, options = { dateStyle: "medium", timeStyle: "short" }) {
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function formatCheckedTime(date) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(date);
}

function modelColor(label) {
  let hash = 0;
  for (let index = 0; index < label.length; index += 1) hash = (hash * 31 + label.charCodeAt(index)) >>> 0;
  return CHART_COLORS[hash % CHART_COLORS.length];
}

function withAlpha(hex, alpha) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeColumnName,
    normalizeRows,
    collectColumns,
    orderColumns,
    groupAverageByModel,
    toNumber,
    parseDate,
    average,
    rowLabel,
    formatEnergy,
    formatEnergyPerSample,
    formatDuration,
  };
}
