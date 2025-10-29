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

  const [configPda, configBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID
  );

  console.log("Config PDA:", configPda.toBase58(), "Bump:", configBump);

  // Prepare new config params. If you don’t want to change it, pass null
  const newCfg = {
    casual_fee_bps: null,
    betting_fee_bps: null,
    winners_mode_is_percentage: null,
    winners_value: null,
    reward_percentage_bps: null
  };

  console.log("Calling update_config...");

  const tx = await program.methods
    .updateConfig(newCfg)
    .accounts({
      config: configPda,
      authority: provider.wallet.publicKey
    })
    .rpc();

  console.log("Transaction signature:", tx);
})();