import express from 'express'
import { prisma } from '../prisma'
import { verifySignature } from '../middleware/verifySignature'

const router = express.Router()

// POST /registerPlayer
router.post('/registerPlayer', verifySignature, async (req, res):  Promise<any> => {
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
        status: 'IN_PROGRESS'
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
  const { matchID, winnerWallet, loserWallet } = req.body

  if (!matchID || !winnerWallet || !loserWallet)
    return res.status(400).json({ error: 'Missing params' })

  const match = await prisma.match.findUnique({
    where: { matchId: matchID },
    include: { walletA: true, walletB: true }
  })

  if (!match)
    return res.status(404).json({ error: 'Match not found' })

  const [walletA, walletB] = [match.walletA.address, match.walletB?.address]

  if (![walletA, walletB].includes(winnerWallet) || ![walletA, walletB].includes(loserWallet))
    return res.status(400).json({ error: 'Wallets do not match match participants' })

  const winner = await prisma.wallet.findUnique({ where: { address: winnerWallet } })
  const loser = await prisma.wallet.findUnique({ where: { address: loserWallet } })

  if (!winner || !loser)
    return res.status(404).json({ error: 'One or both wallets not found' })

  await prisma.match.update({
    where: { matchId: matchID },
    data: {
      winnerWallet: { connect: { id: winner.id } },
      status: 'FINISHED',
      endedAt: new Date()
    }
  })

  await prisma.wallet.update({
    where: { id: winner.id },
    data: { points: { increment: 2 } }
  })

  await prisma.wallet.update({
    where: { id: loser.id },
    data: { points: { increment: 1 } }
  })

  res.json({ message: 'Match completed and points updated' })
})

export default router