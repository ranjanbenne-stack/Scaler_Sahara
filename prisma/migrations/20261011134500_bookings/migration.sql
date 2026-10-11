-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "bookedById" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "serviceLabel" TEXT NOT NULL,
    "helperLabel" TEXT NOT NULL,
    "visitLabel" TEXT NOT NULL,
    "estimatedCostInr" INTEGER NOT NULL,
    "includes" TEXT NOT NULL,
    "question" TEXT,
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "bookings_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bookings_bookedById_fkey" FOREIGN KEY ("bookedById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_requestId_key" ON "bookings"("requestId");
