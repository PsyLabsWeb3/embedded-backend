import express from 'express'
import { prisma } from '../prisma'
import { verifySignature } from '../middleware/verifySignature'

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