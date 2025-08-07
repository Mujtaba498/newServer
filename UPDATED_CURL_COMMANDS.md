# Updated cURL Commands for Grid Trading Bot APIs

## Authentication APIs (Unchanged)

### 1. Register User
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "password": "SecurePass123!"
  }'
```

### 2. Login User
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "SecurePass123!"
  }'
```

### 3. Get User Profile
```bash
curl -X GET http://localhost:5000/api/auth/profile \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Grid Bot APIs (Updated)

### 1. Create Grid Bot - AI Mode (NEW)
**Let AI analyze market conditions and generate optimal parameters:**

```bash
curl -X POST http://localhost:5000/api/grid-bots/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "BTC AI Smart Grid",
    "symbol": "BTCUSDT",
    "investmentAmount": 1000,
    "useAI": true
  }'
```

### 2. Create Grid Bot - Manual Mode (Original)
**Specify all parameters manually:**

```bash
curl -X POST http://localhost:5000/api/grid-bots/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "ETH Manual Grid",
    "symbol": "ETHUSDT",
    "upperPrice": 2500,
    "lowerPrice": 2000,
    "gridLevels": 15,
    "investmentAmount": 500,
    "profitPerGrid": 0.8
  }'
```

### 3. Create Grid Bot - Hybrid Mode (NEW)
**Use AI with manual overrides:**

```bash
curl -X POST http://localhost:5000/api/grid-bots/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "ADA Hybrid Grid",
    "symbol": "ADAUSDT",
    "investmentAmount": 300,
    "useAI": true,
    "upperPrice": 0.6,
    "lowerPrice": 0.4
  }'
```

### 4. Get All User Grid Bots
```bash
curl -X GET http://localhost:5000/api/grid-bots/ \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 5. Get Specific Grid Bot
```bash
curl -X GET http://localhost:5000/api/grid-bots/BOT_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 6. Start Grid Bot
```bash
curl -X POST http://localhost:5000/api/grid-bots/BOT_ID/start \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 7. Stop Grid Bot
```bash
curl -X POST http://localhost:5000/api/grid-bots/BOT_ID/stop \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 8. Pause Grid Bot
```bash
curl -X POST http://localhost:5000/api/grid-bots/BOT_ID/pause \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 9. Delete Grid Bot
```bash
curl -X DELETE http://localhost:5000/api/grid-bots/BOT_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 10. Get Grid Bot Performance
```bash
curl -X GET http://localhost:5000/api/grid-bots/BOT_ID/performance \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Market Data APIs (Unchanged)

### 1. Get Market Data for Symbol
```bash
curl -X GET http://localhost:5000/api/grid-bots/market/BTCUSDT \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 2. Get Account Balance
```bash
curl -X GET http://localhost:5000/api/grid-bots/account/balance \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Example AI Response

When using AI mode, you'll receive enhanced response data:

```json
{
  "success": true,
  "message": "Grid bot created and started successfully! 🚀",
  "data": {
    "bot": {
      "_id": "65a1b2c3d4e5f6789012345",
      "name": "BTC AI Smart Grid",
      "symbol": "BTCUSDT",
      "status": "active",
      "config": {
        "upperPrice": 45000,
        "lowerPrice": 40000,
        "gridLevels": 12,
        "investmentAmount": 1000,
        "profitPerGrid": 0.6
      },
      "aiAnalysis": {
        "reasoning": "Based on current BTC volatility of 3.2% and recent 24h volume of $1.5B, I recommend a 12-level grid spanning $40,000-$45,000. This range captures key support/resistance levels while the 0.6% profit per grid balances frequency and profitability in current market conditions.",
        "generatedAt": "2024-01-15T10:30:00.000Z",
        "parameters": {
          "upperPrice": 45000,
          "lowerPrice": 40000,
          "gridLevels": 12,
          "profitPerGrid": 0.6
        },
        "marketData": {
          "currentPrice": 42500,
          "priceChange24h": 2.5,
          "volume24h": 1500000000,
          "volatility": 3.2
        }
      }
    }
  },
  "info": {
    "ordersPlaced": 12,
    "investmentAllocated": 1000,
    "gridRange": "40000 - 45000",
    "profitTarget": "0.6% per grid",
    "aiGenerated": true,
    "reasoning": "Based on current BTC volatility..."
  }
}
```

## Testing Different Scenarios

### High Investment Amount
```bash
curl -X POST http://localhost:5000/api/grid-bot/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "BTC Large Investment",
    "symbol": "BTCUSDT",
    "investmentAmount": 10000,
    "useAI": true
  }'
```

### Small Investment Amount
```bash
curl -X POST http://localhost:5000/api/grid-bot/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "ETH Small Investment",
    "symbol": "ETHUSDT",
    "investmentAmount": 100,
    "useAI": true
  }'
```

### Different Trading Pairs
```bash
# Solana
curl -X POST http://localhost:5000/api/grid-bot/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "SOL AI Grid",
    "symbol": "SOLUSDT",
    "investmentAmount": 500,
    "useAI": true
  }'

# Cardano
curl -X POST http://localhost:5000/api/grid-bot/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "ADA AI Grid",
    "symbol": "ADAUSDT",
    "investmentAmount": 200,
    "useAI": true
  }'
```

## Notes

1. **JWT Token**: Replace `YOUR_JWT_TOKEN` with the actual token received from login
2. **Bot ID**: Replace `BOT_ID` with the actual bot ID from creation response
3. **Rate Limits**: AI mode has lower rate limits due to external API calls
4. **Fallback**: If AI analysis fails, the system uses sensible defaults
5. **Validation**: Manual parameters are still validated when not using AI
6. **Environment**: Ensure `KIMI_API_KEY` is set in your `.env` file