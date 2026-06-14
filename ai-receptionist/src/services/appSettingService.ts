import { prisma } from "../db/client";

// The AppSetting table is reached via a cast so the build type-checks before the
// migration regenerates the Prisma client; after `prisma generate` it's the normal
// client.
const db = prisma as any;

/** Read a single setting's value, or null if unset. */
export async function getAppSetting(key: string): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key } });
  return row ? (row.value as string) : null;
}

/** Create or update a single setting. */
export async function setAppSetting(key: string, value: string): Promise<void> {
  await db.appSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}
