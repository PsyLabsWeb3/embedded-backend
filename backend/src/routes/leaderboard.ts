import express from 'express'
import { prisma } from '../prisma'

const router = express.Router()

router.get('/leaderboard', async (req, res) => {
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

    res.json(leaderboard);
  } catch (err) {
    console.error('Error fetching leaderboard:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

export default router