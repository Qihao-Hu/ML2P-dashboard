"use strict";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const state = {
  branch: "",
  commitSha: "",
  runs: [],
  phase: "train",
  metric: "energy",
  query: "",
  loading: false,
};

const metricDefinitions = {
  energy: {
    title: "GPU energy per sample",
    note: "Lower is better",
    value: (run) => run.phase.gpu?.energyPerSample,
    format: (value) => formatEnergyPerSample(value),
    ascending: true,
  },
  cpuEnergy: {
    title: "CPU energy per sample",
    note: "Lower is better",
    value: (run) => run.phase.cpu?.energyPerSample,
    format: (value) => formatEnergyPerSample(value),
    ascending: true,
  },
  throughput: {
    title: "Workload throughput",
    note: "Higher is better",
    value: (run) => run.phase.throughput,
    format: (value) => `${formatNumber(value, 1)} samples/s`,
    ascending: false,
  },
  power: {
    title: "Average GPU power",
    note: "Measured over the selected phase",
    value: (run) => run.phase.gpu?.avgPower,
    format: (value) => `${formatNumber(value, 1)} W`,
    ascending: false,
  },
  gpuPeakPower: {
    title: "Peak GPU power",
    note: "Highest sampled GPU power",
    value: (run) => run.phase.gpu?.peakPower,
    format: (value) => formatPower(value),
    ascending: false,
  },
  cpuPower: {
    title: "Average CPU power",
    note: "Aggregate package power",
    value: (run) => run.phase.cpu?.avgPower,
    format: (value) => formatPower(value),
    ascending: false,
  },
  cpuPeakPower: {
    title: "Peak CPU power",
    note: "Aggregate sampled package power",
    value: (run) => run.phase.cpu?.peakPower,
    format: (value) => formatPower(value),
    ascending: false,
  },
  utilization: {
    title: "Average GPU utilization",
    note: "Measured over the selected phase",
    value: (run) => run.phase.gpuUtilization,
    format: (value) => `${formatNumber(value, 1)}%`,
    ascending: false,
  },
  cpuUtilization: {
    title: "Average CPU utilization",
    note: "Measured over the selected phase",
    value: (run) => run.phase.cpuUtilization,
    format: (value) => `${formatNumber(value, 1)}%`,
    ascending: false,
  },
};

const elements = {
  content: document.querySelector("#dashboard-content"),
  loading: document.querySelector("#loading-panel"),
  error: document.querySelector("#error-panel"),
  errorMessage: document.querySelector("#error-message"),
  refreshButton: document.querySelector("#refresh-button"),
  retryButton: document.querySelector("#retry-button"),
  liveStatus: document.querySelector("#live-status"),
  statusLabel: document.querySelector("#status-label"),
  branchLabel: document.querySelector("#branch-label"),
  syncLabel: document.querySelector("#sync-label"),
  metricSelect: document.querySelector("#metric-select"),
  searchInput: document.querySelector("#search-input"),
  chart: document.querySelector("#bar-chart"),
  chartTitle: document.querySelector("#chart-title"),
  chartNote: document.querySelector("#chart-note"),
  resultsBody: document.querySelector("#results-body"),
  emptyState: document.querySelector("#empty-state"),
  runCount: document.querySelector("#run-count"),
  modelCount: document.querySelector("#model-count"),
  bestLabel: document.querySelector("#best-label"),
  bestValue: document.querySelector("#best-value"),
  bestModel: document.querySelector("#best-model"),
  energyLabel: document.querySelector("#energy-label"),
  totalEnergy: document.querySelector("#total-energy"),
  energyContext: document.querySelector("#energy-context"),
  cpuEnergyLabel: document.querySelector("#cpu-energy-label"),
  totalCpuEnergy: document.querySelector("#total-cpu-energy"),
  cpuEnergyContext: document.querySelector("#cpu-energy-context"),
  gpuPeakLabel: document.querySelector("#gpu-peak-label"),
  gpuPeakValue: document.querySelector("#gpu-peak-value"),
  gpuPeakModel: document.querySelector("#gpu-peak-model"),
  cpuPeakLabel: document.querySelector("#cpu-peak-label"),
  cpuPeakValue: document.querySelector("#cpu-peak-value"),
  cpuPeakModel: document.querySelector("#cpu-peak-model"),
  deviceName: document.querySelector("#device-name"),
};

