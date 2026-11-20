import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatInr,
  getStationMarkerColor,
  getStatusLabel,
  isFreeCancellationEligible,
} from './stationHelpers';
import type { Charger } from '../types';

const makeCharger = (id: number, status: Charger['status']): Charger => ({
  id,
  station_id: 1,
  label: `Charger ${id}`,
  connector_type: 'CCS2',
  power_kw: 60,
  price_per_kwh: 18,
  status,
  last_updated: '2026-11-18T10:00:00Z',
  flap_count: 0,
});

test('getStationMarkerColor reflects free, limited, busy, and offline states', () => {
  assert.equal(getStationMarkerColor([makeCharger(1, 'OFFLINE'), makeCharger(2, 'OFFLINE')]), 'grey');
  assert.equal(getStationMarkerColor([makeCharger(1, 'OCCUPIED'), makeCharger(2, 'BOOKED')]), 'red');
  assert.equal(
    getStationMarkerColor([makeCharger(1, 'FREE'), makeCharger(2, 'OCCUPIED'), makeCharger(3, 'OCCUPIED'), makeCharger(4, 'OCCUPIED')]),
    'amber'
  );
  assert.equal(
    getStationMarkerColor([makeCharger(1, 'FREE'), makeCharger(2, 'FREE'), makeCharger(3, 'OCCUPIED')]),
    'green'
  );
});

test('isFreeCancellationEligible enforces 15-minute threshold', () => {
  const now = new Date('2026-11-18T12:00:00Z').getTime();
  assert.equal(isFreeCancellationEligible('2026-11-18T12:20:00Z', now), true);
  assert.equal(isFreeCancellationEligible('2026-11-18T12:15:00Z', now), true);
  assert.equal(isFreeCancellationEligible('2026-11-18T12:10:00Z', now), false);
});

test('formatInr and getStatusLabel format cleanly', () => {
  assert.equal(formatInr(150), '₹150');
  assert.equal(getStatusLabel('FREE'), 'Free');
  assert.equal(getStatusLabel('OFFLINE'), 'Offline');
});
