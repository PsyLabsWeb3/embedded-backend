import express from 'express'
import { prisma } from '../prisma'

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

export default router