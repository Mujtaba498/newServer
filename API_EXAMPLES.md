# Grid Bot API Examples

## Updated Create Grid Bot API

The Create Grid Bot API now supports two modes:
1. **Manual Mode**: Provide all grid parameters manually
2. **AI Mode**: Let Kimi AI analyze and generate optimal parameters

### 1. Manual Mode (Original)

```bash
curl -X POST http://localhost:5000/api/grid-bots/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "BTC Manual Grid Bot",
    "symbol": "BTCUSDT",
    "upperPrice": 45000,
    "lowerPrice": 40000,
    "gridLevels": 10,
    "investmentAmount": 1000,
    "profitPerGrid": 0.5
  }'
```

### 2. AI Mode (New Feature)

```bash
curl -X POST http://localhost:5000/api/grid-bots/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "BTC AI Grid Bot",
    "symbol": "BTCUSDT",
    "investmentAmount": 1000,
    "useAI": true
  }'
```

### 3. Hybrid Mode (AI with Manual Override)

```bash
curl -X POST http://localhost:5000/api/grid-bots/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "ETH Hybrid Grid Bot",
    "symbol": "ETHUSDT",
    "investmentAmount": 500,
    "useAI": true,
    "upperPrice": 2500,
    "lowerPrice": 2000
  }'
```

## Response Format

When using AI mode, the response includes additional information:

```json
{
  "success": true,
  "message": "Grid bot created and started successfully! 🚀",
  "data": {
    "bot": {
      "_id": "bot_id",
      "name": "BTC AI Grid Bot",
      "symbol": "BTCUSDT",
      "config": {
        "upperPrice": 45000,
        "lowerPrice": 40000,
        "gridLevels": 12,
        "investmentAmount": 1000,
        "profitPerGrid": 0.6
      },
      "aiAnalysis": {
        "reasoning": "Based on current market volatility and 24h price movement, I recommend a 12-level grid with 0.6% profit per grid. The price range captures recent support/resistance levels.",
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
    "reasoning": "Based on current market volatility and 24h price movement..."
  }
}
```

## Key Features

### AI Analysis
- **Market Data Integration**: Fetches real-time price, volume, and volatility data
- **Intelligent Parameter Selection**: Optimizes grid levels, price range, and profit targets
- **Risk Assessment**: Considers market conditions and investment amount
- **Reasoning Provided**: Explains the logic behind parameter selection

### Validation
- Manual parameters are validated when `useAI` is false
- AI-generated parameters bypass manual validation
- Investment amount is always required and validated
- Symbol validation ensures trading pair exists on Binance

### Fallback Mechanism
- If AI analysis fails, the system provides sensible defaults
- Error handling ensures bot creation doesn't fail due to AI issues
- Manual override option available for hybrid approach

## Environment Setup

Ensure these environment variables are set:

```env
# Kimi AI Configuration
KIMI_API_KEY=your_kimi_api_key_here

# Binance API Configuration
BINANCE_API_KEY=your_binance_api_key
BINANCE_SECRET_KEY=your_binance_secret_key
```

## Error Handling

### AI Service Errors
```json
{
  "success": false,
  "message": "AI analysis failed, using default parameters",
  "data": {
    "bot": { /* bot with default parameters */ },
    "aiError": "API rate limit exceeded"
  }
}
```

### Validation Errors
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "investmentAmount",
      "message": "Investment amount must be at least 1"
    }
  ]
}
```

## Best Practices

1. **Use AI Mode for Beginners**: Let AI analyze market conditions and set optimal parameters
2. **Manual Mode for Experts**: Full control over grid configuration
3. **Hybrid Approach**: Use AI with manual overrides for specific requirements
4. **Monitor Performance**: Check the `aiAnalysis.reasoning` to understand AI decisions
5. **Regular Updates**: AI parameters are based on current market conditions

## Rate Limits

- Grid Bot Creation: 10 requests per minute
- AI Analysis: 5 requests per minute (due to external API calls)
- Market Data: 60 requests per minute