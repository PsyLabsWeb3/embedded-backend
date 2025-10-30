import express from 'express'
import { prisma } from '../prisma'
import { Prisma } from "@prisma/client";
import { verifySignature } from '../middleware/verifySignature'
import { getPdas, getProviderAndProgram } from '../middleware/solanaUtils'
import { completeMatch, refundMatch } from "../services/matchService";
import { findAnyTransfer, findTransferToDest, findTransferFromTo, } from "../utils/solanaUtils";
import { deleteEntryFeeTx } from "../utils/prismaUtils";
import { Connection, ParsedInstruction, PartiallyDecodedInstruction, PublicKey, ParsedTransactionWithMeta } from "@solana/web3.js";

const router = express.Router()
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const ANCHOR_PROGRAM_ID = new PublicKey(process.env.ANCHOR_PROGRAM_ID!);
const [treasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("treasury")], ANCHOR_PROGRAM_ID);

// POST /registerPlayer
router.post('/registerPlayer', verifySignature, async (req, res): Promise<any> => {
  console.log('/registerPlayer received body:', req.body);

  const { walletAddress, txSignature, game, mode, region, betAmount } = req.body
  const numBetAmount = betAmount ? Number(betAmount) : null;

  if (!walletAddress || !txSignature || !game || !region) {
    console.error("Missing walletAddress, txSignature, game or region");
    return res.status(400).json({ error: 'Missing walletAddress, txSignature, game or region' })
  }

  // Validate game mode and bet amounts
  if (mode && !['Casual', 'Betting'].includes(mode)) {
    console.error("Invalid game mode: ", mode);
    return res.status(400).json({ error: 'Invalid game mode' });
  }

  if (mode && mode === "Betting") {
    if (!numBetAmount || isNaN(numBetAmount) || numBetAmount <= 0) {
      console.error("Invalid bet amount: ", numBetAmount);
      return res.status(400).json({ error: 'Invalid bet amount' });
    }
  }

  // Verify transaction uniqueness
   try {
    await prisma.entryFeeTransaction.create({
      data: { txSig: txSignature },
    });
  } catch (e: any) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      console.error("Transaction already processed.");
      return res.status(400).json({ error: 'Transaction already processed' });
    }
    console.error("Error while registering transaction: ", e);
    return res.status(500).json({ error: "Error while registering transaction" });
  }

  // Verify transaction commitment = finalized
  const conn = new Connection(SOLANA_RPC_URL, "finalized");

  const tx = await conn.getParsedTransaction(txSignature, { maxSupportedTransactionVersion: 0 });
  if (!tx) {
    deleteEntryFeeTx(txSignature);
    return res.status(400).json({ error: 'Fee deposit not found' });
  }

  if (!tx.meta || tx.meta.err) {
    deleteEntryFeeTx(txSignature);
    return res.status(400).json({ error: 'Fee deposit transaction not finalized' });
  }

  // Verify lamports transferred in tx
  const parsedTx = tx as ParsedTransactionWithMeta;
  const anyT = findAnyTransfer(parsedTx);
  if (!anyT) {
    deleteEntryFeeTx(txSignature);
    return res.status(400).json({ error: "Lamports transfered not found in transaction" });
  }

  // Verify transfer destination
  const toTreasury = findTransferToDest(parsedTx, treasuryPda.toBase58());
  if (!toTreasury) {
    deleteEntryFeeTx(txSignature);
    return res.status(400).json({
      error: "Deposit destination mismatch (not treasury PDA)",
      details: { expectedDestination: treasuryPda.toBase58(), sampleFound: anyT.to },
    });
  }

  // Verify transfer origin wallet
  const fromPlayerToTreasury = findTransferFromTo(
    parsedTx,
    walletAddress,
    treasuryPda.toBase58()
  );
  if (!fromPlayerToTreasury) {
    deleteEntryFeeTx(txSignature);
    return res.status(400).json({
      error: "Deposit sender mismatch (not player wallet)",
      details: { expectedSender: walletAddress, destination: treasuryPda.toBase58() },
    });
  }

  const lamportsTransferred = fromPlayerToTreasury.lamports;
  console.log(`Lamports transferred in tx ${txSignature}: ${lamportsTransferred}`);

  // Find or create wallet
  let wallet = await prisma.wallet.findUnique({ where: { address: walletAddress } })
  if (!wallet) {
    wallet = await prisma.wallet.create({ data: { address: walletAddress } })
  }

  // Derive PDAs
  const { configPda } = getPdas(ANCHOR_PROGRAM_ID);

  // Call anchor program
  const { program } = getProviderAndProgram();

  // Fetch the Config PDA account to get the fee percentage
  const configAccount = await (program.account as any).config.fetch(configPda);

  let feeBps = 2000; // Default to 20%
  if (mode === 'Betting') {
    if ((configAccount as any).bettingFeeBps !== undefined) {
      feeBps = Number((configAccount as any).bettingFeeBps);
      console.log("Found bettingFeeBps field in config account:", feeBps);
    } else {
      throw new Error('Cannot find betting fee field on config account. Inspect configAccount keys: ' + Object.keys(configAccount).join(', '));
    }
  } else {
    if ((configAccount as any).casualFeeBps !== undefined) {
      feeBps = Number((configAccount as any).casualFeeBps);
      console.log("Found casualFeeBps field in config account:", feeBps);
    } else {
      throw new Error('Cannot find casual fee field on config account. Inspect configAccount keys: ' + Object.keys(configAccount).join(', '));
    }
  }

  let matchFee = (numBetAmount || 0.50) * feeBps / 10000;
  console.log(`Match fee for bet amount ${(numBetAmount || 0.50)} USD: ${matchFee} USD`);

  // Use a transaction to ensure atomicity
  try {
    let playerNumber = 1;

    const match = await prisma.$transaction(async (tx) => {
      const openMatch = await tx.match.findFirst({
        where: {
          status: 'WAITING',
          walletBId: null,
          game: game,
          mode: (mode ? mode.toUpperCase() : 'CASUAL'),
          region: region,
          betAmount: numBetAmount || 0.50,
          walletA: {
            address: {
              not: walletAddress
            }
          }
        },
        orderBy: { createdAt: 'asc' },
      });

      if (openMatch) {
        playerNumber = 2;
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
            region: region,
            betAmount: numBetAmount || 0.50,
            matchFee: matchFee || 0.10,
            status: 'WAITING'
          }
        });
      }
    });

    console.log(`Player ${walletAddress} registered in match ${match.matchId}`);
    res.json({ matchId: match.matchId, playerNumber: playerNumber });
  } catch (err) {
    deleteEntryFeeTx(txSignature);
    console.error('[registerPlayer] Error:', err);
    res.status(500).json({ error: 'Failed to register player' });
  }
})

