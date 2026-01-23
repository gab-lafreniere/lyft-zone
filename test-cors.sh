#!/bin/bash

# CORS Test Script for Lyft-Zone
# This script tests CORS configuration between frontend and backend

echo "================================"
echo "🧪 Lyft-Zone CORS Test Script"
echo "================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test backend health
echo "1️⃣ Testing Backend Health..."
BACKEND_URL="http://localhost:5000"
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/health")

if [ "$HEALTH_RESPONSE" = "200" ]; then
    echo -e "${GREEN}✅ Backend is running at $BACKEND_URL${NC}"
else
    echo -e "${RED}❌ Backend not responding (HTTP $HEALTH_RESPONSE)${NC}"
    echo "   Start backend with: cd backend && npm start"
    exit 1
fi

echo ""

# Test API endpoint
echo "2️⃣ Testing API Endpoint..."
API_RESPONSE=$(curl -s "$BACKEND_URL/api/exercises" | head -c 100)

if [ -z "$API_RESPONSE" ]; then
    echo -e "${RED}❌ API endpoint not responding${NC}"
else
    echo -e "${GREEN}✅ API endpoint is responding${NC}"
    echo "   Sample: ${API_RESPONSE}..."
fi

echo ""

# Test CORS headers
echo "3️⃣ Testing CORS Headers from localhost:3000..."
CORS_RESPONSE=$(curl -s -i -X OPTIONS \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Content-Type" \
  "$BACKEND_URL/api/exercises" 2>&1 | grep -i "access-control-allow-origin")

if [ -z "$CORS_RESPONSE" ]; then
    echo -e "${YELLOW}⚠️ CORS headers not present in preflight response${NC}"
    echo "   (This might be expected - check if CORS middleware is applied)"
else
    echo -e "${GREEN}✅ CORS headers present:${NC}"
    echo "   $CORS_RESPONSE"
fi

echo ""

# Summary
echo "================================"
echo "📊 Test Summary"
echo "================================"
echo "Backend Health: $HEALTH_RESPONSE"
echo ""
echo "Frontend URL (local):  http://localhost:3000"
echo "Backend URL (local):   http://localhost:5000"
echo ""
echo "💡 If tests pass, run:"
echo "   cd frontend && npm start"
echo ""
