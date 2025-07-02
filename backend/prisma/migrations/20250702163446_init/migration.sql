-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'FINISHED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Wallet" (
    "id" SERIAL NOT NULL,
    "address" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" SERIAL NOT NULL,
    "matchId" TEXT NOT NULL,
    "walletAId" INTEGER NOT NULL,
    "walletBId" INTEGER,
    "winnerId" INTEGER,
    "txSigA" TEXT NOT NULL,
    "txSigB" TEXT,
    "status" "MatchStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonResult" (
    "id" SERIAL NOT NULL,
    "season" INTEGER NOT NULL,
    "walletId" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeasonResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_address_key" ON "Wallet"("address");

-- CreateIndex
CREATE UNIQUE INDEX "Match_matchId_key" ON "Match"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonResult_season_walletId_key" ON "SeasonResult"("season", "walletId");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_walletAId_fkey" FOREIGN KEY ("walletAId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_walletBId_fkey" FOREIGN KEY ("walletBId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonResult" ADD CONSTRAINT "SeasonResult_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
