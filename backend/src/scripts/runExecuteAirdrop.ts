import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();
import csv from 'csv-parse/sync';
import { PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { getProviderAndProgram, getPdas, LAMPORTS } from '../middleware/solanaUtils';

interface AirdropRecord {
  walletAddress: string;
  amount_sol: string;
}

interface AirdropExecutionResult {
  recipient: string;
  amount: number;
  signature?: string;
  error?: string;
}

/**
 * Read airdrop CSV and execute transfers in batches
 * CSV format: walletAddress,amount_sol (both players.csv and owners.csv)
 */
async function executeAirdrop(airdropFolderPath: string): Promise<void> {
  try {
    const { program, provider, authorityKeypair } = getProviderAndProgram();
    const programId = program.programId;
    const { configPda, treasuryPda } = getPdas(programId);

    console.log('Airdrop Execution Started');
    console.log(`Program ID: ${programId}`);
    console.log(`Treasury PDA: ${treasuryPda}`);
    console.log(`Authority: ${authorityKeypair.publicKey}`);

    // Show authority balance before execution
    const beforeBalanceLamports = await provider.connection.getBalance(authorityKeypair.publicKey);
    console.log(`Authority balance BEFORE: ${ (beforeBalanceLamports / LAMPORTS).toFixed(9) } SOL (${beforeBalanceLamports} lamports)`);

    // Collect all recipients from both CSV files
    const allRecipients: AirdropRecord[] = [];

    // Read players.csv
    const playersPath = path.join(airdropFolderPath, 'players.csv');
    if (fs.existsSync(playersPath)) {
      console.log(`Reading players.csv...`);
      const playersContent = fs.readFileSync(playersPath, 'utf-8');
      const playersRecords = csv.parse(playersContent, {
        columns: true,
        skip_empty_lines: true,
      }) as AirdropRecord[];
      allRecipients.push(...playersRecords);
      console.log(`  Found ${playersRecords.length} players`);
    }

    // Read owners.csv
    const ownersPath = path.join(airdropFolderPath, 'owners.csv');
    if (fs.existsSync(ownersPath)) {
      console.log(`Reading owners.csv...`);
      const ownersContent = fs.readFileSync(ownersPath, 'utf-8');
      const ownersRecords = csv.parse(ownersContent, {
        columns: true,
        skip_empty_lines: true,
      }) as AirdropRecord[];
      allRecipients.push(...ownersRecords);
      console.log(`  Found ${ownersRecords.length} owners`);
    }

    if (allRecipients.length === 0) {
      throw new Error('No recipients found in CSV files');
    }

    console.log(`\nTotal recipients to process: ${allRecipients.length}`);

    // Batch size: process transfers in batches
    const BATCH_SIZE = 1;
    const results: AirdropExecutionResult[] = [];

    for (let i = 0; i < allRecipients.length; i += BATCH_SIZE) {
      const batch = allRecipients.slice(i, Math.min(i + BATCH_SIZE, allRecipients.length));
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(allRecipients.length / BATCH_SIZE);

      console.log(`\n--- Batch ${batchNumber}/${totalBatches} ---`);

      for (const record of batch) {
        try {
          const recipient = new PublicKey(record.walletAddress);
          const amountSol = parseFloat(record.amount_sol);
          const amountLamports = Math.round(amountSol * LAMPORTS);

          console.log(`  Transferring ${amountSol} SOL (${amountLamports} lamports) to ${recipient}`);

          // Call airdrop_transfer instruction
          const tx = await program.methods
            .airdropTransfer(recipient, new anchor.BN(amountLamports))
            .accounts({
              config: configPda,
              treasury: treasuryPda,
              recipient: recipient,
              authority: authorityKeypair.publicKey,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([authorityKeypair])
            .rpc();

          console.log(`    ✓ Transaction: ${tx}`);
          results.push({
            recipient: record.walletAddress,
            amount: amountLamports,
            signature: tx,
          });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`    ✗ Failed: ${errorMsg}`);
          results.push({
            recipient: record.walletAddress,
            amount: Math.round(parseFloat(record.amount_sol) * LAMPORTS),
            error: errorMsg,
          });
        }

        // Small delay between transfers to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Get authority balance after execution
    const afterBalanceLamports = await provider.connection.getBalance(authorityKeypair.publicKey);
    console.log(`Authority balance AFTER:  ${ (afterBalanceLamports / LAMPORTS).toFixed(9) } SOL (${afterBalanceLamports} lamports)`);

    // Summary
    console.log('\n=== Airdrop Execution Summary ===');
    const successful = results.filter(r => !r.error).length;
    const failed = results.filter(r => r.error).length;
    const totalTransferred = results
      .filter(r => !r.error)
      .reduce((sum, r) => sum + r.amount, 0);

    console.log(`Successful: ${successful}/${allRecipients.length}`);
    console.log(`Failed: ${failed}/${allRecipients.length}`);
    console.log(`Total SOL transferred: ${(totalTransferred / LAMPORTS).toFixed(9)}`);

    // Write results to file
    const resultsPath = path.join(airdropFolderPath, 'execution_results.json');
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`\nResults saved to: ${resultsPath}`);

    if (failed > 0) {
      console.warn(`\n${failed} transfers failed. Check execution_results.json for details.`);
      process.exit(1);
    } else {
      console.log('\nAll transfers completed successfully!');
      process.exit(0);
    }
  } catch (err) {
    console.error('Airdrop execution failed:', err);
    setTimeout(() => process.exit(1), 100);
  }
}

// Main entry point
const airdropPath = process.argv[2];
if (!airdropPath) {
  console.error('Usage: ts-node runExecuteAirdrop.ts <path-to-airdrop-folder>');
  console.error('Example: ts-node runExecuteAirdrop.ts ./airdrops/airdrop_1764692418017');
  process.exit(1);
}

if (!fs.existsSync(airdropPath)) {
  console.error(`Airdrop folder not found: ${airdropPath}`);
  process.exit(1);
}

executeAirdrop(airdropPath);
