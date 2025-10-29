import { PublicKey } from "@solana/web3.js";

const programId = new PublicKey("BUQFRUJECRCADvdtStPUgcBgnvcNZhSWbuqBraPWPKf8");

const [treasuryPda, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("treasury")],
  programId
);

console.log("Treasury PDA:", treasuryPda.toBase58());
console.log("Bump:", bump);