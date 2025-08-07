# Vercel Deployment Guide

## Prerequisites

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
2. **GitHub Repository**: Push your code to a GitHub repository
3. **MongoDB Atlas**: Set up a MongoDB Atlas cluster for production database

## Environment Variables

Set the following environment variables in your Vercel project dashboard:

### Required Variables
```
PORT=3000
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database
JWT_SECRET=your-super-secret-jwt-key-here
JWT_EXPIRES_IN=7d
BREVO_API_KEY=your-brevo-api-key
SENDER_EMAIL=your-sender-email@domain.com
SENDER_NAME=Your App Name
FRONTEND_URL=https://your-frontend-domain.vercel.app
```

### Optional Variables (for enhanced functionality)
```
BINANCE_API_KEY=your-global-binance-api-key
BINANCE_SECRET_KEY=your-global-binance-secret-key
```

## Deployment Steps

### Method 1: Vercel CLI

1. Install Vercel CLI:
   ```bash
   npm i -g vercel
   ```

2. Login to Vercel:
   ```bash
   vercel login
   ```

3. Deploy:
   ```bash
   vercel
   ```

### Method 2: GitHub Integration

1. Push your code to GitHub
2. Go to [Vercel Dashboard](https://vercel.com/dashboard)
3. Click "New Project"
4. Import your GitHub repository
5. Configure environment variables
6. Deploy

## Post-Deployment

1. **Test API Endpoints**: Verify all endpoints are working
2. **Database Connection**: Ensure MongoDB Atlas connection is successful
3. **Environment Variables**: Double-check all required variables are set
4. **CORS Configuration**: Update FRONTEND_URL to match your frontend domain

## Troubleshooting

### Common Issues

1. **Database Connection Errors**:
   - Verify MongoDB URI format
   - Check IP whitelist in MongoDB Atlas
   - Ensure database user has proper permissions

2. **Environment Variable Issues**:
   - Verify all required variables are set in Vercel dashboard
   - Check for typos in variable names
   - Redeploy after adding new variables

3. **CORS Errors**:
   - Update FRONTEND_URL to match your actual frontend domain
   - Ensure credentials are properly configured

4. **Function Timeout**:
   - Check if operations are taking too long
   - Consider optimizing database queries
   - Increase maxDuration in vercel.json if needed

## File Structure for Vercel

```
├── api/
│   └── index.js          # Vercel serverless function entry point
├── vercel.json           # Vercel configuration
├── .vercelignore         # Files to ignore during deployment
├── server.js             # Main Express application
└── ... (rest of your files)
```

## Performance Optimization

1. **Database Indexing**: Ensure proper indexes on frequently queried fields
2. **Connection Pooling**: MongoDB connection is automatically pooled
3. **Caching**: Consider implementing Redis for session storage
4. **Rate Limiting**: Already configured in the application

## Security Considerations

1. **Environment Variables**: Never commit sensitive data to repository
2. **CORS**: Properly configure allowed origins
3. **Rate Limiting**: Monitor and adjust limits as needed
4. **JWT Secret**: Use a strong, unique secret key

## Monitoring

1. **Vercel Analytics**: Enable in project settings
2. **Function Logs**: Monitor in Vercel dashboard
3. **Database Monitoring**: Use MongoDB Atlas monitoring tools
4. **Error Tracking**: Consider integrating Sentry or similar service