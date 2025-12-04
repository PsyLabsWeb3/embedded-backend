import express from 'express'
import { prisma } from '../prisma'
import fs from 'fs'
import path from 'path'
import { PublicKey } from '@solana/web3.js'
import { getProviderAndProgram, LAMPORTS } from '../middleware/solanaUtils'

const router = express.Router()

let cachedLeaderboard: {
  position: number;
  walletAddress: string;
  points: number;
}[] | null = null;

let lastFetched = 0;

router.get('/leaderboard', async (req, res) => {
  try {
    const now = Date.now();

    if (!cachedLeaderboard || now - lastFetched > 30000) {
      cachedLeaderboard = await fetchLeaderboardFromDB();

      if (!cachedLeaderboard) {
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
        return;
      }

      lastFetched = now;
    }

    res.json(cachedLeaderboard);
  } catch (err) {
    console.error('Unexpected error in /leaderboard:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

async function fetchLeaderboardFromDB() {
  try {
    const rawLeaderboard = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        RANK() OVER (ORDER BY points DESC) AS position,
        address AS "walletAddress",
        points
      FROM "Wallet"
      WHERE points > 0
      ORDER BY points DESC
      LIMIT 500
    `);

    const leaderboard = rawLeaderboard.map((row) => ({
      position: Number(row.position),
      walletAddress: row.walletAddress,
      points: Number(row.points),
    }));

    return leaderboard;
  } catch (err) {
    console.error('Error fetching leaderboard:', err);
    return null;
  }
}

router.get('/matchHistory', /* verifySignature, */ async (req, res): Promise<any> => {
  const walletAddress = req.query.walletAddress as string;

  if (!walletAddress) {
    return res.status(400).json({ error: 'Missing wallet address' });
  }

  try {
    const wallet = await prisma.wallet.findUnique({
      where: { address: walletAddress },
      select: {
        id: true,
        points: true,
      },
    });

    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const matches = await prisma.match.findMany({
      where: {
        status: 'FINISHED',
        OR: [
          { walletA: { address: walletAddress } },
          { walletB: { address: walletAddress } }
        ]
      },
      select: {
        matchId: true,
        startedAt: true,
        winnerWallet: { select: { address: true } },
        walletA: { select: { address: true } },
        walletB: { select: { address: true } },
        game: true,
        mode: true,
        betAmount: true,
        matchFee: true,
      },
      orderBy: { startedAt: 'desc' },
      take: 50
    });

    const history = matches.map(match => {
      const opponent = match.mode === 'PVE'
      ? 'Environment'
      : match.walletA.address === walletAddress
          ? match.walletB?.address
          : match.walletA?.address;

      const result = match.mode === 'PVE' || match.winnerWallet?.address === walletAddress ? 'WIN' : 'LOSS';

      const mode = match.mode === 'CASUAL' ? 'Casual' : match.mode === 'PVE' ? 'PvE' : 'Betting';

      let amount;
      if(match.mode === 'PVE') {
        amount = 1;
      } else {
        amount = result === 'LOSS'
          ? Number(match.betAmount)
          : (Number(match.betAmount) * 2) - (Number(match.matchFee) * 2);
      }
      
      const formattedAmount = Number(amount).toFixed(2);

      return {
        matchId: match.matchId,
        game: match.game,
        mode,
        opponent,
        result,
        amount: formattedAmount,
        matchDate: match.startedAt,
      };
    });

    res.json({
      wallet: walletAddress,
      points: wallet.points,
      history,
    });
  } catch (err) {
    console.error('[matchHistory] Error:', err);
    res.status(500).json({ error: 'Failed to fetch match history' });
  }
});

export default router

export async function generateAirdropCsv(season: number): Promise<string> {
  if (typeof season !== 'number' || !Number.isInteger(season)) {
    throw new Error('generateAirdropCsv requires a numeric integer `season` argument');
  }

  // Load leaderboard
  const leaderboard = await fetchLeaderboardFromDB();
  if (!leaderboard || leaderboard.length === 0) {
    throw new Error('No leaderboard data available');
  }

  // Load owner config
  const ownerConfigPath = path.resolve(__dirname, '..', '..', 'owners.json');
  if (!fs.existsSync(ownerConfigPath)) {
    throw new Error(`Owner config file not found at ${ownerConfigPath}`);
  }
  const ownerConfig = JSON.parse(fs.readFileSync(ownerConfigPath, 'utf8'));
  if (!ownerConfig.owners || !Array.isArray(ownerConfig.owners)) {
    throw new Error('Invalid owner config: missing owners array');
  }

  // Validate owner percentages sum to 100
  const totalPercentage = ownerConfig.owners.reduce((acc: number, o: any) => acc + o.percentage, 0);
  if (Math.abs(totalPercentage - 100) > 0.01) {
    throw new Error(`Owner percentages must sum to 100, got ${totalPercentage}`);
  }

  // Fetch on-chain treasury balance
  const ANCHOR_PROGRAM_ID = new PublicKey(process.env.ANCHOR_PROGRAM_ID!);
  const { provider } = getProviderAndProgram();
  const [treasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("treasury")], ANCHOR_PROGRAM_ID);

  const lamports = await provider.connection.getBalance(treasuryPda);
  const treasurySol = Number(lamports) / Number(LAMPORTS);
  console.log(`Treasury SOL Balance: ${treasurySol}`);

  const amountToDistributePlayers = treasurySol * 0.2; // 20% for players
  const amountToDistributeOwners = treasurySol - amountToDistributePlayers; // 80% for owners
  console.log(`Amount to distribute to players: ${amountToDistributePlayers} SOL`);
  console.log(`Amount to distribute to owners: ${amountToDistributeOwners} SOL`);

  const totalPoints = leaderboard.reduce((acc, p) => acc + Number(p.points), 0);
  if (totalPoints <= 0) {
    throw new Error('Total leaderboard points is zero');
  }
  console.log(`Total leaderboard points: ${totalPoints}`);

  // Compute per-player amounts
  const playerRows = leaderboard.map((p) => {
    const share = (Number(p.points) / totalPoints) * amountToDistributePlayers;
    return {
      position: p.position,
      walletAddress: p.walletAddress,
      points: p.points,
      amount: Number(share.toFixed(9)),
    };
  });

  // Compute per-owner amounts
  const ownerRows = ownerConfig.owners.map((owner: any) => {
    const amount = (owner.percentage / 100) * amountToDistributeOwners;
    return {
      walletAddress: owner.walletAddress,
      percentage: owner.percentage,
      amount: Number(amount.toFixed(9)),
    };
  }) as Array<{ walletAddress: string; percentage: number; amount: number }>;

  const airdropsDir = path.resolve(__dirname, '..', '..', 'airdrops');
  if (!fs.existsSync(airdropsDir)) {
    fs.mkdirSync(airdropsDir, { recursive: true });
  }

  const airdropFolderName = `airdrop_season_${season}`;
  const airdropFolderPath = path.join(airdropsDir, airdropFolderName);

  if (!fs.existsSync(airdropFolderPath)) {
    fs.mkdirSync(airdropFolderPath, { recursive: true });
  }

  // Write players CSV
  const playerFilePath = path.join(airdropFolderPath, 'players.csv');
  const playerHeader = 'position,walletAddress,points,amount_sol\n';
  const playerCsvLines = playerRows.map(r => `${r.position},${r.walletAddress},${r.points},${r.amount}`);
  const playerCsv = playerHeader + playerCsvLines.join('\n') + '\n';
  fs.writeFileSync(playerFilePath, playerCsv, { encoding: 'utf8' });

  // Write owners CSV
  const ownerFilePath = path.join(airdropFolderPath, 'owners.csv');
  const ownerHeader = 'walletAddress,percentage,amount_sol\n';
  const ownerCsvLines = ownerRows.map((r: { walletAddress: string; percentage: number; amount: number }) => `${r.walletAddress},${r.percentage},${r.amount}`);
  const ownerCsv = ownerHeader + ownerCsvLines.join('\n') + '\n';
  fs.writeFileSync(ownerFilePath, ownerCsv, { encoding: 'utf8' });

  // At this point files were written successfully -> persist season results and reset points
  try {
    // Consider ALL wallets that currently have points (not just the top 500)
    const walletsWithPoints = await prisma.wallet.findMany({
      where: { points: { gt: 0 } },
      select: { id: true, address: true, points: true },
    });

    const seasonRows = walletsWithPoints.map(w => ({
      season,
      walletId: w.id,
      points: w.points,
    }));

    // Persist season results and reset points in a transaction
    await prisma.$transaction([
      prisma.seasonResult.createMany({ data: seasonRows, skipDuplicates: true }),
      prisma.wallet.updateMany({ where: { points: { gt: 0 } }, data: { points: 0 } }),
    ]);
  } catch (err) {
    console.error('Failed to persist season results or reset wallet points:', err);
    throw err;
  }

  return airdropFolderPath;
}