// POST /registerPlayerPvE
router.post('/registerPlayerPvE', verifySignature, async (req, res): Promise<any> => {
  console.log('/registerPlayerPvE received body:', req.body);

  const { walletAddress, txSignature, game } = req.body

  if (!walletAddress || !txSignature || !game) {
    return res.status(400).json({ error: 'Missing walletAddress, txSignature or game' })
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
    console.log("No valid transfer instruction found in transaction.");
    return res.status(400).json({ error: 'Transaction amount not found in the transaction.' });
  }

  console.log(`Lamports transferred in tx ${txSignature}: ${lamportsTransferred}`);

  // Find or create wallet
  let wallet = await prisma.wallet.findUnique({ where: { address: walletAddress } })
  if (wallet) {
    await prisma.wallet.update({
        where: { id: wallet.id },
        data: { points: { increment: 1 } },
    });
  } else {
    wallet = await prisma.wallet.create({ data: { address: walletAddress, points: 1 } })
  }

  // Use a transaction to ensure atomicity
  try {
    const match = await prisma.$transaction(async (tx) => {
      const matchId = crypto.randomUUID();
      return await tx.match.create({
        data: {
          matchId,
          walletA: { connect: { id: wallet.id } },
          txSigA: txSignature,
          lamportsA: BigInt(lamportsTransferred),
          game: game,
          mode: 'PVE',
          betAmount: 0,
          status: 'FINISHED'
        }
      });
    });

    console.log(`Player ${walletAddress} registered in PvE match ${match.matchId}`);
    res.json({ matchId: match.matchId });
  } catch (err) {
    console.error('[registerPlayerPvE] Error:', err);
    res.status(500).json({ error: 'Failed to register player for PvE match' });
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

// POST /abortMatch
router.post('/abortMatch', verifySignature, async (req, res): Promise<any> => {
  console.log('/abortMatch received body:', req.body);

  const { matchID, walletAddress } = req.body

  if (!matchID || !walletAddress) {
    return res.status(400).json({ error: 'Missing matchID or walletAddress' })
  }

  // Select match from ID
  const match = await prisma.match.findUnique({
    where: { matchId: matchID },
    include: { walletA: true, walletB: true }
  });

  if (!match) {
    console.error('Match not found');
    return res.status(404).json({ error: "Match not found" });
  }

  // Only abort if status = WAITING & walletAddress = player 1
  if (match.status !== 'WAITING') {
    console.error("Match can't be aborted");
    return res.status(400).json({ error: "Match can't be aborted" });
  }

  if (match.walletA?.address !== walletAddress) {
    console.error('Wallet is not player 1 in this match');
    return res.status(400).json({ error: "Wallet is not player 1 in this match" });
  }

  // Obtain lamports transferred in transaction
  const txId = match.txSigA;
  const conn = new Connection(SOLANA_RPC_URL, "finalized");

  const tx = await conn.getParsedTransaction(txId, { maxSupportedTransactionVersion: 0 });
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
    console.error('Lamports transferred not found');
    return res.status(400).json({ error: "Lamports transferred not found" });
  }

  console.log("Lamports transfered in match to abort: " + lamportsTransferred);

  // Update match to ABORTED status
  await prisma.match.update({
    where: { matchId: matchID, status: "WAITING" },
    data: { status: 'ABORTED', endedAt: new Date() }
  });

  // Refund lamports to player wallet
  const result = await refundMatch(matchID, walletAddress, lamportsTransferred);
  if (!result.ok) {
    console.error(result.error);
    return res.status(500).json({ error: "Failed to refund match" });
  }

  console.log('Match aborted:', matchID);
  res.json({ message: "Match aborted", matchID: matchID });
})

export default router