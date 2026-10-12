# Aquadome Web

Mobile-first React/Vite version of the Aquadome water tank dashboard. It
includes live MQTT readings over secure WebSockets (WSS), level and volume
calculation, stale-reading status, reconnection, and a persistent full-tank
alarm cycle. The Flutter app is maintained separately in the sibling
`water_tank_monitor_modern` folder.

## Run locally

Requirements: Node.js 20.19 or newer.

1. Copy `.env.example` to `.env`.
2. Set `VITE_MQTT_URL`, `VITE_MQTT_USERNAME`, and `VITE_MQTT_PASSWORD`.
   The broker must have a WSS listener; port `8084` and `/mqtt` are common for
   EMQX Cloud, but confirm the endpoint and path in your broker configuration.
3. Install dependencies and start the dev server:

   ```sh
   npm install
   npm run dev
   ```

Run the unit tests with `npm test`. Type-check and create a production build with
`npm run build`; preview it with `npm run preview`. Deploy the contents of
`dist/` to any static HTTPS host. The service worker caches successfully loaded
same-origin app files for offline startup; tank data still requires a network
connection.

## MQTT credentials and browser limitations

Vite embeds `VITE_` variables in the JavaScript bundle. Never use privileged
broker credentials. Use a read-only MQTT account restricted to
`water_tank/telemetry`, or use a trusted backend relay if credentials must
remain secret. Any credentials used by the browser are visible to visitors. `.env` is ignored
by Git. The checked-in `.env.example` intentionally contains no login details.

## Deploy with GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds, tests, enables Pages,
and deploys the site on every push to `main`. The site is built without MQTT
login credentials by design. Do not add username or
password as Actions secrets for this static client: the values would be
included in publicly downloadable browser JavaScript. To show live readings on
the public site, use a broker account with public read-only access restricted
to the telemetry topic, or put a trusted backend relay between the website and
the broker.

Browser notifications require permission and are shown only while the app is
open. Web push while closed needs a push service and trusted sender; the native
Android home-screen widget is not available to this web app. Vibration and
background audio depend on browser/device support, and browsers may require a
user gesture before alarm audio is allowed.
