const API = {
  geocoding: "https://geocoding-api.open-meteo.com/v1/search",
  airQuality: "https://air-quality-api.open-meteo.com/v1/air-quality"
};

const MAX_FORECAST_DAYS = 7;
const SEARCH_DELAY = 350;
const STORAGE_KEY = "clearsky-aqi-last-search";

const form = document.querySelector("#forecast-form");
const locationInput = document.querySelector("#location-input");
const locationResults = document.querySelector("#location-results");
const chosenLocation = document.querySelector("#chosen-location");
const dateInput = document.querySelector("#date-input");
const timeInput = document.querySelector("#time-input");
const button = document.querySelector("#forecast-button");
const statusMessage = document.querySelector("#status-message");
const emptyPanel = document.querySelector("#empty-panel");
const loadingPanel = document.querySelector("#loading-panel");
const resultPanel = document.querySelector("#result-panel");
const newSearchButton = document.querySelector("#new-search-button");
const hourlyList = document.querySelector("#hourly-list");
const trendChart = document.querySelector("#trend-chart");
const installButton = document.querySelector("#install-button");
const appMessage = document.querySelector("#app-message");
const appMessageText = document.querySelector("#app-message-text");
const appMessageAction = document.querySelector("#app-message-action");
const appMessageDismiss = document.querySelector("#app-message-dismiss");

let selectedLocation = null;
let searchTimer = null;
let searchController = null;
let latestSearch = "";
let locationOptions = [];
let activeLocationIndex = -1;
let lastForecastData = null;
let deferredInstallPrompt = null;
let refreshingForUpdate = false;

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateRange() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const max = new Date(today);
  max.setDate(max.getDate() + MAX_FORECAST_DAYS - 1);
  return { min: toIsoDate(today), max: toIsoDate(max) };
}

function populateTimeOptions() {
  const formatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", hour12: true, timeZone: "UTC" });
  timeInput.innerHTML = "";

  for (let hour = 0; hour < 24; hour += 1) {
    const option = document.createElement("option");
    option.value = String(hour).padStart(2, "0");
    option.textContent = formatter.format(new Date(Date.UTC(2026, 0, 1, hour)));
    timeInput.append(option);
  }

  timeInput.value = String((new Date().getHours() + 1) % 24).padStart(2, "0");
}

function setupForecastInputs() {
  const { min, max } = dateRange();
  dateInput.min = min;
  dateInput.max = max;
  dateInput.value = min;
  populateTimeOptions();
}

