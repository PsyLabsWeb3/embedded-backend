import express from 'express'
import { verifySignature } from '../middleware/verifySignature'

const router = express.Router()

type GeoResponse = {
  query?: string;
  country?: string;
  countryCode?: string;
  error?: boolean;
  reason?: string;
};

function normalizeIp(ip: string): string {
  if (!ip) return "";

  if (ip.startsWith("::ffff:")) {
    return ip.slice(7);
  }

  if (ip === "::1") {
    return "127.0.0.1";
  }

  return ip;
}

function getBlockedCountriesAll(): Set<string> {
  return new Set(
    (process.env.BLOCKED_COUNTRIES_ALL ?? "")
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean)
  );
}

function getBlockedCountriesWager(): Set<string> {
  return new Set(
    (process.env.BLOCKED_COUNTRIES_WAGER ?? "")
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean)
  );
}

// GET /geo
router.get('/geo', verifySignature, async (req, res): Promise<any> => {
  try {
    const ip = normalizeIp(req.ip || "");
    const blockedCountriesAll = getBlockedCountriesAll();
    const blockedCountriesWager = getBlockedCountriesWager();

    if (!ip) {
      return res.status(400).json({
        allowed: true,
        allowedToWager: false,
        error: "Could not determine client IP",
      });
    }

    console.log("/geo Request client IP: ", ip);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}`, {
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error("/geo Request to API failed. Response not OK:", response);
      return res.status(502).json({
        allowed: true,
        allowedToWager: false,
        error: "Geolocation service failed",
      });
    }

    const geo = (await response.json()) as GeoResponse;

    if (geo.error || !geo.countryCode) {
      console.error("/geo Request to API failed. Reason: ", geo.reason || "Country could not be determined");
      return res.status(502).json({
        allowed: true,
        allowedToWager: false,
        error: geo.reason || "Country could not be determined",
      });
    }

    const countryCode = geo.countryCode.toUpperCase();
    const allowed = !blockedCountriesAll.has(countryCode);
    var allowedToWager;
    if(!allowed) {
      allowedToWager = false;
    } else {
      allowedToWager = !blockedCountriesWager.has(countryCode);
    }

    console.log("/geo Country Code: ", countryCode);
    console.log("/geo Allowed: ", allowed);
    console.log("/geo Allowed to Wager: ", allowedToWager);

    return res.status(200).json({
      allowed,
      allowedToWager,
      ip,
      countryCode,
      countryName: geo.country ?? null,
    });
  } catch (error) {
    console.error("GET /geo error:", error);

    return res.status(500).json({
      allowed: true,
      allowedToWager: false,
      error: "Internal server error",
    });
  }
});

export default router