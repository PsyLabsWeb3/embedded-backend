# Embedded Backend

This repository contains the backend and database setup for the Embedded gaming platform. Content:

- PostgreSQL database running locally via Docker
- Node.js + Express backend + Prisma for schema modeling and database access (Typescript)

## Project Structure

```
embedded-backend/
├── backend/ # Express backend + Prisma client
│ ├── prisma/ # Prisma schema
│ ├── src/routes/ # API routes
│ └── .env # Environment variables
│
└── database/ # Local PostgreSQL setup (Docker)
│ └── docker-compose.yml
│
└── EmbeddedAPI/ # C# DLL to safely call the backend through Unity

```

## Requirements

- Node.js (>= 18)
- Docker + Docker Compose
- PostgreSQL Client (optional for CLI/GUI)
- Prisma CLI (npx prisma)

## Getting Started

### 1. Start PostgreSQL (Docker)

From the root of the project:

```bash
cd database
docker compose up -d
```

This will start PostgreSQL locally with:

- User: embedded
- Password: dev
- Database: embedded_dev
- Port: 5432

Accessible at: postgresql://embedded:dev@localhost:5432/embedded_dev

### 2. Set up the Backend

```bash
cd ../backend
npm install
```

Then configure your environment:

.env

DATABASE_URL="postgresql://embedded:dev@localhost:5432/embedded_dev"

### 3. Run Prisma Setup

```bash
npx prisma generate
npx prisma migrate dev --name init
```

Optional: view your data with Prisma Studio:

```bash
npx prisma studio
```

### 4. Run the Backend Server

```bash
npm run dev
```

Accessible at: http://localhost:3000/api/

### 5. Compile the EmbeddedAPI Unity DLL

From the root of the project:

```bash
cd EmbeddedAPI/
dotnet build -c Release
```

Output DLL: EmbeddedAPI/bin/Release/netstandard2.1/EmbeddedAPI.dll

### 6. Usage from Unity

Copy EmbeddedAPI.dll into your Unity project:

```bash
Assets/Plugins/EmbeddedAPI.dll
```

In Unity scripts, use it like this:

```bash
using UnityEngine;
using System.Threading.Tasks;
using EmbeddedAPI;

public class MatchExample : MonoBehaviour
{
    async void Start()
    {
        string wallet = "test_wallet_123";
        string tx = "fake_tx_abc";

        string matchId = await API.RegisterPlayerAsync(wallet, tx);
        Debug.Log("Match ID: " + matchId);

        await API.ReportMatchResultAsync(matchId, wallet, "test_wallet_456");
    }
}
```

## License

MIT – Copyright © Embedded