function setStatus(message = "", type = "") {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`.trim();
}

function setLoading(isLoading) {
  button.disabled = isLoading;
  button.querySelector("span").textContent = isLoading ? "Loading outlook…" : "See forecast";
  form.setAttribute("aria-busy", String(isLoading));
  loadingPanel.hidden = !isLoading;
}

function showAppMessage(message, { actionLabel = "", action = null, dismissible = true } = {}) {
  appMessageText.textContent = message;
  appMessageAction.hidden = !action;
  appMessageAction.textContent = actionLabel;
  appMessageAction.onclick = action;
  appMessageDismiss.hidden = !dismissible;
  appMessage.hidden = false;
}

function hideAppMessage() {
  appMessage.hidden = true;
  appMessageAction.onclick = null;
}

function isSecureAppContext() {
  return window.isSecureContext || ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function isInstalledApp() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(window.navigator.userAgent) ||
    (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
}

function updateInstallControl() {
  installButton.hidden = isInstalledApp() || (!deferredInstallPrompt && !isIosDevice());
}

function locationLabel(location) {
  return [location.name, location.admin1, location.country].filter(Boolean).join(", ");
}

function locationSubtitle(location) {
  return [location.admin1, location.country].filter(Boolean).join(", ") || "Location";
}

function clearLocationResults() {
  locationOptions = [];
  activeLocationIndex = -1;
  locationResults.innerHTML = "";
  locationResults.classList.remove("has-results");
  locationInput.setAttribute("aria-expanded", "false");
  locationInput.removeAttribute("aria-activedescendant");
}

function selectLocation(location, { persistText = true } = {}) {
  selectedLocation = location;
  if (persistText) locationInput.value = location.name;
  locationInput.removeAttribute("aria-invalid");
  chosenLocation.textContent = `Selected: ${locationLabel(location)}`;
  clearLocationResults();
}

function showLocationResults(locations) {
  clearLocationResults();
  locationOptions = locations;

  locations.forEach((location, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.id = `location-option-${index}`;
    option.className = "location-option";
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");

    const name = document.createElement("strong");
    name.textContent = location.name;
    const meta = document.createElement("span");
    meta.textContent = locationSubtitle(location);
    option.append(name, meta);
    option.addEventListener("click", () => selectLocation(location));
    locationResults.append(option);
  });

  locationResults.classList.add("has-results");
  locationInput.setAttribute("aria-expanded", "true");
}

function setActiveLocationOption(index) {
  if (!locationOptions.length) return;
  activeLocationIndex = (index + locationOptions.length) % locationOptions.length;
  const options = [...locationResults.querySelectorAll(".location-option")];
  options.forEach((option, optionIndex) => {
    const isActive = optionIndex === activeLocationIndex;
    option.classList.toggle("active", isActive);
    option.setAttribute("aria-selected", String(isActive));
  });
  const activeOption = options[activeLocationIndex];
  locationInput.setAttribute("aria-activedescendant", activeOption.id);
  activeOption.scrollIntoView({ block: "nearest" });
}

async function searchLocations(query) {
  if (searchController) searchController.abort();
  searchController = new AbortController();
  latestSearch = query;

  const parameters = new URLSearchParams({ name: query, count: "5", language: "en", format: "json" });
  const response = await fetch(`${API.geocoding}?${parameters}`, { signal: searchController.signal });
  if (!response.ok) throw new Error("Location search is unavailable right now.");

  const payload = await response.json();
  if (latestSearch !== query || locationInput.value.trim() !== query) return;

  const locations = payload.results || [];
  if (locations.length) {
    showLocationResults(locations);
    chosenLocation.textContent = "Use the arrow keys, or choose the place you mean from the list.";
  } else {
    clearLocationResults();
    chosenLocation.textContent = "No matching places found. Try a city, town, postcode, or add a country.";
  }
}

function scheduleLocationSearch() {
  const query = locationInput.value.trim();
  selectedLocation = null;
  locationInput.removeAttribute("aria-invalid");
  clearLocationResults();
  latestSearch = query;
  window.clearTimeout(searchTimer);
  if (searchController) searchController.abort();

  if (query.length < 2) {
    chosenLocation.textContent = "Type two or more letters, then choose a location.";
    return;
  }

  chosenLocation.textContent = "Looking for places…";
  searchTimer = window.setTimeout(async () => {
    try {
      await searchLocations(query);
    } catch (error) {
      if (error.name !== "AbortError") chosenLocation.textContent = error.message;
    }
  }, SEARCH_DELAY);
}

function getCategory(aqi) {
  if (aqi <= 50) return { key: "good", label: "Good", advice: "Air quality is satisfactory. Normal outdoor plans look good.", action: "Enjoy your usual plans" };
  if (aqi <= 100) return { key: "moderate", label: "Moderate", advice: "Acceptable for most people. If you are unusually sensitive, consider easing off prolonged exertion.", action: "Most plans are comfortable" };
  if (aqi <= 150) return { key: "sensitive", label: "Unhealthy for sensitive groups", advice: "Children, older adults, and people with heart or lung conditions should reduce prolonged outdoor exertion.", action: "Sensitive groups: take it easier" };
  if (aqi <= 200) return { key: "unhealthy", label: "Unhealthy", advice: "Consider reducing prolonged outdoor activity, especially if you are sensitive to air pollution.", action: "Consider shorter outdoor time" };
  if (aqi <= 300) return { key: "very-unhealthy", label: "Very unhealthy", advice: "Avoid prolonged outdoor exertion. Sensitive groups should stay indoors where possible.", action: "Reduce outdoor exposure" };
  return { key: "hazardous", label: "Hazardous", advice: "Avoid outdoor activity. Follow local public-health guidance and keep indoor air as clean as possible.", action: "Avoid outdoor activity" };
}

function validateForecastRequest() {
  const { min, max } = dateRange();
  const date = dateInput.value;
  if (!selectedLocation) {
    locationInput.setAttribute("aria-invalid", "true");
    locationInput.focus();
    throw new Error("Choose one of the suggested places so we can locate the forecast.");
  }
  if (!date || date < min || date > max) throw new Error(`Choose a date from ${min} through ${max}. Forecasts are limited to the next 7 days.`);
  if (!timeInput.value) throw new Error("Choose a local forecast time.");
}

async function getForecast() {
  const parameters = new URLSearchParams({
    latitude: String(selectedLocation.latitude),
    longitude: String(selectedLocation.longitude),
    hourly: "us_aqi,european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide",
    forecast_days: String(MAX_FORECAST_DAYS),
    timezone: "auto"
  });
  const response = await fetch(`${API.airQuality}?${parameters}`);
  if (!response.ok) throw new Error("The air-quality forecast could not be loaded. Please try again.");
  const data = await response.json();
  if (!data.hourly?.time?.length) throw new Error("No hourly forecast was returned for this location.");
  return data;
}

function selectedTimestamp() {
  return `${dateInput.value}T${timeInput.value}:00`;
}

function number(value, digits = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : "—";
}

function formatForecastDate(dateValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const reference = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(reference);
}

function formatForecastTime(dateValue, hourValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const hour = Number(hourValue);
  const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day, hour)));
  return `${formatForecastDate(dateValue)}, ${clock}`;
}

function getDayEntries(hourly, dateValue) {
  const prefix = `${dateValue}T`;
  return hourly.time.map((time, index) => ({ time, index, aqi: Math.round(hourly.us_aqi[index]) })).filter((entry) => entry.time.startsWith(prefix) && Number.isFinite(entry.aqi));
}

function getHourlySnapshot(data, target) {
  const index = data.hourly.time.indexOf(target);
  if (index === -1) throw new Error("That local hour is not available yet. Choose another time within the 7-day forecast window.");
  return { index, hourly: data.hourly, aqi: Math.round(data.hourly.us_aqi[index]) };
}

function updateMetricTrend(metric, hourly, index) {
  const element = document.querySelector(`#${metric}-trend`);
  const value = Number(hourly[metric === "pm25" ? "pm2_5" : metric === "pm10" ? "pm10" : metric === "ozone" ? "ozone" : "nitrogen_dioxide"][index]);
  const previous = Number(hourly[metric === "pm25" ? "pm2_5" : metric === "pm10" ? "pm10" : metric === "ozone" ? "ozone" : "nitrogen_dioxide"][index - 1]);
  if (!Number.isFinite(value) || !Number.isFinite(previous)) { element.textContent = "—"; return; }
  const difference = value - previous;
  element.textContent = Math.abs(difference) < .1 ? "steady" : difference > 0 ? "↑ rising" : "↓ easing";
}

