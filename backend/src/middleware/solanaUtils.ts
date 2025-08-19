import { Keypair, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor"; 
import fs from "fs";

export function loadKeypairFromFile(path: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(path, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export function getPdas(programId: PublicKey) {
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId
  );
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    programId
  );
  return { configPda, treasuryPda };
}

export const LAMPORTS = anchor.web3.LAMPORTS_PER_SOL;