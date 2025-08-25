import express from 'express'
import { prisma } from '../prisma'
import { verifySignature } from '../middleware/verifySignature'
import { LAMPORTS } from '../middleware/solanaUtils'
import { fetchSolPrice } from "../services/solanaService";
import { completeMatch } from "../services/matchService";
import { Connection, ParsedInstruction, PartiallyDecodedInstruction } from "@solana/web3.js";

const router = express.Router()
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

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

  if (!walletAddress || !txSignature || !game) {
    return res.status(400).json({ error: 'Missing walletAddress, txSignature or game' })
  }

  // Validate game mode and bet amounts
  if (mode && !['Casual', 'Betting'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid game mode' });
  }

  if (mode && mode === "Betting") {
    if (!betAmount || isNaN(betAmount) || betAmount <= 0)
      return res.status(400).json({ error: 'Invalid bet amount' });

    if (!matchFee || isNaN(matchFee) || matchFee < 0)
      return res.status(400).json({ error: 'Invalid match fee' });
  }

  // Verify transaction commitment = finalized
  const conn = new Connection(SOLANA_RPC_URL, "finalized");

  const tx = await conn.getParsedTransaction(txSignature, { maxSupportedTransactionVersion: 0 });
  if (!tx) {
    return res.status(400).json({ error: 'Fee deposit not found' });
  }

  if (!tx.meta || tx.meta.err) {
    return res.status(400).json({ error: 'Fee deposit transaction not finalized' });
  }

  // Verify lamports transferred in tx
  let lamportsTransferred = null;

  const inspectInstructions = (instructions: (ParsedInstruction | PartiallyDecodedInstruction)[]) => {
    for (const ix of instructions) {
      if ('parsed' in ix) {
        const p = ix as ParsedInstruction;
        if (p.program === 'system' && p.parsed?.type === 'transfer') {
          return Number((p.parsed.info as any).lamports);
        }
      }
    }
    return null;
  };

  const top = tx.transaction.message.instructions as (ParsedInstruction | PartiallyDecodedInstruction)[];
  let lamports = inspectInstructions(top);
  if (lamports) lamportsTransferred = lamports;

  if (tx.meta.innerInstructions) {
    for (const inner of tx.meta.innerInstructions) {
      lamports = inspectInstructions(inner.instructions as (ParsedInstruction | PartiallyDecodedInstruction)[]);
      if (lamports) lamportsTransferred = lamports;
    }
  }

  if (lamportsTransferred === null) {
    // Calculate amount in lamports using betAmount if no transfer instruction found
    console.log("No valid transfer instruction found in transaction. Calculating from betAmount.");

    const solanaPriceInUsd = await fetchSolPrice();
    if (!solanaPriceInUsd || solanaPriceInUsd === 0) {
      console.error('Solana price fetch failed');
      res.status(500).json({ error: 'Solana price fetch failed' });
      return;
    }

    const betAmountSol = Number(betAmount || 0.50) / solanaPriceInUsd;
    lamportsTransferred = Math.round(betAmountSol * 2 * LAMPORTS);
  }
  console.log(`Lamports transferred in tx ${txSignature}: ${lamportsTransferred}`);

  // Find or create wallet
  let wallet = await prisma.wallet.findUnique({ where: { address: walletAddress } })
  if (!wallet) {
    wallet = await prisma.wallet.create({ data: { address: walletAddress } })
  }

  // Use a transaction to ensure atomicity
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
            lamportsB: BigInt(lamportsTransferred),
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
            lamportsA: BigInt(lamportsTransferred),
            game: game,
            mode: (mode ? mode.toUpperCase() : 'CASUAL'),
            betAmount: betAmount || 0.50,
            matchFee: matchFee || 0.10,
            status: 'WAITING'
          }
        });
      }
    });

    console.log(`Player ${walletAddress} registered in match ${match.matchId}`);
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
    return res.status(400).json({ error: "Missing matchID or walletAddress" });

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

  if (!matchID || !winnerWallet) {
    return res.status(400).json({ error: 'Missing matchID or winnerWallet' })
  }

  const result = await completeMatch(matchID, winnerWallet);
  if (!result.ok) {
    if (result.reason === "already_claimed") return res.status(409).json({ error: "Match already completed" });

    console.error(result.error);
    return res.status(500).json({ error: "Failed to complete match" });
  }

  res.json({ message: "Match settled on-chain and DB updated", tx: result.txSig });
})

export default router