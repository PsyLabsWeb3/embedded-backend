// routes/price.ts
import express from "express";
import { fetchSolPrice } from "../services/solanaService";

const router = express.Router();

router.get("/solanaPriceUSD", async (req, res): Promise<any> => {
  const priceUsd = await fetchSolPrice();

  if (priceUsd == null || priceUsd === 0) {
    return res.status(502).json({ error: "Price currently unavailable" });
  }

  return res.json({ priceUsd });
});

export default router;