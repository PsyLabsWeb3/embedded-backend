import express from 'express'
import cors from 'cors'
import healthCheckRoutes from './routes/healthCheck'
import matchRoutes from './routes/match'
import leaderboardRoutes from './routes/leaderboard'
import priceRoutes from './routes/price'
import dotenv from 'dotenv'

dotenv.config()

const app = express()

app.use(cors())
app.use(express.json())

app.use('/api', healthCheckRoutes)
app.use('/api', matchRoutes)
app.use('/api', leaderboardRoutes)
app.use('/api', priceRoutes)

export default app