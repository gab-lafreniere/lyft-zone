# Lyft Zone Backend

Node.js + Express backend for Lyft Zone training app with SQLite database.

## Setup

1. Install dependencies: `npm install`
2. Run the server: `npm start`
3. API will be available at `http://localhost:5000`

## API Endpoints

- `GET /api/exercises` - List all exercises
- `GET /api/exercises/:id` - Get a single exercise
- `POST /api/plans` - Create a training plan
- `GET /api/plans/:userId` - Get all plans for a user
- `GET /health` - Health check

## Database

Uses SQLite with Sequelize ORM. Database file: `database.sqlite`
