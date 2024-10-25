const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');
const uiRoutes = require('./uiRoutes');

const app = express();
const PORT = 8886;

// Set up EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

// Open SQLite database
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) {
    console.error('Error opening database', err);
  } else {
    console.log('Database connected');
    createTables();
  }
});

// Create tables if they don't exist
function createTables() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS Suno (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_date TEXT,
      modified_date TEXT,
      cookies TEXT,
      email TEXT,
      status TEXT CHECK(status IN ('VALID', 'INVALID'))
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS Vercel (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_date TEXT,
      modified_date TEXT,
      api_endpoint_url TEXT,
      suno_id INTEGER UNIQUE,
      description TEXT,
      FOREIGN KEY (suno_id) REFERENCES Suno(id)
    )`);
  });
}

// Function to get API instances from the database
function getApiInstances() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT v.api_endpoint_url, s.status 
            FROM Vercel v 
            JOIN Suno s ON v.suno_id = s.id 
            WHERE s.status = 'VALID'`, [], (err, rows) => {
      if (err) {
        console.error('Error fetching API instances', err);
        resolve([]);
      } else {
        const apiInstances = rows.map(row => row.api_endpoint_url);
        resolve(apiInstances);
      }
    });
  });
}

// Track request count and last access time for each instance
const requestTracker = [];

// Function to get the next available instance
async function getAvailableInstance() {
  const apiInstances = await getApiInstances();
  const currentTime = Date.now();

  // Ensure requestTracker is initialized for all instances
  while (requestTracker.length < apiInstances.length) {
    requestTracker.push({ requestCount: 0, lastAccess: 0 });
  }

  console.log('requestTracker', requestTracker);
  for (let i = 0; i < apiInstances.length; i++) {
    if (requestTracker[i].requestCount < 2 ||
      currentTime - requestTracker[i].lastAccess > 30000) {

      if (currentTime - requestTracker[i].lastAccess > 30000) {
        requestTracker[i].requestCount = 0; // Reset count after cooldown
      }

      return { url: apiInstances[i], index: i };
    }
  }
  return null; // No available instance within limit
}

// Proxy request with failover
async function proxyRequest(req, res) {
  let attempts = 0;
  const maxAttempts = 3;

  const tryRequest = async () => {
    if (attempts >= maxAttempts) {
      return res.status(503).send('All API instances are currently busy. Please try again later.');
    }

    const instance = await getAvailableInstance();
    if (!instance) {
      console.log('No available instance');
      attempts++;
      console.log(`No available instance. Attempt ${attempts} of ${maxAttempts}.`);
      return setTimeout(tryRequest, 1000); // Wait 1 second before retrying
    }

    try {
      const response = await axios({
        method: req.method,
        url: `${instance.url}${req.path}`,
        headers: {
          ...req.headers,
          host: new URL(instance.url).host // Update the host header
        },
        data: req.body,
        validateStatus: false // Don't throw on any status code
      });

      // Forward the response status, headers, and data
      res.status(response.status);
      Object.entries(response.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
      res.send(response.data);

      // Increase the requestCount only when the forward request is successful
      requestTracker[instance.index].requestCount++;
      requestTracker[instance.index].lastAccess = Date.now();
    } catch (error) {
      console.error(`Error with instance ${instance.url}:`, error.message);
      attempts++;
      console.log(`Trying another instance. Attempt ${attempts} of ${maxAttempts}.`);
      setTimeout(tryRequest, 1000); // Wait 1 second before retrying
    }
  };

  tryRequest();
}

// Add a catch-all route to handle all methods and paths
app.all('*', (req, res) => {
  if (req.path.startsWith('/ui')) {
    // Let the UI routes handle this
    uiRouter(req, res);
    return;
  }
  proxyRequest(req, res);
});

// Close the database connection when the server is shutting down
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed');
    process.exit(0);
  });
});

const uiRouter = uiRoutes(db);
app.use('/ui', uiRouter);
// Add this near the end of the file, after other route definitions but before app.listen()
app.use((req, res, next) => {
  console.log('Received request:', req.method, req.url);
  next();
});

// Keep your error handler here
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('Something went wrong!');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