document.querySelectorAll("[data-phase]").forEach((button) => {
  button.addEventListener("click", () => {
    state.phase = button.dataset.phase;
    document.querySelectorAll("[data-phase]").forEach((candidate) => {
      const selected = candidate === button;
      candidate.classList.toggle("active", selected);
      candidate.setAttribute("aria-pressed", String(selected));
    });
    render();
  });
});

elements.metricSelect.addEventListener("change", (event) => {
  state.metric = event.target.value;
  render();
});

elements.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value.trim().toLowerCase();
  renderTable(getPhaseRuns());
});

elements.refreshButton.addEventListener("click", () => loadDashboard());
elements.retryButton.addEventListener("click", () => loadDashboard());

async function loadDashboard() {
  if (state.loading) return;
  setLoading(true);

  try {
    const payload = await loadBundledData();

    state.branch = payload.branch;
    state.commitSha = payload.commitSha;
    state.runs = payload.summaries.map(normalizeRun).filter((run) => run.phases.size > 0);
    if (!state.runs.length) throw new Error("Summary files were found, but none contained recognizable phase data.");

    updateRepositoryMeta(payload.syncedAt);
    render();
    showContent();
  } catch (error) {
    showError(error instanceof Error ? error.message : "An unexpected error occurred.");
  } finally {
    setLoading(false);
  }
}

