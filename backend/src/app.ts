import express from 'express'
import cors from 'cors'
import matchRoutes from './routes/match'
import healthCheckRoutes from './routes/healthCheck'
import dotenv from 'dotenv'

dotenv.config()

const app = express()

app.use(cors())
app.use(express.json())

app.use('/api', matchRoutes)
app.use('/api', healthCheckRoutes)

export default app