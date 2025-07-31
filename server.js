/**
 * Two Left Feet Studio - Interactive Presentation Server
 * Node.js + Express server for handling slide synchronization and real-time updates
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files from public directory

// In-memory storage (in production, use a proper database)
let currentSlide = '';
let presentationElements = {};
let responses = {};
let connectedClients = [];

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin access endpoint
app.get('/admin', (req, res) => {
  const adminKey = req.query.key;
  if (adminKey === 'twoleftfeet2024') {
    res.redirect('/?admin=twoleftfeet2024');
  } else {
    res.status(401).json({ error: 'Unauthorized access' });
  }
});

// API Routes

/**
 * Sync endpoint - receives slide changes from Google Apps Script
 */
app.get('/api/sync', (req, res) => {
  const { slideName } = req.query;
  
  if (!slideName) {
    return res.status(400).json({ error: 'Missing slideName parameter' });
  }
  
  console.log(`📊 Slide changed to: ${slideName}`);
  
  // Update current slide
  currentSlide = slideName;
  
  // Broadcast to all connected clients (if using WebSocket)
  broadcastSlideChange(slideName);
  
  res.json({ 
    success: true, 
    message: `Slide updated to: ${slideName}`,
    timestamp: new Date().toISOString()
  });
});

/**
 * Get current slide
 */
app.get('/api/current-slide', (req, res) => {
  res.json({ 
    currentSlide,
    timestamp: new Date().toISOString()
  });
});

/**
 * Save presentation element (from admin panel)
 */
app.post('/api/elements', (req, res) => {
  const { id, type, title, options } = req.body;
  
  if (!id || !type || !title) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  presentationElements[id] = {
    id,
    type,
    title,
    options: options || [],
    createdAt: new Date().toISOString()
  };
  
  console.log(`💾 Saved element: ${id} (${type})`);
  
  res.json({ 
    success: true, 
    message: 'Element saved successfully',
    element: presentationElements[id]
  });
});

/**
 * Get all presentation elements
 */
app.get('/api/elements', (req, res) => {
  res.json(presentationElements);
});

/**
 * Get specific presentation element
 */
app.get('/api/elements/:id', (req, res) => {
  const { id } = req.params;
  const element = presentationElements[id];
  
  if (!element) {
    return res.status(404).json({ error: 'Element not found' });
  }
  
  res.json(element);
});

/**
 * Delete presentation element
 */
app.delete('/api/elements/:id', (req, res) => {
  const { id } = req.params;
  
  if (!presentationElements[id]) {
    return res.status(404).json({ error: 'Element not found' });
  }
  
  delete presentationElements[id];
  delete responses[id]; // Also delete associated responses
  
  console.log(`🗑️ Deleted element: ${id}`);
  
  res.json({ 
    success: true, 
    message: 'Element deleted successfully'
  });
});

/**
 * Submit response (from audience)
 */
app.post('/api/responses', (req, res) => {
  const { elementId, user, response, option, optionText } = req.body;
  
  if (!elementId || !user) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  // Initialize responses array if it doesn't exist
  if (!responses[elementId]) {
    responses[elementId] = [];
  }
  
  const responseData = {
    user,
    timestamp: new Date().toISOString(),
    response,
    option,
    optionText
  };
  
  responses[elementId].push(responseData);
  
  console.log(`📝 New response from ${user} for ${elementId}`);
  
  // Broadcast updated results to admin and audience
  broadcastResults(elementId);
  
  res.json({ 
    success: true, 
    message: 'Response recorded successfully',
    responseCount: responses[elementId].length
  });
});

/**
 * Get responses for an element
 */
app.get('/api/responses/:elementId', (req, res) => {
  const { elementId } = req.params;
  const elementResponses = responses[elementId] || [];
  
  res.json({
    elementId,
    responses: elementResponses,
    count: elementResponses.length
  });
});

/**
 * Get aggregated results for polls/votes
 */
app.get('/api/results/:elementId', (req, res) => {
  const { elementId } = req.params;
  const element = presentationElements[elementId];
  const elementResponses = responses[elementId] || [];
  
  if (!element) {
    return res.status(404).json({ error: 'Element not found' });
  }
  
  let results = {};
  
  if (element.type === 'question') {
    // For text questions, return all responses
    results = {
      type: 'text',
      responses: elementResponses.map(r => ({
        user: r.user,
        response: r.response,
        timestamp: r.timestamp
      }))
    };
  } else {
    // For polls/votes, aggregate by option
    results = {
      type: 'choice',
      options: {},
      total: elementResponses.length
    };
    
    element.options.forEach((option, index) => {
      const count = elementResponses.filter(r => r.option === index).length;
      const percentage = elementResponses.length > 0 ? (count / elementResponses.length * 100) : 0;
      
      results.options[index] = {
        text: option,
        count: count,
        percentage: Math.round(percentage * 10) / 10
      };
    });
  }
  
  res.json({
    elementId,
    element: element,
    results: results,
    timestamp: new Date().toISOString()
  });
});

/**
 * Clear all responses (admin only)
 */
app.delete('/api/responses', (req, res) => {
  const { adminKey } = req.query;
  
  if (adminKey !== 'twoleftfeet2024') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  responses = {};
  
  console.log('🧹 Cleared all responses');
  
  res.json({ 
    success: true, 
    message: 'All responses cleared'
  });
});

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    currentSlide: currentSlide,
    elementsCount: Object.keys(presentationElements).length,
    responsesCount: Object.values(responses).reduce((total, arr) => total + arr.length, 0)
  });
});

// Simple broadcasting system (in production, use WebSocket or Socket.io)
function broadcastSlideChange(slideName) {
  // In a real implementation, this would send real-time updates to connected clients
  console.log(`🔄 Broadcasting slide change: ${slideName}`);
  
  // You could implement WebSocket here for real-time updates
  // For now, clients will poll the current-slide endpoint
}

function broadcastResults(elementId) {
  console.log(`📊 Broadcasting results update for: ${elementId}`);
  
  // In a real implementation, this would send real-time results to admin panel
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    path: req.path 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
  🎭 Two Left Feet Studio Interactive Presentation Server
  
  🌟 Server running on port ${PORT}
  🔗 Main app: http://localhost:${PORT}
  🔧 Admin panel: http://localhost:${PORT}?admin=twoleftfeet2024
  📊 Health check: http://localhost:${PORT}/api/health
  
  💃 Ready to dance with data!
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Server shutting down gracefully...');
  process.exit(0);
});

// Export for testing
module.exports = app;
