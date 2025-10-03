import { prisma } from '../prisma'

export async function deleteEntryFeeTx(txSig: string) {
  console.log("Deleting transaction from DB: " + txSig);
  try {
    await prisma.entryFeeTransaction.delete({
      where: { txSig },
    });
    console.log("Transaction deleted.");
  } catch (e: any) {
    if (e.code === "P2025") {
      console.error("Transaction not found.");
    }
  }
}