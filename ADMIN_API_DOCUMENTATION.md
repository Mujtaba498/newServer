# Admin API Documentation

This document provides comprehensive information about the Admin API endpoints for the Grid Bot Trading Platform.

## Authentication

All admin endpoints require:
1. **Authentication**: Valid JWT token in Authorization header
2. **Admin Role**: User must have `role: "admin"` in their profile

### Headers Required
```
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json
```

## Admin Registration

To create an admin user, use the regular registration endpoint with `role: "admin"`:

```bash
curl -X POST "http://localhost:5000/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Admin User",
    "email": "admin@example.com",
    "password": "securepassword123",
    "role": "admin"
  }'
```

## Admin Endpoints

### 1. Get All Users

**Endpoint:** `GET /api/admin/users`

**Description:** Retrieve all users with their basic information and bot statistics.

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)
- `search` (optional): Search by name or email
- `role` (optional): Filter by role (user/admin)

**cURL Example:**
```bash
curl -X GET "http://localhost:5000/api/admin/users?page=1&limit=10&search=john&role=user" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "success": true,
  "message": "Users retrieved successfully",
  "data": {
    "users": [
      {
        "_id": "user_id",
        "name": "John Doe",
        "email": "john@example.com",
        "role": "user",
        "isVerified": true,
        "createdAt": "2024-01-01T00:00:00.000Z",
        "botStats": {
          "totalBots": 5,
          "activeBots": 3,
          "inactiveBots": 2
        },
        "subscriptionStatus": {
          "planType": "premium",
          "status": "active",
          "isActive": true,
          "endDate": "2024-02-01T00:00:00.000Z",
          "startDate": "2024-01-01T00:00:00.000Z"
        }
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 5,
      "totalUsers": 100,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

### 2. Get User Details

**Endpoint:** `GET /api/admin/users/:userId`

**Description:** Get detailed information about a specific user including all their bots and statistics.

**cURL Example:**
```bash
curl -X GET "http://localhost:5000/api/admin/users/USER_ID_HERE" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "success": true,
  "message": "User details retrieved successfully",
  "data": {
    "user": {
      "_id": "user_id",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "user",
      "isVerified": true,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "statistics": {
        "totalBots": 5,
        "activeBots": 3,
        "stoppedBots": 2,
        "pausedBots": 0,
        "totalInvestment": 5000,
        "totalProfit": 250.50,
        "completedTrades": 45,
        "profitPercentage": "5.01"
      }
    },
    "bots": [
      {
        "_id": "bot_id",
        "name": "BTC Grid Bot",
        "symbol": "BTCUSDT",
        "status": "active",
        "investmentAmount": 1000,
        "totalProfit": 50.25,
        "completedTrades": 12,
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

### 3. Get All Bots

**Endpoint:** `GET /api/admin/bots`

**Description:** Retrieve all bots across all users with filtering options.

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)
- `status` (optional): Filter by status (active/stopped/paused)
- `symbol` (optional): Filter by trading symbol
- `userId` (optional): Filter by specific user ID

**cURL Example:**
```bash
curl -X GET "http://localhost:5000/api/admin/bots?page=1&limit=10&status=active&symbol=BTC" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "success": true,
  "message": "All bots retrieved successfully",
  "data": {
    "bots": [
      {
        "_id": "bot_id",
        "name": "BTC Grid Bot",
        "symbol": "BTCUSDT",
        "status": "active",
        "investmentAmount": 1000,
        "totalProfit": 50.25,
        "completedTrades": 12,
        "createdAt": "2024-01-01T00:00:00.000Z",
        "userId": {
          "_id": "user_id",
          "name": "John Doe",
          "email": "john@example.com",
          "role": "user"
        }
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 10,
      "totalBots": 200,
      "hasNext": true,
      "hasPrev": false
    },
    "statistics": {
      "totalBots": 200,
      "activeBots": 150,
      "stoppedBots": 40,
      "pausedBots": 10,
      "totalInvestment": 100000,
      "totalProfit": 5000,
      "profitPercentage": "5.00"
    }
  }
}
```

### 4. Get Platform Statistics

**Endpoint:** `GET /api/admin/stats`

**Description:** Get comprehensive platform statistics including users, bots, and financial data.

**cURL Example:**
```bash
curl -X GET "http://localhost:5000/api/admin/stats" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "success": true,
  "message": "Platform statistics retrieved successfully",
  "data": {
    "users": {
      "total": 1000,
      "admins": 5,
      "regular": 995,
      "withBinanceConfig": 750,
      "recentSignups": 25
    },
    "bots": {
      "total": 2500,
      "active": 1800,
      "stopped": 600,
      "paused": 100,
      "recentlyCreated": 50
    },
    "financial": {
      "totalInvestment": 500000,
      "totalProfit": 25000,
      "totalTrades": 15000,
      "profitPercentage": "5.00",
      "averageInvestmentPerBot": "200.00"
    }
  }
}
```

### 5. Upgrade User to Premium

**Endpoint:** `POST /api/admin/users/:userId/upgrade-premium`

**Description:** Manually upgrade any user to premium status without requiring payment through Cryptomus. This endpoint allows administrators to grant premium access directly.

**Path Parameters:**
- `userId` (required): The ID of the user to upgrade

**Request Body:**
- `duration` (optional): Number of days for the premium subscription (default: 30)

**cURL Example:**
```bash
# Upgrade user to premium for default 30 days
curl -X POST "http://localhost:5000/api/admin/users/USER_ID_HERE/upgrade-premium" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'

# Upgrade user to premium for 60 days
curl -X POST "http://localhost:5000/api/admin/users/USER_ID_HERE/upgrade-premium" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"duration": 60}'
```

**Success Response (New Subscription):**
```json
{
  "success": true,
  "message": "User upgraded to premium for 30 days",
  "data": {
    "subscription": {
      "_id": "subscription_id",
      "userId": "user_id",
      "planType": "premium",
      "status": "active",
      "startDate": "2024-01-01T00:00:00.000Z",
      "endDate": "2024-01-31T00:00:00.000Z",
      "paymentId": "admin_upgrade_1704067200000_user_id",
      "autoRenew": false,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    },
    "user": {
      "id": "user_id",
      "name": "John Doe",
      "email": "john@example.com"
    }
  }
}
```

**Success Response (Extended Subscription):**
```json
{
  "success": true,
  "message": "Premium subscription extended by 30 days",
  "data": {
    "subscription": {
      "_id": "subscription_id",
      "userId": "user_id",
      "planType": "premium",
      "status": "active",
      "startDate": "2024-01-01T00:00:00.000Z",
      "endDate": "2024-02-30T00:00:00.000Z",
      "paymentId": "existing_payment_id",
      "autoRenew": false,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    },
    "newEndDate": "2024-02-30T00:00:00.000Z"
  }
}
```

**Error Responses:**

**400 Bad Request (Invalid User ID):**
```json
{
  "success": false,
  "message": "Invalid user ID"
}
```

**404 Not Found (User Not Found):**
```json
{
  "success": false,
  "message": "User not found"
}
```

**Features:**
- **Automatic Detection**: If user already has an active premium subscription, it extends the existing subscription instead of creating a new one
- **Flexible Duration**: Admins can specify custom duration in days (default: 30 days)
- **Unique Payment ID**: Generates unique payment IDs for admin upgrades for tracking purposes
- **No Payment Required**: Bypasses the Cryptomus payment process entirely
- **Immediate Activation**: Premium features are available immediately after upgrade

**Premium Plan Benefits:**
- Maximum of 3 bots (vs 1 for free users)
- Total investment limit of $1000 across all bots (vs $100 per bot for free users)
- Access to advanced bot features and analytics

## Admin Access to Regular Features

Admins can access all regular user features including:

### Grid Bot Management
- Create bots: `POST /api/grid-bots/create`
- Get admin's bots: `GET /api/grid-bots/`
- Start/Stop/Pause bots: `POST /api/grid-bots/:botId/start|stop|pause`
- Delete bots: `DELETE /api/grid-bots/:botId`
- Get bot performance: `GET /api/grid-bots/:botId/performance`
- Get bot analysis: `GET /api/grid-bots/:botId/analysis`

### Binance Integration
- Set credentials: `POST /api/auth/binance-credentials`
- Get credentials status: `GET /api/auth/binance-credentials/status`
- Remove credentials: `DELETE /api/auth/binance-credentials`

### Market Data
- Get symbols: `GET /api/grid-bots/symbols`
- Get market data: `GET /api/grid-bots/market/:symbol`
- Get account balance: `GET /api/grid-bots/account/balance`

## Error Responses

### 401 Unauthorized
```json
{
  "success": false,
  "message": "Access denied. Please login first."
}
```

### 403 Forbidden
```json
{
  "success": false,
  "message": "Access denied. Admin privileges required."
}
```

### 404 Not Found
```json
{
  "success": false,
  "message": "User not found"
}
```

### 429 Rate Limited
```json
{
  "success": false,
  "message": "Too many admin requests, please try again later."
}
```

### 500 Server Error
```json
{
  "success": false,
  "message": "Server error while fetching data"
}
```

## Rate Limiting

Admin endpoints are rate limited to:
- **100 requests per 15 minutes** per IP address

## Security Notes

1. **Admin Role Required**: All admin endpoints require the user to have `role: "admin"`
2. **JWT Authentication**: Valid JWT token must be provided in Authorization header
3. **Sensitive Data Protection**: API keys and secrets are never exposed in responses
4. **Rate Limiting**: Prevents abuse with reasonable limits for admin operations
5. **Input Validation**: All inputs are validated and sanitized

## Quick Start for Admins

1. **Register as Admin:**
   ```bash
   curl -X POST "http://localhost:5000/api/auth/register" \
     -H "Content-Type: application/json" \
     -d '{"name":"Admin","email":"admin@example.com","password":"password123","role":"admin"}'
   ```

2. **Login and Get Token:**
   ```bash
   curl -X POST "http://localhost:5000/api/auth/login" \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@example.com","password":"password123"}'
   ```

3. **View Platform Stats:**
   ```bash
   curl -X GET "http://localhost:5000/api/admin/stats" \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

4. **View All Users:**
   ```bash
   curl -X GET "http://localhost:5000/api/admin/users" \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```