function renderForecastDetails() {
  const target = selectedTimestamp();
  const { index, hourly, aqi } = getHourlySnapshot(lastForecastData, target);
  const category = getCategory(aqi);
  const readableTime = formatForecastTime(dateInput.value, timeInput.value);

  document.querySelector("#result-location").textContent = locationLabel(selectedLocation);
  document.querySelector("#result-time").textContent = `${readableTime} local time (${lastForecastData.timezone})`;
  document.querySelector("#aqi-score").textContent = aqi;
  document.querySelector("#aqi-category").textContent = category.label;
  document.querySelector("#aqi-guidance").textContent = category.advice;
  document.querySelector("#pm25-value").textContent = number(hourly.pm2_5[index], 1);
  document.querySelector("#pm10-value").textContent = number(hourly.pm10[index], 1);
  document.querySelector("#ozone-value").textContent = number(hourly.ozone[index], 1);
  document.querySelector("#no2-value").textContent = number(hourly.nitrogen_dioxide[index], 1);
  updateMetricTrend("pm25", hourly, index);
  updateMetricTrend("pm10", hourly, index);
  updateMetricTrend("ozone", hourly, index);
  updateMetricTrend("no2", hourly, index);

  const summary = document.querySelector("#aqi-summary");
  summary.className = `aqi-summary category-${category.key}`;
  document.querySelector("#aqi-marker").style.left = `${Math.min(97, Math.max(0, (aqi / 350) * 100))}%`;
  renderDaySummary(hourly);
  renderHourlyTrend(hourly, target);
  saveLastSearch();
}

