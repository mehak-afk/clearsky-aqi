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
const resultPanel = document.querySelector("#result-panel");
const newSearchButton = document.querySelector("#new-search-button");

let selectedLocation = null;
let searchTimer = null;
let searchController = null;
let latestSearch = "";

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
  // Open-Meteo's seven forecast days include today, so the final calendar date is today + 6.
  max.setDate(max.getDate() + MAX_FORECAST_DAYS - 1);
  return { min: toIsoDate(today), max: toIsoDate(max) };
}

function populateTimeOptions() {
  const formatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", hour12: true });
  timeInput.innerHTML = "";

  for (let hour = 0; hour < 24; hour += 1) {
    const option = document.createElement("option");
    option.value = String(hour).padStart(2, "0");
    option.textContent = formatter.format(new Date(2026, 0, 1, hour));
    timeInput.append(option);
  }

  const nextHour = new Date().getHours() + 1;
  timeInput.value = String(nextHour % 24).padStart(2, "0");
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
  button.querySelector("span").textContent = isLoading ? "Building forecast…" : "Check forecast";
  form.setAttribute("aria-busy", String(isLoading));
}

function locationLabel(location) {
  return [location.name, location.admin1, location.country].filter(Boolean).join(", ");
}

function clearLocationResults() {
  locationResults.innerHTML = "";
  locationResults.classList.remove("has-results");
  locationInput.setAttribute("aria-expanded", "false");
}

function selectLocation(location, { persistText = true } = {}) {
  selectedLocation = location;
  if (persistText) locationInput.value = location.name;
  chosenLocation.textContent = `Selected: ${locationLabel(location)}`;
  clearLocationResults();
}

function showLocationResults(locations) {
  clearLocationResults();

  locations.forEach((location) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "location-option";
    option.setAttribute("role", "option");
    option.innerHTML = `<strong>${escapeHtml(location.name)}</strong><span>${escapeHtml(locationLabel({ ...location, name: "" }).replace(/^, /, ""))}</span>`;
    option.addEventListener("click", () => selectLocation(location));
    locationResults.append(option);
  });

  locationResults.classList.add("has-results");
  locationInput.setAttribute("aria-expanded", "true");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;"
  })[character]);
}

async function searchLocations(query) {
  if (searchController) searchController.abort();
  searchController = new AbortController();
  latestSearch = query;

  const parameters = new URLSearchParams({ name: query, count: "5", language: "en", format: "json" });
  const response = await fetch(`${API.geocoding}?${parameters}`, { signal: searchController.signal });
  if (!response.ok) throw new Error("Location search is unavailable right now.");

  const payload = await response.json();
  if (latestSearch !== query) return;

  const locations = payload.results || [];
  if (locations.length) {
    showLocationResults(locations);
    chosenLocation.textContent = "Choose the place you mean from the list.";
  } else {
    clearLocationResults();
    chosenLocation.textContent = "No matching places found. Try a city, town, or postcode.";
  }
}

function scheduleLocationSearch() {
  const query = locationInput.value.trim();
  selectedLocation = null;
  clearLocationResults();

  window.clearTimeout(searchTimer);
  if (query.length < 2) {
    chosenLocation.textContent = "Start typing to find a place.";
    return;
  }

  chosenLocation.textContent = "Looking for places…";
  searchTimer = window.setTimeout(async () => {
    try {
      await searchLocations(query);
    } catch (error) {
      if (error.name !== "AbortError") {
        chosenLocation.textContent = error.message;
      }
    }
  }, SEARCH_DELAY);
}

function getCategory(aqi) {
  if (aqi <= 50) return { key: "good", label: "Good", advice: "Air quality is satisfactory. Enjoy normal outdoor activity." };
  if (aqi <= 100) return { key: "moderate", label: "Moderate", advice: "Acceptable for most people. Unusually sensitive people may want to take it easy outdoors." };
  if (aqi <= 150) return { key: "sensitive", label: "Unhealthy for sensitive groups", advice: "Children, older adults, and people with heart or lung conditions should reduce prolonged outdoor exertion." };
  if (aqi <= 200) return { key: "unhealthy", label: "Unhealthy", advice: "Consider reducing prolonged outdoor activity, especially if you are sensitive to air pollution." };
  if (aqi <= 300) return { key: "very-unhealthy", label: "Very unhealthy", advice: "Avoid prolonged outdoor exertion. Sensitive groups should stay indoors where possible." };
  return { key: "hazardous", label: "Hazardous", advice: "Avoid outdoor activity. Follow local public-health guidance and keep indoor air as clean as possible." };
}