async function loadBundledData() {
  const response = await fetch("./dashboard-data.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Dashboard data returned ${response.status}.`);
  const bundle = await response.json();
  if (!Array.isArray(bundle.runs) || !bundle.runs.length) {
    throw new Error("The dashboard data bundle contains no benchmark runs.");
  }
  return {
    branch: bundle.source_branch || "main",
    commitSha: bundle.source_sha || "",
    summaries: bundle.runs,
    syncedAt: bundle.generated_at || new Date().toISOString(),
  };
}

function normalizeRun({ path, data }) {
  const config = data.config || {};
  const monitor = data.monitor || {};
  const phaseItems = Array.isArray(data.phases) ? data.phases : [];
  const phases = new Map(phaseItems.map((phase) => [phase.label, normalizePhase(phase)]));

  return {
    path,
    model: String(config.model || config.run_name || parentDirectory(path)),
    runName: String(config.run_name || parentDirectory(path)),
    inputKind: String(config.input_kind || "unknown"),
    batchSize: numeric(config.batch_size),
    device: String(monitor.gpu?.name || config.device || "Unknown device"),
    phases,
  };
}

function normalizePhase(phase) {
  const gpu = phase.domains?.gpu || {};
  const cpu = phase.domains?.cpu_total || {};
  const system = phase.domains?.system || {};
  return {
    duration: numeric(phase.duration_s),
    samples: numeric(phase.n_samples_workload),
    throughput: numeric(phase.throughput_samples_s ?? phase.throughput_img_s),
    gpuUtilization: numeric(phase.gpu_avg_util_pct),
    cpuUtilization: numeric(phase.cpu_avg_util_pct),
    gpu: normalizeDomain(gpu),
    cpu: normalizeDomain(cpu),
    system: normalizeDomain(system),
  };
}

function normalizeDomain(domain) {
  return {
    energy: numeric(domain.energy_j),
    energyPerSample: numeric(domain.energy_per_sample_j ?? domain.energy_per_image_j),
    avgPower: numeric(domain.avg_power_w),
    peakPower: numeric(domain.peak_power_w),
  };
}

function getPhaseRuns() {
  return state.runs
    .filter((run) => run.phases.has(state.phase))
    .map((run) => ({ ...run, phase: run.phases.get(state.phase) }));
}

function render() {
  const runs = getPhaseRuns();
  renderStats(runs);
  renderChart(runs);
  renderTable(runs);
}

function renderStats(runs) {
  const models = new Set(state.runs.map((run) => run.model));
  const efficientRuns = runs.filter((run) => isNumber(run.phase.gpu?.energyPerSample));
  const best = efficientRuns.sort((a, b) => a.phase.gpu.energyPerSample - b.phase.gpu.energyPerSample)[0];
  const totalEnergy = runs.reduce((sum, run) => sum + (run.phase.gpu?.energy || 0), 0);
  const totalCpuEnergy = runs.reduce((sum, run) => sum + (run.phase.cpu?.energy || 0), 0);
  const gpuPeak = runs
    .filter((run) => isNumber(run.phase.gpu?.peakPower))
    .sort((a, b) => b.phase.gpu.peakPower - a.phase.gpu.peakPower)[0];
  const cpuPeak = runs
    .filter((run) => isNumber(run.phase.cpu?.peakPower))
    .sort((a, b) => b.phase.cpu.peakPower - a.phase.cpu.peakPower)[0];
  const devices = [...new Set(state.runs.map((run) => run.device))];
  const phaseName = phaseTitle(state.phase);

  elements.runCount.textContent = String(state.runs.length);
  elements.modelCount.textContent = `Across ${models.size} model${models.size === 1 ? "" : "s"}`;
  elements.bestLabel.textContent = `Best ${phaseName.toLowerCase()} GPU efficiency`;
  elements.bestValue.textContent = best ? formatEnergyPerSample(best.phase.gpu.energyPerSample) : "n/a";
  elements.bestModel.textContent = best ? best.model : "Energy per sample unavailable";
  elements.energyLabel.textContent = `${phaseName} GPU energy`;
  elements.totalEnergy.textContent = formatEnergy(totalEnergy);
  elements.energyContext.textContent = `Total across ${runs.length} run${runs.length === 1 ? "" : "s"}`;
  elements.cpuEnergyLabel.textContent = `${phaseName} CPU energy`;
  elements.totalCpuEnergy.textContent = formatEnergy(totalCpuEnergy);
  elements.cpuEnergyContext.textContent = `Aggregate packages across ${runs.length} run${runs.length === 1 ? "" : "s"}`;
  elements.gpuPeakLabel.textContent = `Peak ${phaseName.toLowerCase()} GPU power`;
  elements.gpuPeakValue.textContent = gpuPeak ? formatPower(gpuPeak.phase.gpu.peakPower) : "n/a";
  elements.gpuPeakModel.textContent = gpuPeak ? gpuPeak.model : "Peak power unavailable";
  elements.cpuPeakLabel.textContent = `Peak ${phaseName.toLowerCase()} CPU power`;
  elements.cpuPeakValue.textContent = cpuPeak ? formatPower(cpuPeak.phase.cpu.peakPower) : "n/a";
  elements.cpuPeakModel.textContent = cpuPeak ? cpuPeak.model : "Peak power unavailable";
  elements.deviceName.textContent = devices.length === 1 ? devices[0] : `${devices.length} devices`;
  elements.deviceName.title = devices.join(", ");
}

function renderChart(runs) {
  const metric = metricDefinitions[state.metric];
  const measured = runs
    .map((run) => ({ run, value: metric.value(run) }))
    .filter((entry) => isNumber(entry.value))
    .sort((a, b) => metric.ascending ? a.value - b.value : b.value - a.value);
  const maximum = Math.max(...measured.map((entry) => entry.value), 0);

  elements.chartTitle.textContent = metric.title;
  elements.chartNote.textContent = metric.note;
  elements.chart.setAttribute("aria-label", `${phaseTitle(state.phase)} ${metric.title.toLowerCase()} by model`);
  elements.chart.replaceChildren();

  if (!measured.length) {
    const message = document.createElement("p");
    message.className = "empty-state";
    message.textContent = `No ${metric.title.toLowerCase()} data is available for this phase.`;
    elements.chart.append(message);
    return;
  }

  measured.forEach(({ run, value }) => {
    const row = document.createElement("div");
    row.className = "bar-row";

    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = run.model;
    label.title = run.runName;

    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = `${maximum ? Math.max((value / maximum) * 100, 1.5) : 0}%`;
    track.append(fill);

    const formatted = document.createElement("span");
    formatted.className = "bar-value";
    formatted.textContent = metric.format(value);

    row.append(label, track, formatted);
    elements.chart.append(row);
  });
}

function renderTable(runs) {
  const filtered = runs
    .filter((run) => `${run.model} ${run.runName} ${run.inputKind} ${run.device}`.toLowerCase().includes(state.query))
    .sort((a, b) => a.model.localeCompare(b.model));

  elements.resultsBody.replaceChildren();
  elements.emptyState.hidden = filtered.length > 0;

  filtered.forEach((run) => {
    const row = document.createElement("tr");
    const values = [
      run.model,
      titleCase(run.inputKind),
      formatInteger(run.batchSize),
      isNumber(run.phase.throughput) ? `${formatNumber(run.phase.throughput, 1)}/s` : "n/a",
      formatEnergyPerSample(run.phase.gpu?.energyPerSample),
      formatEnergyPerSample(run.phase.cpu?.energyPerSample),
      formatPower(run.phase.gpu?.avgPower),
      formatPower(run.phase.gpu?.peakPower),
      formatPower(run.phase.cpu?.avgPower),
      formatPower(run.phase.cpu?.peakPower),
      isNumber(run.phase.gpuUtilization) ? `${formatNumber(run.phase.gpuUtilization, 1)}%` : "n/a",
      isNumber(run.phase.cpuUtilization) ? `${formatNumber(run.phase.cpuUtilization, 1)}%` : "n/a",
    ];

    values.forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    });

    elements.resultsBody.append(row);
  });
}