function renderDaySummary(hourly) {
  const entries = getDayEntries(hourly, dateInput.value);
  const best = entries.reduce((lowest, entry) => entry.aqi < lowest.aqi ? entry : lowest, entries[0]);
  const highest = entries.reduce((peak, entry) => entry.aqi > peak.aqi ? entry : peak, entries[0]);
  const hourLabel = (entry) => formatForecastTime(dateInput.value, entry.time.slice(11, 13)).split(", ").pop();
  document.querySelector("#hourly-caption").textContent = formatForecastDate(dateInput.value);
  document.querySelector("#day-summary").textContent = `Lowest forecast: AQI ${best.aqi} at ${hourLabel(best)} · Highest: AQI ${highest.aqi} at ${hourLabel(highest)}.`;
}

function createTrendSvg(entries, selectedIndex) {
  const width = 720;
  const height = 145;
  const padX = 9;
  const padY = 12;
  const maxAqi = Math.max(50, ...entries.map((entry) => entry.aqi));
  const x = (position) => padX + (position / Math.max(1, entries.length - 1)) * (width - padX * 2);
  const y = (aqi) => height - padY - (aqi / maxAqi) * (height - padY * 2);
  const points = entries.map((entry, position) => `${x(position).toFixed(1)},${y(entry.aqi).toFixed(1)}`);
  const area = `M ${x(0)},${height - padY} L ${points.join(" L ")} L ${x(entries.length - 1)},${height - padY} Z`;
  const circles = entries.map((entry, position) => `<circle class="trend-point${entry.index === selectedIndex ? " selected" : ""}" cx="${x(position).toFixed(1)}" cy="${y(entry.aqi).toFixed(1)}" r="${entry.index === selectedIndex ? 5.4 : 2.5}" />`).join("");
  return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true" preserveAspectRatio="none"><path class="trend-area" d="${area}"/><polyline class="trend-line" points="${points.join(" ")}"/>${circles}</svg>`;
}

function renderHourlyTrend(hourly, target) {
  const entries = getDayEntries(hourly, dateInput.value);
  const selectedIndex = hourly.time.indexOf(target);
  trendChart.innerHTML = createTrendSvg(entries, selectedIndex);
  hourlyList.innerHTML = "";

  entries.forEach((entry) => {
    const hour = entry.time.slice(11, 13);
    const category = getCategory(entry.aqi);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `hour-chip ${category.key}${entry.index === selectedIndex ? " selected" : ""}`;
    chip.setAttribute("aria-pressed", String(entry.index === selectedIndex));
    const label = formatForecastTime(dateInput.value, hour).split(", ").pop();
    chip.setAttribute("aria-label", `${label}, AQI ${entry.aqi}, ${category.label}${entry.index === selectedIndex ? ", selected" : ""}`);
    const time = document.createElement("span");
    time.textContent = label;
    const value = document.createElement("strong");
    value.textContent = entry.aqi;
    chip.append(time, value);
    chip.addEventListener("click", () => selectTimelineHour(hour));
    hourlyList.append(chip);
  });

  const selectedChip = hourlyList.querySelector(".selected");
  if (selectedChip) selectedChip.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", inline: "center", block: "nearest" });
}

function selectTimelineHour(hour) {
  timeInput.value = hour;
  try {
    renderForecastDetails();
    setStatus(`Updated to ${formatForecastTime(dateInput.value, hour)}.`, "");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function renderResult(data, { scrollToResult = true } = {}) {
  lastForecastData = data;
  renderForecastDetails();
  resultPanel.hidden = false;
  emptyPanel.hidden = true;
  setStatus("Forecast ready. Explore any hour in the trend without loading again.");
  if (scrollToResult) resultPanel.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function saveLastSearch() {
  const snapshot = { location: selectedLocation, date: dateInput.value, time: timeInput.value };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* Storage is optional. */ }
}

function restoreLastSearch() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved?.location) return;
    const { min, max } = dateRange();
    selectLocation(saved.location);
    dateInput.value = saved.date >= min && saved.date <= max ? saved.date : min;
    timeInput.value = saved.time || timeInput.value;
    chosenLocation.textContent += " Select See forecast to refresh this saved place.";
  } catch { /* A malformed or unavailable value should not block the app. */ }
}

