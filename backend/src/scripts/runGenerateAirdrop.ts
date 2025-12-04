import { generateAirdropCsv } from '../routes/leaderboard'

(async () => {
  try {
    const arg = process.argv[2];
    if (!arg) {
      console.error('Usage: ts-node runGenerateAirdrop.ts <season-number>');
      process.exit(1);
    }

    const season = Number(arg);
    if (!Number.isInteger(season)) {
      console.error('Season must be an integer');
      process.exit(1);
    }

    const folderPath = await generateAirdropCsv(season)
    console.log('Airdrop CSVs written to:', folderPath)
    setTimeout(() => process.exit(0), 100)
  } catch (err) {
    console.error('Failed to generate airdrop CSV:', err)
    setTimeout(() => process.exit(1), 100)
  }
})()
