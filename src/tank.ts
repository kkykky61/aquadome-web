export const TANK_CAPACITY = 2000;
export const EMPTY_DISTANCE = 1200;
export const FULL_DISTANCE = 240;
export const STALE_AFTER_MS = 2 * 60 * 1000;

export interface SensorReading {
  distance: number;
  updated: Date;
}

export interface TankMetrics {
  level: number;
  percent: number;
  litres: number;
  percentText: string;
}

export interface TankStatus {
  label: string;
  color: string;
}

export interface TankNotificationCycle {
  emptyLatched: boolean;
  criticalLowLatched: boolean;
  almostFullLatched: boolean;
  fullLatched: boolean;
}

export type TankNotificationKind = 'empty' | 'critical-low' | 'almost-full' | 'full';

export function advanceTankNotificationCycle(
  cycle: TankNotificationCycle,
  level: number,
  notificationsEnabled: boolean,
): { cycle: TankNotificationCycle; notification: TankNotificationKind | null } {
  const nextCycle = {
    emptyLatched: level <= 0 && cycle.emptyLatched,
    criticalLowLatched: level > 0 && level <= 20 && cycle.criticalLowLatched,
    almostFullLatched: level >= 90 && cycle.almostFullLatched,
    fullLatched: level >= 100 && cycle.fullLatched,
  };

  if (!notificationsEnabled) return { cycle: nextCycle, notification: null };

  if (level <= 0 && !nextCycle.emptyLatched) {
    nextCycle.emptyLatched = true;
    return { cycle: nextCycle, notification: 'empty' };
  }
  if (level > 0 && level <= 20 && !nextCycle.criticalLowLatched) {
    nextCycle.criticalLowLatched = true;
    return { cycle: nextCycle, notification: 'critical-low' };
  }
  if (level >= 100) {
    nextCycle.almostFullLatched = true;
    if (!nextCycle.fullLatched) {
      nextCycle.fullLatched = true;
      return { cycle: nextCycle, notification: 'full' };
    }
  } else if (level >= 90 && !nextCycle.almostFullLatched) {
    nextCycle.almostFullLatched = true;
    return { cycle: nextCycle, notification: 'almost-full' };
  }

  return { cycle: nextCycle, notification: null };
}

export function toFiniteNumber(value: unknown): number | null {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
      ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

export function parseTimestamp(value: unknown, now = new Date()): Date | null {
  const timestamp = toFiniteNumber(value);
  if (timestamp === null) return null;
  const milliseconds = timestamp > 100_000_000_000 ? timestamp : timestamp * 1000;
  const parsed = new Date(milliseconds);
  if (!Number.isFinite(parsed.getTime()) || parsed.getFullYear() < 2020) return null;
  return parsed > now ? now : parsed;
}

export function parseSensorPayload(payload: string, now = new Date()): SensorReading | null {
  try {
    const value: unknown = JSON.parse(payload);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const data = value as Record<string, unknown>;
    const distance = toFiniteNumber(data.distance_mm);
    if (distance === null || distance <= 0) return null;
    return {
      distance,
      updated: parseTimestamp(data.ts, now) ?? now,
    };
  } catch {
    return null;
  }
}

export function getTankMetrics(distance: number): TankMetrics {
  const level = Math.max(
    0,
    ((EMPTY_DISTANCE - distance) / (EMPTY_DISTANCE - FULL_DISTANCE)) * 100,
  );
  return {
    level,
    percent: Math.round(level),
    litres: Math.min(TANK_CAPACITY, Math.max(0, (TANK_CAPACITY * level) / 100)),
    percentText: level > 100 ? '>100' : `${Math.round(level)}`,
  };
}

export function getTankStatus(
  distance: number | null,
  updated: Date | null,
  now = new Date(),
): TankStatus {
  if (distance === null || updated === null) {
    return { label: 'Waiting for data', color: '#8e8e93' };
  }
  if (now.getTime() - updated.getTime() > STALE_AFTER_MS) {
    return { label: 'No recent sensor data', color: '#8e8e93' };
  }

  const { level, percent } = getTankMetrics(distance);
  if (percent <= 0) return { label: 'Tank empty', color: '#e53935' };
  if (percent <= 20) return { label: 'Tank critically low', color: '#fb8c00' };
  if (level > 100) return { label: 'Above full capacity', color: '#00c853' };
  if (percent >= 100) return { label: 'Tank full', color: '#00c853' };
  if (percent >= 90) return { label: 'Tank almost full', color: '#00bfa5' };
  return { label: 'Normal', color: '#1e9bff' };
}

export function formatLitres(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

export function formatDistance(value: number): string {
  return Number.isInteger(value) ? `${value}` : `${value}`;
}

export function formatElapsed(updated: Date, now = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - updated.getTime()) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function formatStamp(updated: Date, now = new Date()): string {
  const isToday =
    updated.getFullYear() === now.getFullYear() &&
    updated.getMonth() === now.getMonth() &&
    updated.getDate() === now.getDate();
  const date = isToday
    ? ''
    : `${updated.getDate()} ${updated.toLocaleString('en-US', { month: 'short' })}, `;
  const time = updated.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${date}${time} · ${formatElapsed(updated, now)}`;
}

export function buildNotificationContent(
  distance: number,
  updated: Date,
): { title: string; body: string } {
  const { level, percent, litres, percentText } = getTankMetrics(distance);
  const title =
    level <= 0
      ? 'Tank empty'
      : level <= 20
        ? 'Tank critically low'
        : level >= 100
          ? 'Tank full'
          : percent >= 90
            ? 'Tank almost full'
            : 'Tank level update';
  const date = updated.toLocaleDateString('en-CA');
  const time = updated.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const water =
    level >= 90
      ? `${percentText}% full — ${formatLitres(litres)} L of ${formatLitres(TANK_CAPACITY)} L.`
      : `${formatLitres(litres)} L remaining — ${percentText}% full.`;
  return { title, body: `${water} Sensor update: ${date} ${time}.` };
}