function applyPreset(name) {
  const { min, max } = dateRange();
  const date = new Date(`${min}T12:00:00`);
  let hour = (new Date().getHours() + 1) % 24;
  if (name === "morning") { date.setDate(date.getDate() + 1); hour = 9; }
  if (name === "evening") { date.setDate(date.getDate() + 1); hour = 18; }
  const value = toIsoDate(date);
  dateInput.value = value > max ? max : value;
  timeInput.value = String(hour).padStart(2, "0");
  setStatus(`${name === "next" ? "Next available hour" : name === "morning" ? "Tomorrow morning" : "Tomorrow evening"} selected.`, "");
  timeInput.focus();
}

locationInput.addEventListener("input", scheduleLocationSearch);
locationInput.addEventListener("keydown", (event) => {
  const hasOptions = locationOptions.length > 0 && locationResults.classList.contains("has-results");
  if (event.key === "ArrowDown" && hasOptions) { event.preventDefault(); setActiveLocationOption(activeLocationIndex + 1); }
  if (event.key === "ArrowUp" && hasOptions) { event.preventDefault(); setActiveLocationOption(activeLocationIndex - 1); }
  if (event.key === "Enter" && hasOptions && activeLocationIndex >= 0) { event.preventDefault(); selectLocation(locationOptions[activeLocationIndex]); }
  if (event.key === "Escape") { clearLocationResults(); }
  if (event.key === "Tab") clearLocationResults();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".location-field")) clearLocationResults();
});

document.querySelectorAll("[data-preset]").forEach((preset) => preset.addEventListener("click", () => applyPreset(preset.dataset.preset)));

timeInput.addEventListener("change", () => {
  if (lastForecastData && !resultPanel.hidden) selectTimelineHour(timeInput.value);
});

dateInput.addEventListener("change", () => {
  if (lastForecastData && !resultPanel.hidden) {
    try { renderForecastDetails(); } catch { setStatus("Select See forecast to load that date's forecast.", ""); }
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    validateForecastRequest();
    setLoading(true);
    setStatus("Fetching the hourly air-quality forecast…", "loading");
    const data = await getForecast();
    renderResult(data);
  } catch (error) {
    setStatus(error.message || "Something went wrong. Please try again.", "error");
  } finally {
    setLoading(false);
  }
});

newSearchButton.addEventListener("click", () => {
  locationInput.focus();
  form.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
});

appMessageDismiss.addEventListener("click", hideAppMessage);

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    if (isIosDevice()) {
      showAppMessage("To install on iPhone or iPad, use Share, then Add to Home Screen.", { dismissible: true });
    }
    return;
  }

  installButton.disabled = true;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.disabled = false;
  updateInstallControl();
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallControl();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallControl();
  showAppMessage("ClearSky AQI is installed. Launch it anytime from your apps.", { dismissible: true });
});

window.addEventListener("offline", () => {
  showAppMessage("You’re offline. Live AQI forecasts need a connection.", { dismissible: true });
});

window.addEventListener("online", () => {
  if (!appMessage.hidden && appMessageText.textContent.includes("offline")) {
    showAppMessage("You’re back online. Live AQI forecasts are ready to refresh.", { dismissible: true });
  }
});

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !isSecureAppContext()) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!refreshingForUpdate) return;
    window.location.reload();
  });

  navigator.serviceWorker.register("service-worker.js").then((registration) => {
    const offerUpdate = () => {
      if (!registration.waiting) return;
      showAppMessage("A newer ClearSky AQI app is ready.", {
        actionLabel: "Refresh",
        action: () => {
          refreshingForUpdate = true;
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        },
        dismissible: true
      });
    };

    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) offerUpdate();
      });
    });

    offerUpdate();
  }).catch(() => {
    // The live forecast experience remains available without offline support.
  });
}

setupForecastInputs();
restoreLastSearch();
updateInstallControl();
registerServiceWorker();
