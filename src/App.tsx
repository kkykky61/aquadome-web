import { useCallback, useEffect, useRef, useState } from 'react';
import mqtt, { type MqttClient } from 'mqtt';
import alarmUrl from '../assets/sounds/tank_alarm.wav?url';
import {
  buildNotificationContent,
  formatDistance,
  formatLitres,
  formatStamp,
  getTankMetrics,
  getTankStatus,
  parseSensorPayload,
  EMPTY_DISTANCE,
  FULL_DISTANCE,
  STALE_AFTER_MS,
  TANK_CAPACITY,
  type SensorReading,
} from './tank';

type ConnectionState = 'connecting' | 'connected' | 'offline';

const brokerUrl = import.meta.env.VITE_MQTT_URL?.trim() ?? '';
const username = import.meta.env.VITE_MQTT_USERNAME ?? '';
const password = import.meta.env.VITE_MQTT_PASSWORD ?? '';
const topic = import.meta.env.VITE_MQTT_TOPIC?.trim() || 'water_tank/telemetry';
const alarmCycleKey = 'tank_full_alarm_cycle_latched';

function useTankConnection(
  onReading: (reading: SensorReading) => void,
  enabled: boolean,
) {
  const clientRef = useRef<MqttClient | null>(null);
  const onReadingRef = useRef(onReading);
  const [state, setState] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    onReadingRef.current = onReading;
  }, [onReading]);

  const reconnect = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    let client: MqttClient | null = null;
    clientRef.current?.end(true);
    clientRef.current = null;
    if (!enabled) return;
    setError(null);

    if (!brokerUrl) {
      setState('offline');
      setError('Set VITE_MQTT_URL in your local .env file to connect');
      return;
    }

    setState('connecting');
    client = mqtt.connect(brokerUrl, {
      username,
      password,
      protocolVersion: 4,
      keepalive: 30,
      connectTimeout: 8_000,
      reconnectPeriod: 3_000,
      clean: true,
      clientId: `aquadome_web_${Math.random().toString(16).slice(2, 12)}`,
    });
    clientRef.current = client;

    client.on('connect', () => {
      if (!active) return;
      setState('connected');
      setError(null);
      client?.subscribe(topic, { qos: 1 }, (subscribeError) => {
        if (subscribeError && active) {
          console.error('Aquadome MQTT subscription failed:', subscribeError);
          setError(`Unable to subscribe to ${topic}`);
        }
      });
    });
    client.on('reconnect', () => active && setState('connecting'));
    client.on('offline', () => active && setState('offline'));
    client.on('close', () => active && setState('offline'));
    client.on('error', (connectionError) => {
      console.error('Aquadome MQTT connection error:', connectionError);
      if (active) {
        setState('offline');
        setError(connectionError.message || 'Unable to connect');
      }
    });
    client.on('message', (receivedTopic, payload) => {
      if (!active || receivedTopic !== topic) return;
      const reading = parseSensorPayload(payload.toString());
      if (!reading) {
        console.warn('Ignoring invalid tank sensor payload.');
        return;
      }
      onReadingRef.current(reading);
    });

    return () => {
      active = false;
      client?.end(true);
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [attempt, enabled]);

  return { state, error, reconnect };
}

