import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("BUQFRUJECRCADvdtStPUgcBgnvcNZhSWbuqBraPWPKf8");

(async () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = require("../target/idl/embedded.json");
  const program = new anchor.Program(
    idl,
    provider
  );

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID
  );

  console.log("Config PDA:", configPda.toBase58());

  const tx = await program.methods
    .initializeTreasuryBump()
    .accounts({
      config: configPda,
      authority: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("Transaction signature:", tx);
})();