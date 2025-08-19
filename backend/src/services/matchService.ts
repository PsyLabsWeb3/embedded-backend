import { prisma } from '../prisma'
import { loadKeypairFromFile, getPdas, LAMPORTS } from '../middleware/solanaUtils'
import { fetchSolPrice } from "../services/solanaService";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import path from "path";

const ANCHOR_PROGRAM_ID = new PublicKey(process.env.ANCHOR_PROGRAM_ID!);
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const AUTH_KEYPAIR_PATH = process.env.AUTH_KEYPAIR_PATH!;
const PROGRAM_IDL_PATH = process.env.PROGRAM_IDL_PATH!;

function getProviderAndProgram() {
    const authorityKeypair = loadKeypairFromFile(AUTH_KEYPAIR_PATH);
    const connection = new anchor.web3.Connection(SOLANA_RPC_URL, "finalized");
    const wallet = new anchor.Wallet(authorityKeypair);
    const provider = new anchor.AnchorProvider(connection, wallet, {
        preflightCommitment: "finalized",
        commitment: "finalized",
    });
    anchor.setProvider(provider);
    const idlPath = path.resolve(PROGRAM_IDL_PATH);
    const idl = require(idlPath);
    const program = new anchor.Program(idl, provider);
    return { program, provider, authorityKeypair };
}

export async function completeMatch(matchId: string, winnerWallet: string) {
    // Claim the match
    const claimResult = await prisma.match.updateMany({
        where: {
            matchId,
            status: "IN_PROGRESS",
        },
        data: {
            status: "SETTLING",
        },
    });

    if (claimResult.count === 0) {
        // Match already claimed
        return { ok: false, reason: "already_claimed" };
    }

    const match = await prisma.match.findUnique({
        where: { matchId },
        include: { walletA: true, walletB: true },
    });
    if (!match) {
        await prisma.match.updateMany({
            where: { matchId, status: "SETTLING" },
            data: { status: "IN_PROGRESS" },
        });
        throw new Error("Match missing after claim");
    }

    // Compute amounts in lamports
    const solanaPriceInUsd = await fetchSolPrice();
    if (!solanaPriceInUsd || solanaPriceInUsd === 0) {
        console.error("Solana price fetch failed, reverting DB claim");
        await prisma.match.updateMany({
            where: { matchId, status: "SETTLING" },
            data: { status: "IN_PROGRESS" },
        });
        return { ok: false, reason: "price_fetch_failed" };
    }

    const betAmountSol = Number(match.betAmount) / solanaPriceInUsd;
    const totalAmountLamports = Math.round(betAmountSol * 2 * LAMPORTS);

    const feeAmountSol = Number(match.matchFee) / solanaPriceInUsd;
    const totalFeeLamports = Math.round(feeAmountSol * 2 * LAMPORTS);

    const modeArg = match.mode === 'BETTING'
    ? { betting: {} }
    : { casual: {} };

    const winnerPubkey = new PublicKey(winnerWallet);

    // Derive PDAs
    const { configPda, treasuryPda } = getPdas(ANCHOR_PROGRAM_ID);

    // Call anchor program
    const { program, authorityKeypair } = getProviderAndProgram();

    try {
        const txSig = await program.methods
            .settleMatch(
                matchId,
                new anchor.BN(totalAmountLamports),
                new anchor.BN(totalFeeLamports),
                modeArg,
                winnerPubkey
            )
            .accounts({
                config: configPda,
                treasury: treasuryPda,
                authority: authorityKeypair.publicKey,
                winner: winnerPubkey,
                systemProgram: SystemProgram.programId,
            })
            .signers([authorityKeypair])
            .rpc();
            
        // Update DB
        await prisma.$transaction(async (tx) => {
            const winner = await tx.wallet.findUnique({ where: { address: winnerWallet } });
            if (!winner) throw new Error("Winner wallet missing");

            await tx.match.update({
                where: { matchId },
                data: {
                    winnerWallet: { connect: { id: winner.id } },
                    status: "FINISHED",
                    endedAt: new Date(),
                },
            });

            // increment points
            await tx.wallet.update({
                where: { id: winner.id },
                data: { points: { increment: 2 } },
            });

            const loserAddress = match.walletA.address === winnerWallet ? match.walletB?.address : match.walletA?.address;
            if (loserAddress) {
                const loser = await tx.wallet.findUnique({ where: { address: loserAddress } });
                if (loser) {
                    await tx.wallet.update({
                        where: { id: loser.id },
                        data: { points: { increment: 1 } },
                    });
                }
            }
        });

        return { ok: true, txSig };
    } catch (err) {
        console.error("Settle failed, reverting DB claim:", err);

        await prisma.match.updateMany({
            where: { matchId, status: "SETTLING" },
            data: { status: "IN_PROGRESS" },
        });
        return { ok: false, error: err };
    }
}