# Grid Bot Recovery Feature Documentation

## Overview

The recovery feature ensures that your grid trading bot can gracefully handle server crashes or unexpected shutdowns. When your server restarts, the system automatically detects any filled buy orders that don't have corresponding sell orders and places the missing sell orders to maintain your grid strategy.

## How It Works

### Automatic Recovery on Server Restart

When the server starts, it automatically:
1. **Scans all active bots** that should be running
2. **Synchronizes order status** with Binance to get the latest state
3. **Identifies missing sell orders** for filled buy orders
4. **Places missing sell orders** at the correct grid levels
5. **Updates bot statistics** to reflect the recovery
6. **Resumes normal operation** with all orders properly aligned

### Recovery Process Flow

```
Server Startup → Recovery Check → Order Status Sync → Identify Missing Orders → Place Missing Orders → Resume Trading
```

## Key Features

### 1. **Order Status Synchronization**
- Fetches real-time order status from Binance
- Updates local database with latest execution details
- Handles partial fills and cancellations

### 2. **Missing Sell Order Detection**
- Identifies filled buy orders without corresponding sell orders
- Calculates expected sell prices based on grid configuration
- Verifies account balance before placing orders

### 3. **Safe Recovery**
- Only places orders when sufficient balance is available
- Prevents duplicate orders through order tracking
- Includes retry logic for failed order placements

### 4. **Recovery History**
- Maintains detailed logs of all recovery actions
- Tracks which orders were placed during recovery
- Provides transparency for debugging and auditing

## Usage

### Automatic Recovery (Default)
Recovery runs automatically when the server starts. No manual intervention required.

```bash
# Start your server normally
npm start

# Server logs will show:
# 🔄 Running bot recovery check...
# ✅ Recovery check completed
```

### Manual Recovery Trigger
You can manually trigger recovery for specific bots via API:

```bash
# Trigger recovery for a specific bot
curl -X POST http://localhost:5000/api/grid-bots/:botId/recover \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Response Format

```json
{
  "success": true,
  "message": "Bot recovery completed successfully",
  "bot": {
    "id": "bot_id_here",
    "status": "active",
    "recoveryHistory": [
      {
        "timestamp": "2024-01-15T10:30:00.000Z",
        "type": "sell_order_recovery",
        "ordersPlaced": 3,
        "orderIds": ["12345", "12346", "12347"]
      }
    ]
  }
}
```

## Monitoring Recovery

### Server Logs
Recovery activities are logged with detailed information:
- `Starting recovery for bot [bot_id] ([symbol])`
- `Bot [bot_id] needs recovery: [n] missing sell orders`
- `Placed recovery sell order: [order_id] at price [price]`

### Recovery Status API
Check recovery status for any bot:

```bash
curl http://localhost:5000/api/grid-bots/:botId \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

Look for these fields in the response:
- `recoveryHistory` - Array of recovery events
- `status` - Should be "active" after successful recovery
- `orders` - Check for `isRecoveryOrder: true` flags

## Configuration

### Recovery Settings
Recovery behavior can be adjusted by modifying environment variables:

```bash
# Optional: Add to your .env file
RECOVERY_TIMEOUT=30000        # Max time for recovery per bot (ms)
RECOVERY_RETRY_ATTEMPTS=3   # Retry attempts for failed order placements
```

### Bot Model Updates
The bot model includes new fields for recovery tracking:

- `orders[].isFilled` - Boolean indicating if order is completely filled
- `orders[].filledAt` - Timestamp when order was filled
- `orders[].hasCorrespondingSell` - Boolean indicating if sell order exists for buy order
- `orders[].isRecoveryOrder` - Boolean indicating if order was placed during recovery
- `recoveryHistory` - Array tracking all recovery events

## Troubleshooting

### Common Issues

#### 1. **Insufficient Balance for Recovery**
**Symptoms**: Recovery fails with "Insufficient balance" error
**Solution**: 
- Check your account balance
- Ensure you have the base asset available for sell orders
- Wait for any pending trades to settle

#### 2. **Orders Not Being Detected**
**Symptoms**: Recovery doesn't find missing orders
**Solution**:
- Verify order status on Binance
- Check if orders were manually canceled
- Ensure bot has correct symbol configuration

#### 3. **Recovery Taking Too Long**
**Symptoms**: Recovery process seems stuck
**Solution**:
- Check server logs for error messages
- Verify Binance API connectivity
- Check rate limits on your API key

### Debug Commands

```bash
# Check recovery status
node -e "
const recoveryService = require('./services/recoveryService');
recoveryService.getRecoveryStatus('YOUR_BOT_ID').then(console.log);
"

# Force recovery for specific bot
node -e "
const recoveryService = require('./services/recoveryService');
const GridBot = require('./models/GridBot');
GridBot.findById('YOUR_BOT_ID').then(bot => {
  if (bot) recoveryService.recoverBot(bot);
});
"
```

## Best Practices

### 1. **Regular Monitoring**
- Monitor server logs for recovery messages
- Check bot performance regularly
- Set up alerts for failed recoveries

### 2. **Backup Strategies**
- Keep regular backups of your bot configurations
- Monitor account balances to ensure sufficient funds
- Use multiple API keys for redundancy

### 3. **Testing Recovery**
- Test recovery in a development environment
- Use small amounts for initial testing
- Monitor recovery behavior with different market conditions

### 4. **Maintenance**
- Regularly update the bot software
- Monitor Binance API changes
- Keep recovery service updated with latest features

## Technical Details

### Recovery Algorithm

1. **Bot Discovery**: Find all bots with status 'active' or 'recovering'
2. **Order Sync**: Fetch latest order status from Binance
3. **Gap Analysis**: Identify filled buy orders without sell orders
4. **Price Calculation**: Compute expected sell prices using grid parameters
5. **Balance Check**: Verify sufficient balance for new orders
6. **Order Placement**: Place missing sell orders at calculated prices
7. **Status Update**: Mark buy orders as having corresponding sells
8. **History Logging**: Record recovery actions for audit trail

### Recovery Fields in Database

```javascript
// Order schema additions
{
  isFilled: Boolean,           // Order completely filled
  filledAt: Date,            // When order was filled
  hasCorrespondingSell: Boolean, // Sell order exists for this buy
  isRecoveryOrder: Boolean    // Order placed during recovery
}

// Bot schema additions
{
  recoveryHistory: [{
    timestamp: Date,           // When recovery occurred
    type: String,            // Type of recovery action
    ordersPlaced: Number,    // How many orders were placed
    orderIds: [String],      // IDs of placed orders
    details: Object          // Additional context
  }]
}
```

## Support

For issues with recovery:
1. Check server logs for detailed error messages
2. Verify Binance API connectivity
3. Ensure sufficient account balances
4. Review bot configuration parameters
5. Check for any manual interventions on Binance

The recovery system is designed to be robust and handle most common failure scenarios automatically. However, manual intervention may be required for edge cases or complex market conditions.