function updateRepositoryMeta(syncedAt) {
  const syncDate = new Date(syncedAt);
  elements.branchLabel.textContent = state.branch;
  elements.branchLabel.title = state.commitSha;
  elements.syncLabel.textContent = formatRelativeTime(syncDate);
  elements.syncLabel.title = syncDate.toLocaleString();
  elements.statusLabel.textContent = "Snapshot loaded";
  elements.liveStatus.classList.remove("error");
  document.title = `ML2P · ${state.runs.length} benchmarks`;
}

function setLoading(loading) {
  state.loading = loading;
  elements.refreshButton.disabled = loading;
  elements.refreshButton.classList.toggle("is-loading", loading);
  if (loading && !state.runs.length) {
    elements.loading.hidden = false;
    elements.error.hidden = true;
  }
}

function showContent() {
  elements.loading.hidden = true;
  elements.error.hidden = true;
  elements.content.hidden = false;
}

function showError(message) {
  elements.loading.hidden = true;
  elements.content.hidden = state.runs.length === 0;
  elements.error.hidden = state.runs.length > 0;
  elements.errorMessage.textContent = message;
  elements.statusLabel.textContent = state.runs.length ? "Refresh failed" : "Offline";
  elements.liveStatus.classList.add("error");
}

function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function formatNumber(value, maximumFractionDigits = 2) {
  if (!isNumber(value)) return "n/a";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function formatInteger(value) {
  if (!isNumber(value)) return "n/a";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatEnergy(value) {
  if (!isNumber(value)) return "n/a";
  if (value >= 1_000_000) return `${formatNumber(value / 1_000_000, 2)} MJ`;
  if (value >= 1_000) return `${formatNumber(value / 1_000, 2)} kJ`;
  return `${formatNumber(value, 1)} J`;
}

function formatPower(value) {
  return isNumber(value) ? `${formatNumber(value, 1)} W` : "n/a";
}

function formatEnergyPerSample(value) {
  if (!isNumber(value)) return "n/a";
  if (value < 0.001) return `${formatNumber(value * 1000, 3)} mJ/sample`;
  return `${formatNumber(value, 4)} J/sample`;
}

function titleCase(value) {
  return String(value).replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function phaseTitle(value) {
  return value === "infer" ? "Inference" : titleCase(value);
}

function parentDirectory(path) {
  const parts = path.split("/");
  return parts.length > 1 ? parts[parts.length - 2] : path;
}

function formatRelativeTime(date) {
  if (Number.isNaN(date.getTime())) return "Unknown";
  const seconds = (date.getTime() - Date.now()) / 1000;
  const absolute = Math.abs(seconds);
  let value = seconds;
  let unit = "second";
  if (absolute >= 86_400) {
    value = seconds / 86_400;
    unit = "day";
  } else if (absolute >= 3_600) {
    value = seconds / 3_600;
    unit = "hour";
  } else if (absolute >= 60) {
    value = seconds / 60;
    unit = "minute";
  }
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round(value), unit);
}

loadDashboard();
window.setInterval(loadDashboard, REFRESH_INTERVAL_MS);
