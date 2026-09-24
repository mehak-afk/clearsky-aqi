# ClearSky AQI

A browser-only air-quality forecast page. Search for a place, select a local hour within the next seven days, and view its predicted **US AQI**, key pollutants, and health context.

## Run locally

Open `index.html` in a modern browser. No installation, server, account, or API key is needed.

## Install as an app

On a supported browser, use the **Install app** button or the browser’s install menu to add ClearSky AQI to your device. The installed app opens in its own window and keeps the interface available after the first visit. Live location search and AQI forecasts always require a connection and are never cached as offline data.

## Data and limits

- Location search: [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api)
- AQI and pollutant forecasts: [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api)
- Forecast horizon: up to seven days, as supplied by the provider
- This app displays a **model forecast**, not a live sensor observation or a guaranteed prediction. Local conditions and personal exposure can differ.
- The app calls the public, browser-accessible Open-Meteo endpoints directly. Review Open-Meteo commercial-use terms before using this project commercially.

## Attribution

Air-quality forecast data is provided by [Open-Meteo](https://open-meteo.com/) using [CAMS ENSEMBLE](https://atmosphere.copernicus.eu/). See Open-Meteo's documentation for applicable data attribution and licensing requirements.

## Deployment

The static site is published with GitHub Pages at:

`https://mehak-afk.github.io/clearsky-aqi/`
