// Plan Controller
// Handles business logic for training plans
// Functions: createPlan, getPlansByUserId

const Plan = require('../models/Plan');

// Create a new training plan
const createPlan = async (req, res) => {
  try {
    const { userId, name, exercises } = req.body;

    if (!userId || !name || !exercises) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: userId, name, exercises',
      });
    }

    const plan = await Plan.create({
      userId,
      name,
      exercises,
    });

    res.status(201).json({
      success: true,
      message: 'Plan created successfully',
      data: plan,
    });
  } catch (error) {
    console.error('Error creating plan:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating plan',
      error: error.message,
    });
  }
};

// Get all plans for a specific user
const getPlansByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    const plans = await Plan.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
    });

    res.status(200).json({
      success: true,
      count: plans.length,
      data: plans,
    });
  } catch (error) {
    console.error('Error fetching plans:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching plans',
      error: error.message,
    });
  }
};

module.exports = {
  createPlan,
  getPlansByUserId,
};
