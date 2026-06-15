// Booking availability configuration — the inputs the slot-finder needs:
// weekly open hours, appointment durations (a default + optional per-service
// overrides), and a buffer between appointments. Stored as JSON on the Tenant
// (`bookingConfig`), mirroring how `theme`/`labels` already live there. An empty
// {} means "use the baked-in defaults", so availability works before a business
// configures anything. The hours/duration EDITOR is a later batch — this module
// only defines the shape, the defaults, and how to read them.

import { prisma } from "../db/client";

export interface OpenWindow {
  start: string; // "HH:MM" (24h, wall-clock)
  end: string;   // "HH:MM"
}

export interface BookingConfig {
  hours: Record<string, OpenWindow[]>; // keys: sun..sat -> open windows that day
  defaultDurationMin: number;          // appointment length when a service has none
  bufferMin: number;                   // gap padded around each existing appointment
  serviceDurations: Record<string, number>; // subtypeKey -> minutes (override)
}

// Weekday keys, indexed to match JavaScript's Date.getUTCDay() (0=Sunday).
export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

// Baked-in defaults: open Mon–Fri 9:00–17:00, 30-minute appointments, no buffer.
export const DEFAULT_BOOKING_CONFIG: BookingConfig = {
  hours: {
    sun: [],
    mon: [{ start: "09:00", end: "17:00" }],
    tue: [{ start: "09:00", end: "17:00" }],
    wed: [{ start: "09:00", end: "17:00" }],
    thu: [{ start: "09:00", end: "17:00" }],
    fri: [{ start: "09:00", end: "17:00" }],
    sat: [],
  },
  defaultDurationMin: 30,
  bufferMin: 0,
  serviceDurations: {},
};

function posInt(v: any, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
function nonNegInt(v: any, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** Merge a raw stored config (possibly {} or partial) over the defaults. Pure. */
export function mergeBookingConfig(raw: any): BookingConfig {
  const c = raw && typeof raw === "object" ? raw : {};
  const hours: Record<string, OpenWindow[]> = {};
  for (const k of WEEKDAY_KEYS) {
    const src = c.hours && Array.isArray(c.hours[k]) ? c.hours[k] : DEFAULT_BOOKING_CONFIG.hours[k];
    hours[k] = (src || [])
      .filter((w: any) => w && typeof w.start === "string" && typeof w.end === "string")
      .map((w: any) => ({ start: w.start, end: w.end }));
  }
  return {
    hours,
    defaultDurationMin: posInt(c.defaultDurationMin, DEFAULT_BOOKING_CONFIG.defaultDurationMin),
    bufferMin: nonNegInt(c.bufferMin, DEFAULT_BOOKING_CONFIG.bufferMin),
    serviceDurations:
      c.serviceDurations && typeof c.serviceDurations === "object" ? c.serviceDurations : {},
  };
}

/** Read a tenant's booking config, merged over the defaults. */
export async function loadBookingConfig(tenantId: string): Promise<BookingConfig> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const raw = (t as any)?.bookingConfig ?? {};
  return mergeBookingConfig(raw);
}

/** Duration (minutes) for a service/subtype: its override if set, else the default. */
export function durationForService(config: BookingConfig, serviceKey?: string | null): number {
  if (serviceKey && Number(config.serviceDurations[serviceKey]) > 0) {
    return Math.floor(Number(config.serviceDurations[serviceKey]));
  }
  return config.defaultDurationMin;
}
