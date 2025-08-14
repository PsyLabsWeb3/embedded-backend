import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("BUQFRUJECRCADvdtStPUgcBgnvcNZhSWbuqBraPWPKf8");

// Converts USD to lamports (assuming 1 SOL = ~priceInUSD)
const USD_TO_LAMPORTS = (usd, solPrice) => Math.round((usd / solPrice) * anchor.web3.LAMPORTS_PER_SOL);

(async () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = require("../target/idl/embedded.json");
  const program = new anchor.Program(
    idl,
    provider
  );

  // --- SETTINGS ---
  const solPrice = 193; // Current SOL price in USD
  const casualBetLamports = USD_TO_LAMPORTS(0.50, solPrice); // 0.50 USD worth in lamports
  const casualFeeBps = 2000;  // 20% in basis points (bps)
  const bettingFeeBps = 1000; // 10%
  const winnersModeIsPercentage = false;
  const winnersValue = 500;
  const rewardPercentageBps = 2000; // 20% in bps

  const [configPda, configBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID
  );

  console.log("Config PDA:", configPda.toBase58(), "Bump:", configBump);

  const tx = await program.methods
    .initializeConfig(
      new anchor.BN(casualBetLamports),
      casualFeeBps,
      bettingFeeBps,
      winnersModeIsPercentage,
      winnersValue,
      rewardPercentageBps
    )
    .accounts({
      config: configPda,
      authority: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("Transaction signature:", tx);
})();