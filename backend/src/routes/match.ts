import express from 'express'
import { prisma } from '../prisma'
import { verifySignature } from '../middleware/verifySignature'

const router = express.Router()

// GET /matchesInProgress
router.get('/matchesInProgress', async (req, res): Promise<any> => {
  try {
    const matchesInProgress = await prisma.match.count({
      where: { status: 'IN_PROGRESS' },
    });

    res.json({ matchesInProgress });
  } catch (err) {
    console.error('[matchesInProgress] Error:', err);
    res.status(500).json({ error: 'Failed to fetch matches in progress' });
  }
})

// POST /registerPlayer
router.post('/registerPlayer', verifySignature, async (req, res): Promise<any> => {
  console.log('/registerPlayer received body:', req.body);

  const { walletAddress, txSignature, game, mode, betAmount, matchFee } = req.body

  if (!walletAddress || !txSignature || !game)
    return res.status(400).json({ error: 'Missing walletAddress, txSignature or game' })

  if (mode && !['Casual', 'Betting'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid game mode' });
  }

  if (mode && mode === "Betting") {
    if (!betAmount || isNaN(betAmount) || betAmount <= 0)
      return res.status(400).json({ error: 'Invalid bet amount' });

    if (!matchFee || isNaN(matchFee) || matchFee < 0)
      return res.status(400).json({ error: 'Invalid match fee' });
  }

  let wallet = await prisma.wallet.findUnique({ where: { address: walletAddress } })
  if (!wallet) {
    wallet = await prisma.wallet.create({ data: { address: walletAddress } })
  }

  try {
    const match = await prisma.$transaction(async (tx) => {
      const openMatch = await tx.match.findFirst({
        where: { status: 'WAITING', walletBId: null, game: game },
        orderBy: { createdAt: 'asc' },
      });

      if (openMatch) {
        return await tx.match.update({
          where: { id: openMatch.id },
          data: {
            walletB: { connect: { id: wallet.id } },
            txSigB: txSignature,
            status: 'IN_PROGRESS',
            startedAt: new Date()
          }
        });
      } else {
        const matchId = crypto.randomUUID();
        return await tx.match.create({
          data: {
            matchId,
            walletA: { connect: { id: wallet.id } },
            txSigA: txSignature,
            game: game,
            mode: mode || 'Casual',
            betAmount: betAmount || 0.50,
            matchFee: matchFee || 0.10,
            status: 'WAITING'
          }
        });
      }
    });

    res.json({ matchId: match.matchId });
  } catch (err) {
    console.error('[registerPlayer] Error:', err);
    res.status(500).json({ error: 'Failed to register player' });
  }
})

// POST /matchJoin
router.post('/matchJoin', verifySignature, async (req, res): Promise<any> => {
  console.log('/matchJoin received body:', req.body);

  const { matchID, walletAddress } = req.body;
  if (!matchID || !walletAddress)
    return res.status(400).json({ error: "Invalid payload" });

  try {
    const match = await prisma.match.findUnique({
      where: { matchId: matchID },
      include: { walletA: true, walletB: true }
    });

    if (!match)
      return res.status(404).json({ error: "Match not found" });

    let update: any = {};
    const now = new Date();

    if (match.walletA?.address === walletAddress) {
      update.walletAJoined = now;
    } else if (match.walletB?.address === walletAddress) {
      update.walletBJoined = now;
    } else {
      return res.status(400).json({ error: "Wallet is not a participant in this match" });
    }

    await prisma.match.update({
      where: { matchId: matchID },
      data: update
    });

    console.log(`Wallet ${walletAddress} joined match ${matchID} in Photon`);
    res.json({ message: "Join recorded" });
  } catch (err) {
    console.error('[matchJoin] Error:', err);
    res.status(500).json({ error: 'Failed to record join' });
  }
});

// POST /matchComplete
router.post('/matchComplete', verifySignature, async (req, res): Promise<any> => {
  console.log('/matchComplete received body:', req.body);

  const { matchID, winnerWallet } = req.body

  if (!matchID || !winnerWallet)
    return res.status(400).json({ error: 'Missing params' })

  try {
    await prisma.$transaction(async (tx) => {
      const match = await tx.match.findFirst({
        where: { matchId: matchID, status: 'IN_PROGRESS' },
        include: { walletA: true, walletB: true }
      });

      if (!match)
        throw new Error('Match not found or already completed');

      const walletA = match.walletA?.address;
      const walletB = match.walletB?.address;

      if (![walletA, walletB].includes(winnerWallet))
        throw new Error('Wallet is not a participant in this match');

      const loserWallet = winnerWallet === walletA ? walletB : walletA;
      if (!loserWallet)
        throw new Error('Match has only one participant');

      const [winner, loser] = await Promise.all([
        tx.wallet.findUnique({ where: { address: winnerWallet } }),
        tx.wallet.findUnique({ where: { address: loserWallet } }),
      ]);

      if (!winner || !loser)
        throw new Error('Could not find both wallets');

      await tx.match.update({
        where: { id: match.id },
        data: {
          winnerWallet: { connect: { id: winner.id } },
          status: 'FINISHED',
          endedAt: new Date()
        }
      });

      await tx.wallet.update({
        where: { id: winner.id },
        data: { points: { increment: 2 } }
      });

      await tx.wallet.update({
        where: { id: loser.id },
        data: { points: { increment: 1 } }
      });
    });

    res.json({ message: 'Match completed and points updated' });

  } catch (err) {
    console.error('[matchComplete] Error:', err);
    res.status(400).json({ error: 'Failed to complete match' });
  }
})

export default router