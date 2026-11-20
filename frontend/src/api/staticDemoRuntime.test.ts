import test from 'node:test';
import assert from 'node:assert/strict';
import { handleStaticDemoRequest, resetStaticDemoState } from './staticDemoRuntime';
import type { Station, TimeSlot } from '../types';

test('static demo runtime supports demo login and all 12 Delhi-NCR stations with chargers', () => {
  resetStaticDemoState();

  const auth = handleStaticDemoRequest('POST', '/auth/login', {}, {
    email: 'driver@chargekaro.demo',
    password: 'Driver@123!',
  }) as { access_token: string; user: { role: string } };

  assert.equal(auth.user.role, 'driver');
  assert.ok(auth.access_token.startsWith('ck-demo-token-'));

  const stations = handleStaticDemoRequest('GET', '/stations', {
    lat: 28.6315,
    lng: 77.2167,
    sort: 'nearest',
  }) as Station[];

  assert.equal(stations.length, 12);
  assert.ok(stations.every((s) => s.chargers.length >= 3));
});

test('static demo runtime prevents double booking on overlapping slot', () => {
  resetStaticDemoState();
  const auth = handleStaticDemoRequest('POST', '/auth/login', {}, {
    email: 'driver@chargekaro.demo',
    password: 'Driver@123!',
  }) as { access_token: string };

  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const avail = handleStaticDemoRequest('GET', '/bookings/availability/2', {
    target_date: tomorrow,
  }) as { slots: TimeSlot[] };

  const freeSlot = avail.slots.find((s) => s.available);
  assert.ok(freeSlot);

  const created = handleStaticDemoRequest(
    'POST',
    '/bookings',
    {},
    {
      charger_id: 2,
      vehicle_id: 1,
      start_time: freeSlot.start_time,
      duration_minutes: 30,
      payment_method: 'MOCK_UPI',
    },
    `Bearer ${auth.access_token}`
  ) as { id: number; status: string };

  assert.equal(created.status, 'CONFIRMED');

  assert.throws(
    () =>
      handleStaticDemoRequest(
        'POST',
        '/bookings',
        {},
        {
          charger_id: 2,
          vehicle_id: 1,
          start_time: freeSlot.start_time,
          duration_minutes: 30,
          payment_method: 'MOCK_UPI',
        },
        `Bearer ${auth.access_token}`
      ),
    /overlaps/i
  );
});
