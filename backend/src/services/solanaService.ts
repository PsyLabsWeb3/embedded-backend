import axios from "axios";

const COINGECKO_URL = process.env.COINGECKO_URL || "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";

let cachedPrice: number = 0;

let lastFetched = 0;

export async function fetchSolPrice(): Promise<number> {
    try {
        const now = Date.now();

        if (!cachedPrice || cachedPrice === 0 || now - lastFetched > 30000) {
            cachedPrice = await fetchSolPriceFromAPI();

            if (!cachedPrice) {
                console.error('Failed to fetch Solana price');
                return 0;
            }

            lastFetched = now;
        }

        return cachedPrice;
    } catch (err) {
        console.error('Unexpected error in fetchSolPrice:', err);
        return 0;
    }
}

async function fetchSolPriceFromAPI(): Promise<number> {
    const resp = await axios.get(COINGECKO_URL, {
        timeout: 10_000,
        headers: {
            "User-Agent": "embedded-backend/1.0",
            Accept: "application/json",
        },
    });
    const responsePrice = resp?.data?.solana?.usd;

    if (typeof responsePrice !== "number") {
        throw new Error("Unexpected price API response");
    }

    return responsePrice;
}