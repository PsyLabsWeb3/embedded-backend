import express from 'express'
import { prisma } from '../prisma'
import { verifySignature } from '../middleware/verifySignature'

const router = express.Router()

// POST /registerPlayer
router.post('/registerPlayer', verifySignature, async (req, res):  Promise<any> => {
  console.log('/registerPlayer received body:', req.body);

  const { walletAddress, txSignature } = req.body

  if (!walletAddress || !txSignature)
    return res.status(400).json({ error: 'Missing walletAddress or txSignature' })

  let wallet = await prisma.wallet.findUnique({ where: { address: walletAddress } })
  if (!wallet) {
    wallet = await prisma.wallet.create({ data: { address: walletAddress } })
  }

  const openMatch = await prisma.match.findFirst({
    where: { status: 'WAITING' }
  })

  let match
  if (openMatch) {
    match = await prisma.match.update({
      where: { id: openMatch.id },
      data: {
        walletB: { connect: { id: wallet.id } },
        txSigB: txSignature,
        status: 'IN_PROGRESS',
        startedAt: new Date()
      }
    })
  } else {
    const matchId = crypto.randomUUID()
    match = await prisma.match.create({
      data: {
        matchId,
        walletA: { connect: { id: wallet.id } },
        txSigA: txSignature,
        status: 'WAITING'
      }
    })
  }

  res.json({ matchId: match.matchId })
})

// POST /matchComplete
router.post('/matchComplete', verifySignature, async (req, res):  Promise<any> => {
  console.log('/matchComplete received body:', req.body);

  const { matchID, winnerWallet } = req.body

  if (!matchID || !winnerWallet)
    return res.status(400).json({ error: 'Missing params' })

  const match = await prisma.match.findUnique({
    where: { matchId: matchID, status: 'IN_PROGRESS' },
    include: { walletA: true, walletB: true }
  })

  if (!match)
    return res.status(404).json({ error: 'Match not found' })

  const walletA = match.walletA?.address;
  const walletB = match.walletB?.address;

  if (![walletA, walletB].includes(winnerWallet))
    return res.status(400).json({ error: 'Wallet is not a participant in this match' });

  const loserWallet = winnerWallet === walletA ? walletB : walletA;

  if (!loserWallet)
    return res.status(400).json({ error: 'Match has only one participant, cannot resolve loser' });

  const [winner, loser] = await Promise.all([
    prisma.wallet.findUnique({ where: { address: winnerWallet } }),
    prisma.wallet.findUnique({ where: { address: loserWallet } }),
  ]);

  if (!winner || !loser)
    return res.status(404).json({ error: 'Could not find both wallet records' });

  await prisma.match.update({
    where: { matchId: matchID },
    data: {
      winnerWallet: { connect: { id: winner.id } },
      status: 'FINISHED',
      endedAt: new Date()
    }
  });

  await prisma.wallet.update({
    where: { id: winner.id },
    data: { points: { increment: 2 } }
  });

  await prisma.wallet.update({
    where: { id: loser.id },
    data: { points: { increment: 1 } }
  });

  res.json({ message: 'Match completed and points updated' })
})

export default router