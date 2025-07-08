import crypto from 'crypto'
import { Request, Response, NextFunction } from 'express'

export function verifySignature(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers['x-signature'] as string
  const timestamp = req.headers['x-timestamp'] as string
  const body = JSON.stringify(req.body)
  const secret = process.env.EMBEDDED_API_SECRET

  if (!signature || !timestamp || !secret) {
    res.status(401).json({ error: 'Missing auth headers' })
    return
  }

  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - parseInt(timestamp)) > 30) {
    res.status(401).json({ error: 'Timestamp expired' })
    return
  }

  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(body + timestamp)
  const expected = hmac.digest('hex')

  if (expected !== signature) {
    res.status(401).json({ error: 'Invalid signature' })
    return
  }

  next()
}