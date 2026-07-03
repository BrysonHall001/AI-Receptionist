// Seeds a sim tenant (Alice + Bob) with a taken 2 PM on Mon 2026-06-22.
import { prisma, disconnectDb } from "./client";
import { createRecord } from "../services/recordService";
import { BOOKING_RECORD_TYPE_KEY } from "../services/recordTypeService";

const db = prisma as any;

async function main() {
  const to = process.env.TWILIO_PHONE_NUMBER;          // the number the simulator calls
  if (!to) throw new Error("set TWILIO_PHONE_NUMBER first");
  await db.tenant.deleteMany({ where: { name: "__SIM_AVAIL__" } });
  const win = [{ start: "09:00", end: "17:00" }];
  const t = await db.tenant.create({
    data: {
      billingStatus: "trial",
      name: "__SIM_AVAIL__",
      businessType: "salon",
      notifyEmail: "sim@example.invalid",
      phoneNumber: to,
      bookingConfig: { hours: { sun: win, mon: win, tue: win, wed: win, thu: win, fri: win, sat: win }, defaultDurationMin: 30, bufferMin: 0, serviceDurations: {}, allowDoubleBooking: false },
    },
  });
  await db.recordType.create({
    data: { tenantId: t.id, key: BOOKING_RECORD_TYPE_KEY, label: "Booking", recordStages: [{ key: "requested", label: "Requested", order: 0 }, { key: "no_show", label: "No-show", order: 1 }], subtypes: [] },
  });
  await db.resource.create({ data: { tenantId: t.id, name: "Bob", color: "#111111", order: 0 } });
  await db.resource.create({ data: { tenantId: t.id, name: "Alice", color: "#222222", order: 1 } });
  await createRecord(t.id, BOOKING_RECORD_TYPE_KEY, { title: "seed", stageKey: "requested", appointmentAt: "2026-06-22T14:00", resourceId: null }, { source: "manual" });
  console.log("seeded tenant", t.id, "-> number", to);
  await disconnectDb();
}

main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
