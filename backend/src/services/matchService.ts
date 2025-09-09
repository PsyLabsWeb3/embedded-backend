import { prisma } from '../prisma'
import { getPdas, getProviderAndProgram } from '../middleware/solanaUtils'
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

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