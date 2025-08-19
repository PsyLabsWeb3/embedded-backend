import { PrismaClient } from '@prisma/client'
import { completeMatch } from "../services/matchService";
const prisma = new PrismaClient()

const MATCH_TIMEOUT_MINUTES = 15

async function main() {
    const cutoff = new Date(Date.now() - MATCH_TIMEOUT_MINUTES * 60 * 1000)

    const staleMatches = await prisma.match.findMany({
        where: {
            status: 'IN_PROGRESS',
            startedAt: { lt: cutoff }
        },
        include: {
            walletA: true,
            walletB: true
        }
    })

    for (const match of staleMatches) {
        const aJoined = match.walletAJoined !== null
        const bJoined = match.walletBJoined !== null

        let winner;

        if (aJoined && !bJoined) {
            winner = match.walletA
        } else {
            winner = match.walletB
        }

        console.log(`Auto-resolving match ${match.matchId}: ${winner?.address} wins`)

        if (winner && winner.address) {
            const result = await completeMatch(match.matchId, winner.address);

            if (!result.ok) {
                console.warn(`Could not auto-settle ${match.matchId}:`, result.error || result.reason);
            } else {
                console.log(`Settled ${match.matchId}, tx:`, result.txSig);
            }
        } else {
            console.warn(`Could not determine winner for match ${match.matchId}, skipping auto-settle.`);
        }
    }

    console.log(`Checked and resolved ${staleMatches.length} stale matches`)
}

main()
    .catch(e => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })