import express from 'express'

const router = express.Router()

// GET /
router.get('/', async (req, res):  Promise<any> => {
  res.json({ message: 'Hello World! Welcome to the Embedded API.' })
})

export default router