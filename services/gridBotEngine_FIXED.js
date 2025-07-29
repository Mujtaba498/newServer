// FIXED VERSION - liquidateRemainingHoldings method
// This is the corrected version of the liquidateRemainingHoldings method

async liquidateRemainingHoldings(bot) {
  try {
    console.log(`💰 Checking holdings to liquidate for ${bot.symbol}...`);
    
    // Get account balance
    const client = await binanceService.getUserClient(bot.user_id, bot.test_mode);
    if (!client) {
      console.error('❌ Could not get user client for liquidation');
      return;
    }

    // STEP 1: Get initial balance to check total holdings
    let account = await client.accountInfo();
    const baseAsset = bot.symbol.replace('USDT', '');
    let baseBalance = account.balances.find(b => b.asset === baseAsset);
    
    if (!baseBalance) {
      console.log(`✅ No ${baseAsset} balance found in account`);
      return;
    }

    // CRITICAL FIX: Check TOTAL balance (free + locked), not just free
    const totalHoldings = parseFloat(baseBalance.free) + parseFloat(baseBalance.locked);
    console.log(`📊 ${baseAsset} Balance - Free: ${baseBalance.free}, Locked: ${baseBalance.locked}, Total: ${totalHoldings}`);
    
    if (totalHoldings <= 0) {
      console.log(`✅ No ${baseAsset} holdings to liquidate (total: ${totalHoldings})`);
      return;
    }

    // STEP 2: Wait for balance updates after order cancellations
    // When orders are cancelled, locked balance moves to free with some delay
    console.log(`⏳ Waiting 3 seconds for balance updates after order cancellations...`);
    await new Promise(resolve => setTimeout(resolve, 3000));

    // STEP 3: Re-fetch fresh balance after delay
    account = await client.accountInfo();
    baseBalance = account.balances.find(b => b.asset === baseAsset);
    
    if (!baseBalance) {
      console.log(`❌ ${baseAsset} balance disappeared after refresh`);
      return;
    }

    // STEP 4: Use free balance for liquidation (should be updated now)
    let availableQuantity = parseFloat(baseBalance.free);
    console.log(`💸 Available for liquidation: ${availableQuantity} ${baseAsset}`);

    // FALLBACK: If free is still 0 but we know there are holdings, force liquidation
    if (availableQuantity <= 0 && totalHoldings > 0) {
      console.log(`⚠️ Free balance still 0, but total holdings exist. Using total holdings for liquidation.`);
      availableQuantity = totalHoldings;
    }

    if (availableQuantity <= 0) {
      console.log(`✅ No available ${baseAsset} to liquidate after balance refresh`);
      return;
    }

    // STEP 5: Get symbol info for proper quantity formatting
    const symbolInfo = await binanceService.getSymbolInfo(bot.symbol);
    if (!symbolInfo.success) {
      console.error(`❌ Could not get symbol info for ${bot.symbol}`);
      return;
    }

    // Apply minimum quantity filter
    const minQty = parseFloat(symbolInfo.minQty) || 0;
    if (availableQuantity < minQty) {
      console.log(`⚠️ Quantity ${availableQuantity} below minimum ${minQty}, skipping liquidation`);
      return;
    }

    const formattedQuantity = binanceService.formatQuantity(availableQuantity, symbolInfo.stepSize);
    console.log(`📏 Formatted quantity for liquidation: ${formattedQuantity} ${baseAsset}`);

    // STEP 6: Place market sell order to liquidate
    const liquidationClientOrderId = `liq_${bot._id.toString().slice(-8)}_${Date.now().toString().slice(-6)}`;
    
    console.log(`🔥 EXECUTING MARKET SELL: ${formattedQuantity} ${baseAsset} at market price`);
    
    const marketSellResult = await binanceService.placeMarketOrder(
      bot.user_id,
      bot.symbol,
      'SELL',
      formattedQuantity,
      bot.test_mode,
      { newClientOrderId: liquidationClientOrderId }
    );

    // STEP 7: Handle liquidation result
    if (marketSellResult.success) {
      console.log(`✅ LIQUIDATION SUCCESSFUL: Sold ${formattedQuantity} ${baseAsset}`);
      
      // Save liquidation order to database
      const liquidationOrder = new GridOrder({
        bot_id: bot._id,
        binance_order_id: marketSellResult.order.orderId,
        client_order_id: marketSellResult.order.clientOrderId,
        symbol: bot.symbol,
        price: 0, // Market order, price determined by fills
        quantity: formattedQuantity,
        filled_price: 0, // Will be calculated from fills
        filled_quantity: marketSellResult.order.executedQty,
        side: 'SELL',
        status: 'FILLED',
        grid_level: -998, // Special level for liquidation
        order_type: 'LIQUIDATION',
        created_at: new Date(),
        filled_at: new Date()
      });

      // Calculate average fill price from fills
      if (marketSellResult.order.fills && marketSellResult.order.fills.length > 0) {
        const totalQty = marketSellResult.order.fills.reduce((sum, fill) => sum + parseFloat(fill.qty), 0);
        const totalValue = marketSellResult.order.fills.reduce((sum, fill) => sum + (parseFloat(fill.price) * parseFloat(fill.qty)), 0);
        const avgPrice = totalValue / totalQty;
        
        liquidationOrder.filled_price = avgPrice;
        liquidationOrder.price = avgPrice;
        
        console.log(`💰 Liquidation executed at average price: ${avgPrice.toFixed(6)} USDT`);
        console.log(`💵 Total liquidation value: ${totalValue.toFixed(2)} USDT`);
      }

      await liquidationOrder.save();
      
      // STEP 8: Verify liquidation success by checking balance again
      const finalAccount = await client.accountInfo();
      const finalBalance = finalAccount.balances.find(b => b.asset === baseAsset);
      const remainingBalance = finalBalance ? parseFloat(finalBalance.free) + parseFloat(finalBalance.locked) : 0;
      
      if (remainingBalance > 0.001) { // Allow for small dust amounts
        console.log(`⚠️ WARNING: ${remainingBalance} ${baseAsset} still remaining after liquidation`);
      } else {
        console.log(`✅ COMPLETE LIQUIDATION: All ${baseAsset} positions closed successfully`);
      }
      
    } else {
      console.error(`❌ LIQUIDATION FAILED: ${marketSellResult.error}`);
      
      // CRITICAL: Log this failure for manual intervention
      console.error(`🚨 MANUAL INTERVENTION REQUIRED: Bot ${bot._id} has ${availableQuantity} ${baseAsset} that failed to liquidate`);
      console.error(`🚨 User: ${bot.user_id}, Symbol: ${bot.symbol}, Test Mode: ${bot.test_mode}`);
    }

  } catch (error) {
    console.error(`❌ Critical error in liquidation: ${error.message}`);
    console.error(`🚨 MANUAL INTERVENTION REQUIRED: Bot ${bot._id} liquidation failed completely`);
    
    // In production, you might want to send an alert/notification here
    // await this.sendCriticalAlert(bot, error);
  }
}