-- CreateTable
CREATE TABLE "EntryFeeTransaction" (
    "id" SERIAL NOT NULL,
    "txSig" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntryFeeTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EntryFeeTransaction_txSig_key" ON "EntryFeeTransaction"("txSig");
