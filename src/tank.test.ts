import { describe, expect, it } from 'vitest';
import {
  buildNotificationContent,
  getTankMetrics,
  getTankStatus,
  parseSensorPayload,
  parseTimestamp,
} from './tank';

describe('tank calculations', () => {
  it('converts a reading into the same level and volume as the Flutter app', () => {
    expect(getTankMetrics(650)).toMatchObject({
      percent: 57,
      litres: 1145.8333333333333,
      percentText: '57',
    });
    expect(getTankMetrics(200)).toMatchObject({ percent: 104, litres: 2000, percentText: '>100' });
  });

  it('handles timestamp seconds, milliseconds, invalid clocks, and future clocks', () => {
    const now = new Date('2026-10-07T14:11:00');
    expect(parseTimestamp(1791382260, now)?.getFullYear()).toBe(2026);
    expect(parseTimestamp(now.getTime(), now)?.getTime()).toBe(now.getTime());
    expect(parseTimestamp('not a timestamp', now)).toBeNull();
    expect(parseTimestamp(1, now)).toBeNull();
    expect(parseTimestamp(now.getTime() + 60_000, now)?.getTime()).toBe(now.getTime());
  });

  it('rejects invalid readings and accepts numeric strings', () => {
    expect(parseSensorPayload('{"distance_mm":"650"}')?.distance).toBe(650);
    expect(parseSensorPayload('{"distance_mm":0}')).toBeNull();
    expect(parseSensorPayload('{"distance_mm":"NaN"}')).toBeNull();
    expect(parseSensorPayload('not json')).toBeNull();
  });

  it('applies rounded status thresholds and stale-reading behavior', () => {
    const now = new Date();
    expect(getTankStatus(1020, now, now).label).toBe('Tank critically low');
    expect(getTankStatus(337, now, now).label).toBe('Tank almost full');
    expect(getTankStatus(200, now, now).label).toBe('Above full capacity');
    expect(getTankStatus(650, new Date(now.getTime() - 121_000), now).label).toBe(
      'No recent sensor data',
    );
  });

  it('composes browser alert content using the tank thresholds', () => {
    const updated = new Date('2026-10-07T14:11:00');
    expect(buildNotificationContent(1020, updated)).toMatchObject({
      title: 'Tank critically low',
      body: expect.stringContaining('375 L remaining — 19% full.'),
    });
    expect(buildNotificationContent(240, updated)).toMatchObject({
      title: 'Tank full',
      body: expect.stringContaining('100% full — 2,000 L of 2,000 L.'),
    });
  });
});
