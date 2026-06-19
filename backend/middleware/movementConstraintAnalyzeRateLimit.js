const USER_WINDOW_MS = 30 * 1000;
const IP_WINDOW_MS = 15 * 60 * 1000;
const MAX_IP_ANALYSES = 20;

function createRateLimitError() {
  return {
    error: {
      code: 'AI_ANALYZE_RATE_LIMITED',
      message: 'Please wait before running another AI analysis.',
    },
  };
}

function resolveClientIp(req) {
  const forwardedFor = String(req.headers?.['x-forwarded-for'] || '').trim();
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function pruneIpEntries(entries, now) {
  return entries.filter((timestamp) => now - timestamp < IP_WINDOW_MS);
}

function createMovementConstraintAnalyzeRateLimit(options = {}) {
  const userLastAnalysisAt = options.userLastAnalysisAt || new Map();
  const ipAnalysisTimestamps = options.ipAnalysisTimestamps || new Map();
  const nowFn = options.now || (() => Date.now());

  function movementConstraintAnalyzeRateLimitMiddleware(req, res, next) {
    const now = nowFn();
    const userId = String(req.params?.userId || '').trim();
    const ip = resolveClientIp(req);
    const ipEntries = pruneIpEntries(ipAnalysisTimestamps.get(ip) || [], now);

    if (ipEntries.length >= MAX_IP_ANALYSES) {
      return res.status(429).json(createRateLimitError());
    }

    const lastUserAnalysisAt = userLastAnalysisAt.get(userId);
    if (userId && lastUserAnalysisAt && now - lastUserAnalysisAt < USER_WINDOW_MS) {
      ipAnalysisTimestamps.set(ip, ipEntries);
      return res.status(429).json(createRateLimitError());
    }

    if (userId) {
      userLastAnalysisAt.set(userId, now);
    }
    ipEntries.push(now);
    ipAnalysisTimestamps.set(ip, ipEntries);

    return next();
  }

  movementConstraintAnalyzeRateLimitMiddleware.reset = () => {
    userLastAnalysisAt.clear();
    ipAnalysisTimestamps.clear();
  };

  return movementConstraintAnalyzeRateLimitMiddleware;
}

const movementConstraintAnalyzeRateLimit = createMovementConstraintAnalyzeRateLimit();

module.exports = {
  IP_WINDOW_MS,
  MAX_IP_ANALYSES,
  USER_WINDOW_MS,
  createMovementConstraintAnalyzeRateLimit,
  movementConstraintAnalyzeRateLimit,
};
