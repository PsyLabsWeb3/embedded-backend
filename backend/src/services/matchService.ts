import { prisma } from '../prisma'
import { getPdas, getProviderAndProgram } from '../middleware/solanaUtils'
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { Connection, TransactionMessage } from "@solana/web3.js";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const ANCHOR_PROGRAM_ID = new PublicKey(process.env.ANCHOR_PROGRAM_ID!);

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

    const modeArg = match.mode === 'BETTING'
        ? { betting: {} }
        : { casual: {} };

    const winnerPubkey = new PublicKey(winnerWallet);

    // Derive PDAs
    const { configPda, treasuryPda } = getPdas(ANCHOR_PROGRAM_ID);

    // Call anchor program
    const { program, authorityKeypair } = getProviderAndProgram();

    // Fetch the Config PDA account to get the fee percentage
    const configAccount = await (program.account as any).config.fetch(configPda);

    let feeBps = 2000; // Default to 20%
    if (match.mode === 'BETTING') {
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

    // Fetch total amount and calculate fee
    const totalAmountLamports = match.lamportsA + (match.lamportsB || BigInt(0));
    const totalFeeLamports = totalAmountLamports * BigInt(feeBps) / BigInt(10000);

    console.log(`Settling match ${matchId} with total amount ${totalAmountLamports} lamports and fee ${totalFeeLamports} lamports (fee bps: ${feeBps})`);

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

export async function refundMatch(matchId: string, walletAddress: string, amountLamports: number) {
    try {
        // Derive PDAs
        const { configPda, treasuryPda } = getPdas(ANCHOR_PROGRAM_ID);

        // Call anchor program
        const { program, authorityKeypair } = getProviderAndProgram();

        const conn = new Connection(SOLANA_RPC_URL, "finalized");
        const latestBlockhash = await conn.getLatestBlockhash();

        const playerPk = new PublicKey(walletAddress);

        // Calculate transaction fee
        const refundIx = await program.methods
            .refundEntry(
                matchId,
                playerPk,
                new anchor.BN(amountLamports)
            )
            .accounts({
                config: configPda,
                treasury: treasuryPda,
                player: playerPk,
                authority: authorityKeypair.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .instruction();

        const messageV0 = new TransactionMessage({
            payerKey: authorityKeypair.publicKey,
            recentBlockhash: latestBlockhash.blockhash,
            instructions: [refundIx],
        }).compileToV0Message();

        const feeResp = await conn.getFeeForMessage(messageV0);
        const txFeeLamports = feeResp.value ?? 5000;

        // Deduct fee from refund amount
        console.log(`Deducting ${txFeeLamports} lamports as fee from the total ${amountLamports} refund.`);
        const refundAmount = Math.max(0, Number(amountLamports) - txFeeLamports);

        console.log(`Refunding ${refundAmount} lamports to wallet ${walletAddress} from match ${matchId}`);

        const txSig = await program.methods
            .refundEntry(
                matchId,
                playerPk,
                new anchor.BN(refundAmount)
            )
            .accounts({
                config: configPda,
                treasury: treasuryPda,
                player: playerPk,
                authority: authorityKeypair.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([authorityKeypair])
            .rpc();

        console.log(`Refund successful for match: ${matchId}`);
        return { ok: true, txSig };
    } catch (err) {
        console.error("Settle failed, reverting DB abort:", err);

        await prisma.match.updateMany({
            where: { matchId, status: "ABORTED" },
            data: { status: "WAITING" },
        });
        return { ok: false, error: err };
    }
}