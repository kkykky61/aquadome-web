import { describe, expect, it } from 'vitest';
import {
  advanceTankNotificationCycle,
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

  it('notifies once at each level status and re-arms after leaving its threshold', () => {
    let cycle = {
      emptyLatched: false,
      criticalLowLatched: false,
      almostFullLatched: false,
      fullLatched: false,
    };
    const advance = (level: number) => {
      const result = advanceTankNotificationCycle(cycle, level, true);
      cycle = result.cycle;
      return result.notification;
    };

    expect(advance(0)).toBe('empty');
    expect(advance(0)).toBeNull();
    expect(advance(1)).toBe('critical-low');
    expect(advance(10)).toBeNull();
    expect(advance(21)).toBeNull();
    expect(advance(20)).toBe('critical-low');
    expect(advance(89)).toBeNull();
    expect(advance(90)).toBe('almost-full');
    expect(advance(95)).toBeNull();
    expect(advance(100)).toBe('full');
    expect(advance(101)).toBeNull();
    expect(advance(99)).toBeNull();
    expect(advance(100)).toBe('full');
    expect(advance(99)).toBeNull();
    expect(advance(89)).toBeNull();
    expect(advance(90)).toBe('almost-full');
    expect(advance(95)).toBeNull();
    expect(advance(89)).toBeNull();
    expect(advance(90)).toBe('almost-full');
    expect(advance(0)).toBe('empty');
  });

  it('does not latch a threshold while notifications are disabled', () => {
    const cycle = {
      emptyLatched: false,
      criticalLowLatched: false,
      almostFullLatched: false,
      fullLatched: false,
    };

    expect(advanceTankNotificationCycle(cycle, 100, false)).toMatchObject({
      cycle: {
        emptyLatched: false,
        criticalLowLatched: false,
        almostFullLatched: false,
        fullLatched: false,
      },
      notification: null,
    });
    expect(advanceTankNotificationCycle(cycle, 100, true).notification).toBe('full');
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
