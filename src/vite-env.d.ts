/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MQTT_URL?: string;
  readonly VITE_MQTT_USERNAME?: string;
  readonly VITE_MQTT_PASSWORD?: string;
  readonly VITE_MQTT_TOPIC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.wav?url' {
  const src: string;
  export default src;
}