function validateForecastRequest() {
  const { min, max } = dateRange();
  const date = dateInput.value;

  if (!selectedLocation) {
    throw new Error("Choose a location from the suggestions before checking its forecast.");
  }
  if (!date || date < min || date > max) {
    throw new Error(`Choose a date from ${min} through ${max}. Forecasts are limited to the next 7 days.`);
  }
  if (!timeInput.value) throw new Error("Choose a local forecast time.");
  if (date === min && Number(timeInput.value) <= new Date().getHours()) {
    throw new Error("Choose a later local hour today, or select a future date.");
  }
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
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(reference);
  const monthDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(reference);
  return `${weekday}, ${monthDay}`;
}

function formatForecastTime(dateValue, hourValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const hour = Number(hourValue);
  const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day, hour)));
  return `${formatForecastDate(dateValue)}, ${clock}`;
}

function renderResult(data) {
  const target = selectedTimestamp();
  const index = data.hourly.time.indexOf(target);
  if (index === -1) {
    throw new Error("That local hour is not available yet. Choose another time within the 7-day forecast window.");
  }

  const hourly = data.hourly;
  const aqi = Math.round(hourly.us_aqi[index]);
  const category = getCategory(aqi);
  const readableTime = formatForecastTime(dateInput.value, timeInput.value);

  document.querySelector("#result-location").textContent = locationLabel(selectedLocation);
  document.querySelector("#result-time").textContent = `${readableTime} local time (${data.timezone})`;
  document.querySelector("#aqi-score").textContent = aqi;
  document.querySelector("#aqi-category").textContent = category.label;
  document.querySelector("#aqi-guidance").textContent = category.advice;
  document.querySelector("#pm25-value").textContent = number(hourly.pm2_5[index], 1);
  document.querySelector("#pm10-value").textContent = number(hourly.pm10[index], 1);
  document.querySelector("#ozone-value").textContent = number(hourly.ozone[index], 1);
  document.querySelector("#no2-value").textContent = number(hourly.nitrogen_dioxide[index], 1);

  const summary = document.querySelector("#aqi-summary");
  summary.className = `aqi-summary category-${category.key}`;
  renderHourlyList(hourly, target);

  resultPanel.hidden = false;
  emptyPanel.hidden = true;
  setStatus("Forecast ready. Values are model forecasts, not live measurements.");
  saveLastSearch();
  resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderHourlyList(hourly, target) {
  const list = document.querySelector("#hourly-list");
  const caption = document.querySelector("#hourly-caption");
  const dayPrefix = `${dateInput.value}T`;
  const indices = hourly.time.map((time, index) => ({ time, index })).filter(({ time }) => time.startsWith(dayPrefix));
  const selectedIndex = hourly.time.indexOf(target);
  const selectedPosition = indices.findIndex(({ index }) => index === selectedIndex);
  const start = Math.max(0, Math.min(selectedPosition - 3, indices.length - 8));
  const visible = indices.slice(start, start + 8);

  caption.textContent = formatForecastDate(dateInput.value);
  list.innerHTML = "";

  visible.forEach(({ time, index }) => {
    const hour = Number(time.slice(11, 13));
    const label = new Intl.DateTimeFormat(undefined, { hour: "numeric", hour12: true, timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 1, hour)));
    const aqi = Math.round(hourly.us_aqi[index]);
    const chip = document.createElement("div");
    chip.className = `hour-chip ${getCategory(aqi).key}${index === selectedIndex ? " selected" : ""}`;
    chip.innerHTML = `<span>${label}</span><strong>${aqi}</strong>`;
    chip.setAttribute("aria-label", `${label}, AQI ${aqi}${index === selectedIndex ? ", selected" : ""}`);
    list.append(chip);
  });
}

function saveLastSearch() {
  const snapshot = {
    location: selectedLocation,
    date: dateInput.value,
    time: timeInput.value
  };
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
  } catch { /* A malformed or unavailable value should not block the app. */ }
}

locationInput.addEventListener("input", scheduleLocationSearch);
locationInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") clearLocationResults();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".location-field")) clearLocationResults();
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
  window.scrollTo({ top: form.getBoundingClientRect().top + window.scrollY - 24, behavior: "smooth" });
});

setupForecastInputs();
restoreLastSearch();