function App() {
  const [reading, setReading] = useState<SensorReading | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [alarmRinging, setAlarmRinging] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    typeof Notification === 'undefined' ? 'denied' : Notification.permission,
  );
  const [toast, setToast] = useState('');
  const [enabledAlerts, setEnabledAlerts] = useState(false);
  const [alarmReady, setAlarmReady] = useState(false);
  const alertsEnabledRef = useRef(false);
  const alarmAudioRef = useRef<HTMLAudioElement | null>(null);
  const alarmLatchedRef = useRef(false);
  const vibrationTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 5_000);
  }, []);

  const stopAlarm = useCallback(() => {
    setAlarmRinging(false);
    if (alarmAudioRef.current) {
      alarmAudioRef.current.pause();
      alarmAudioRef.current.currentTime = 0;
    }
    if (vibrationTimerRef.current !== null) {
      window.clearInterval(vibrationTimerRef.current);
      vibrationTimerRef.current = null;
    }
    if (alertsEnabledRef.current && 'vibrate' in navigator) navigator.vibrate(0);
  }, []);

  const startAlarm = useCallback(() => {
    if (alarmLatchedRef.current || alarmAudioRef.current?.paused === false) return;
    alarmLatchedRef.current = true;
    try {
      window.localStorage.setItem(alarmCycleKey, 'true');
    } catch (storageError) {
      console.error('Unable to persist the tank alarm cycle:', storageError);
      showToast('Could not save the alarm cycle on this device.');
    }
    setAlarmRinging(true);
    const audio = alarmAudioRef.current;
    if (audio) {
      audio.loop = true;
      void audio.play().catch((playError: unknown) => {
        console.error('Tank alarm audio could not be played:', playError);
        showToast('Tap Enable alerts once to allow sound in this browser.');
      });
    }
    if (alertsEnabledRef.current && 'vibrate' in navigator) {
      navigator.vibrate([700, 250, 700]);
      vibrationTimerRef.current = window.setInterval(() => {
        navigator.vibrate([700, 250, 700]);
      }, 1_650);
    }
  }, [showToast]);

  const onReading = useCallback(
    (nextReading: SensorReading) => {
      setReading(nextReading);
      const level =
        ((EMPTY_DISTANCE - nextReading.distance) / (EMPTY_DISTANCE - FULL_DISTANCE)) * 100;
      if (level <= 0 && alarmLatchedRef.current) {
        alarmLatchedRef.current = false;
        try {
          window.localStorage.setItem(alarmCycleKey, 'false');
        } catch (storageError) {
          console.error('Unable to reset the tank alarm cycle:', storageError);
          showToast('Could not reset the alarm cycle on this device.');
        }
        stopAlarm();
      } else if (level >= 100 && !alarmLatchedRef.current) {
        startAlarm();
      }

      if (
        notificationPermission === 'granted' &&
        document.visibilityState === 'visible' &&
        level >= 90
      ) {
        const content = buildNotificationContent(nextReading.distance, nextReading.updated);
        try {
          new Notification(content.title, { body: content.body, icon: './icon.svg' });
        } catch (notificationError) {
          console.error('Browser notification could not be shown:', notificationError);
          showToast('This browser could not show the tank notification.');
        }
      }
    },
    [notificationPermission, showToast, startAlarm, stopAlarm],
  );

  const { state: connection, error, reconnect } = useTankConnection(onReading, alarmReady);
  const metrics = reading ? getTankMetrics(reading.distance) : null;
  const status = getTankStatus(reading?.distance ?? null, reading?.updated ?? null, now);
  const stale =
    reading !== null && now.getTime() - reading.updated.getTime() > STALE_AFTER_MS;

  useEffect(() => {
    try {
      alarmLatchedRef.current = window.localStorage.getItem(alarmCycleKey) === 'true';
    } catch (storageError) {
      console.error('Unable to load the tank alarm cycle:', storageError);
      showToast('Alarm history could not be loaded on this device.');
    }
    setAlarmReady(true);
    const audio = new Audio(alarmUrl);
    audio.preload = 'auto';
    alarmAudioRef.current = audio;
    const clock = window.setInterval(() => setNow(new Date()), 1_000);
    return () => {
      window.clearInterval(clock);
      stopAlarm();
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
      alarmAudioRef.current = null;
    };
  }, [showToast, stopAlarm]);

  const enableAlerts = async () => {
    if ('Notification' in window) {
      try {
        if (Notification.permission === 'default') {
          setNotificationPermission(await Notification.requestPermission());
        } else {
          setNotificationPermission(Notification.permission);
        }
      } catch (permissionError) {
        console.error('Browser notification permission request failed:', permissionError);
        showToast('This browser could not enable notifications.');
      }
    } else {
      showToast('Browser notifications are not supported on this device.');
    }

    alertsEnabledRef.current = true;
    setEnabledAlerts(true);
    const audio = alarmAudioRef.current;
    if (audio) {
      if (alarmRinging) {
        await audio.play().catch((audioError: unknown) => {
          console.error('Tank alarm audio could not be resumed:', audioError);
          showToast('This browser could not resume alarm audio.');
        });
      } else {
        const volume = audio.volume;
        audio.volume = 0;
        try {
          await audio.play();
          audio.pause();
          audio.currentTime = 0;
        } catch (audioError) {
          console.warn('Browser alarm audio is not available:', audioError);
        } finally {
          audio.volume = volume;
        }
      }
    }
  };

  const handleReconnect = () => {
    reconnect();
  };

  const connectionLabel =
    connection === 'connected' ? 'Connected' : connection === 'connecting' ? 'Connecting' : 'Offline';
  const connectionMessage =
    connection === 'connected'
      ? stale
        ? 'Connected, but no recent sensor data'
        : 'Connected to your tank'
      : error ?? 'Disconnected';

  return (
    <div className="app-shell">
      <header className="app-bar">
        <div className="brand">
          <div className="brand-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 2.5C9.5 6.4 5.5 10.5 5.5 15a6.5 6.5 0 0 0 13 0c0-4.5-4-8.6-6.5-12.5Zm0 16.3a3.8 3.8 0 0 1-3.8-3.8h1.8a2 2 0 0 0 2 2v1.8Z" /></svg>
          </div>
          <span>Aquadome</span>
        </div>
        <div className={`connection-pill ${connection}`} role="status" aria-live="polite">
          <span className="connection-dot" />
          {connectionLabel}
        </div>
      </header>

      <main className="dashboard">
        <p className="eyebrow">YOUR TANK</p>
        <h1>Live water monitoring</h1>

        {alarmRinging && (
          <section className="alarm-banner" role="alert">
            <span className="alarm-icon" aria-hidden="true">♢</span>
            <strong>Tank is full. Alarm is sounding.</strong>
            <button className="text-button" onClick={stopAlarm}>Turn off</button>
          </section>
        )}

        <section className="level-card" aria-label="Water level">
          <div className="card-orb" />
          <div className="level-heading">
            <span className="water-mark" aria-hidden="true">●</span>
            <span>WATER LEVEL</span>
          </div>
          <div className="level-numbers">
            <div className="percent-display">
              <span>{metrics ? metrics.percentText : '—'}</span>
              {metrics && <small>%</small>}
            </div>
            <div className="capacity-display">
              <strong>{metrics ? `${formatLitres(metrics.litres)} L` : '—'}</strong>
              <span>of {formatLitres(TANK_CAPACITY)} L</span>
            </div>
          </div>
          <div
            className="level-track"
            role="progressbar"
            aria-label="Tank fill level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={metrics ? Math.min(100, Math.max(0, metrics.level)) : 0}
          >
            <div
              className="level-fill"
              style={{ width: `${metrics ? Math.min(100, Math.max(0, metrics.level)) : 0}%` }}
            />
          </div>
          <div className="level-status">
            <span className="status-dot" style={{ backgroundColor: reading ? status.color : '#ffffff88' }} />
            <span>{reading ? status.label : 'Waiting for sensor data'}</span>
          </div>
        </section>

        <div className="metrics-row">
          <Metric title="Water" value={metrics ? formatLitres(metrics.litres) : '—'} unit="L" icon="drop" />
          <Metric title="Distance" value={reading ? formatDistance(reading.distance) : '—'} unit="mm" icon="ruler" />
        </div>

        <section className="connection-card">
          <div className={`connection-icon ${connection === 'connected' ? 'is-online' : ''}`}>
            {connection === 'connected' ? <CloudCheck /> : <CloudOff />}
          </div>
          <div className="connection-copy">
            <strong>Connection</strong>
            <span>{connectionMessage}</span>
          </div>
          <div className="connection-actions">
            {!enabledAlerts && (
              <button className="icon-button alert-button" aria-label="Enable alerts" title="Enable alerts" onClick={enableAlerts}>
                <BellIcon />
              </button>
            )}
            <button className="icon-button" aria-label="Reconnect" title="Reconnect" onClick={handleReconnect}>
              <RefreshIcon />
            </button>
          </div>
        </section>

        {reading && (
          <p className={`last-update ${stale ? 'is-stale' : ''}`}>
            Last sensor update · {formatStamp(reading.updated, now)}
          </p>
        )}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

interface MetricProps {
  title: string;
  value: string;
  unit: string;
  icon: 'drop' | 'ruler';
}

function Metric({ title, value, unit, icon }: MetricProps) {
  return (
    <section className="metric-card">
      <div className="metric-icon" aria-hidden="true">
        {icon === 'drop' ? <WaterIcon /> : <RulerIcon />}
      </div>
      <span className="metric-title">{title}</span>
      <div className="metric-value"><strong>{value}</strong><span>{unit}</span></div>
    </section>
  );
}

function WaterIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 2.5C9.5 6.4 5.5 10.5 5.5 15a6.5 6.5 0 0 0 13 0c0-4.5-4-8.6-6.5-12.5Zm0 16.3a3.8 3.8 0 0 1-3.8-3.8h1.8a2 2 0 0 0 2 2v1.8Z" /></svg>;
}

