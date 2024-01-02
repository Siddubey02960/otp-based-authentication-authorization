const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');

const apiRoutes = require('./routes')
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;


app.use(express.json());
app.use(bodyParser.json());

// use routes
app.use(apiRoutes);

// 404 Error Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route Not Found' });
});

// Error handling middleware
app.use((err, req, res) => {
  console.error(err.stack);
  res.status(500).send('Internal Server Error');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
})

module.exports = app;