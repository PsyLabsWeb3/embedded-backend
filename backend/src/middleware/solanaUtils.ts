import { Keypair, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor"; 
import fs from "fs";
import path from "path";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const AUTH_KEYPAIR_PATH = process.env.AUTH_KEYPAIR_PATH!;
const PROGRAM_IDL_PATH = process.env.PROGRAM_IDL_PATH!;

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

export function getProviderAndProgram() {
    const authorityKeypair = loadKeypairFromFile(AUTH_KEYPAIR_PATH);
    const connection = new anchor.web3.Connection(SOLANA_RPC_URL, "finalized");
    const wallet = new anchor.Wallet(authorityKeypair);
    const provider = new anchor.AnchorProvider(connection, wallet, {
        preflightCommitment: "finalized",
        commitment: "finalized",
    });
    anchor.setProvider(provider);
    const idlPath = path.resolve(PROGRAM_IDL_PATH);
    const idl = require(idlPath);
    const program = new anchor.Program(idl, provider);
    return { program, provider, authorityKeypair };
}


export const LAMPORTS = anchor.web3.LAMPORTS_PER_SOL;