function RulerIcon() {
  return <svg viewBox="0 0 24 24"><path d="m3.5 16.2 12.7-12.7a1.8 1.8 0 0 1 2.6 0l2.1 2.1a1.8 1.8 0 0 1 0 2.6L8.2 20.9a1.8 1.8 0 0 1-2.6 0l-2.1-2.1a1.8 1.8 0 0 1 0-2.6Zm2.1 1.3 1.2 1.2m1.7-4.7 1.5 1.5m1.3-4.7 1.5 1.5m1.3-4.7 1.5 1.5m1.3-4.7 1.2 1.2" /></svg>;
}

function CloudCheck() {
  return <svg viewBox="0 0 24 24"><path d="M7 18h10a4 4 0 0 0 .5-8A5.5 5.5 0 0 0 7 9.3 4.4 4.4 0 0 0 7 18Zm2.5-4.4 1.8 1.8 3.8-4" /></svg>;
}

function CloudOff() {
  return <svg viewBox="0 0 24 24"><path d="m3 3 18 18M7 7.5A5.5 5.5 0 0 1 17.5 10a4 4 0 0 1-.5 8h-5M7 9.3A4.4 4.4 0 0 0 7 18h2" /></svg>;
}

function RefreshIcon() {
  return <svg viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5m10.2-2A7.5 7.5 0 0 0 6.1 6.1L4 8m16 8-2.1 1.9A7.5 7.5 0 0 1 4.8 14" /></svg>;
}

function BellIcon() {
  return <svg viewBox="0 0 24 24"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-8 13h4" /></svg>;
}

export default App;
