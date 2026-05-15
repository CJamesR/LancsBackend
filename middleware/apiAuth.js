// middleware/apiAuth.js
module.exports = (req, res, next) => {
  const key = req.headers['x-api-key'];
  
  if (!key || key !== process.env.API_KEY) {
    return res.status(403).json({ 
      message: '🚫 Unauthorized: Invalid API Key'
    });
  }

  next();
};
