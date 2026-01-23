# Lyft Zone Backend - Quick Start Guide

## ✓ Setup Complete!

Your Node.js/Express backend is fully configured and ready to use.

### Start the Server

```bash
cd /workspaces/lyft-zone/backend
npm start
```

Server will run on: **http://localhost:5000**

### API Endpoints

#### Health Check
```bash
GET http://localhost:5000/health
```

#### Exercises
```bash
# Get all exercises
GET http://localhost:5000/api/exercises

# Get single exercise by ID
GET http://localhost:5000/api/exercises/1
```

#### Training Plans
```bash
# Create a new training plan
POST http://localhost:5000/api/plans
Body: {
  "userId": "user123",
  "name": "Full Body",
  "exercises": [1, 3, 5]
}

# Get all plans for a user
GET http://localhost:5000/api/plans/user123
```

### Project Structure

```
backend/
├── server.js                 # Express app entry point
├── db.js                     # Database configuration
├── package.json              # Dependencies
├── .env                      # Environment variables
│
├── models/
│   ├── Exercise.js          # Exercise model (Sequelize)
│   └── Plan.js              # Training Plan model
│
├── controllers/
│   ├── exerciseController.js # Exercise business logic
│   └── planController.js     # Plan business logic
│
├── routes/
│   ├── exercises.js         # Exercise endpoints
│   └── plans.js             # Plan endpoints
│
└── data/
    └── exercises.json       # Sample exercise data (12 exercises)
```

### Database

- **Type**: SQLite
- **File**: `database.sqlite` (auto-created)
- **ORM**: Sequelize
- **Tables**: exercises, plans

### Features Implemented

✓ Express REST API with CORS  
✓ SQLite database with Sequelize ORM  
✓ 2 Models: Exercise, Plan  
✓ 2 Controllers: exerciseController, planController  
✓ 4 Main API endpoints  
✓ Environment configuration with dotenv  
✓ 12 sample exercises pre-loaded  
✓ Automatic database initialization  
✓ Full error handling  
✓ Ready for frontend integration  

### Environment Variables

Located in `.env`:
```
PORT=5000
DATABASE_URL=./database.sqlite
NODE_ENV=development
```

### Sample Requests

#### Get All Exercises
```bash
curl http://localhost:5000/api/exercises
```

#### Create a Plan
```bash
curl -X POST http://localhost:5000/api/plans \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "john_doe",
    "name": "Push Day",
    "exercises": [1, 2, 7]
  }'
```

#### Get User Plans
```bash
curl http://localhost:5000/api/plans/john_doe
```

### Connected to Frontend

This backend is fully integrated with your React + Tailwind frontend in the `frontend/` folder. The frontend is configured with CORS support to communicate with this backend.

### Next Steps

1. Run the backend: `npm start`
2. In another terminal, start the frontend: `cd ../frontend && npm start`
3. Access the app: http://localhost:3000

### Troubleshooting

**Port already in use?**
```bash
# Change PORT in .env and restart
PORT=5001 npm start
```

**Database issues?**
```bash
# Reset database
rm database.sqlite
npm start
```

**CORS errors?**
The backend is already configured with `cors()` enabled. Make sure frontend URL matches allowed origins if needed.

---

Backend fully functional and ready to connect with your React frontend! 🚀
