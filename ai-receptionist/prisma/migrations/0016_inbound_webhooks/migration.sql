-- CreateTable
CREATE TABLE "InboundEndpoint" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundCall" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "contactId" TEXT,
    "sourceIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboundEndpoint_token_key" ON "InboundEndpoint"("token");

-- CreateIndex
CREATE INDEX "InboundEndpoint_tenantId_idx" ON "InboundEndpoint"("tenantId");

-- CreateIndex
CREATE INDEX "InboundCall_tenantId_createdAt_idx" ON "InboundCall"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "InboundCall_endpointId_createdAt_idx" ON "InboundCall"("endpointId", "createdAt");

-- AddForeignKey
ALTER TABLE "InboundEndpoint" ADD CONSTRAINT "InboundEndpoint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundCall" ADD CONSTRAINT "InboundCall_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundCall" ADD CONSTRAINT "InboundCall_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "InboundEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
