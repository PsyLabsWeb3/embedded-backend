import { PrismaClient } from '@prisma/client'
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

        let winner = null
        let loser = null

        if (aJoined && !bJoined) {
            winner = match.walletA
            loser = match.walletB
        } else {
            winner = match.walletB
            loser = match.walletA
        }

        console.log(`Auto-resolving match ${match.matchId}: ${winner?.address} wins`)

        await prisma.$transaction([
            prisma.match.update({
                where: { matchId: match.matchId },
                data: {
                    winnerWallet: { connect: { id: winner?.id } },
                    status: 'FINISHED',
                    endedAt: new Date()
                }
            }),
            prisma.wallet.update({
                where: { id: winner?.id },
                data: { points: { increment: 2 } }
            }),
            ...(loser
                ? [
                    prisma.wallet.update({
                        where: { id: loser.id },
                        data: { points: { increment: 1 } }
                    })
                ]
                : [])
        ])
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